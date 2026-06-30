/**
 * Helpers for the pending-chat localStorage record shape used by chat/index.vue
 * scanners and the chat-send/finish writer side.
 *
 * Contract:
 *   - Record key: `pending_chat_<dialogueId>`
 *   - Record shape: { isPending: true, messages: NonEmptyArray, id?: string }
 *   - Read side: silent skip + removeItem on corrupt
 *   - Write side: caller is responsible for user-visible error policy
 */

export interface PendingChatRecord {
  isPending: boolean;
  messages: Array<{ role: string; content: string; [k: string]: unknown }>;
  id?: string;
  [k: string]: unknown;
}

export interface ChatListEntry {
  dialogue_id: string;
  title: string;
  [k: string]: unknown;
}

/**
 * Returns true iff `data` is a valid pending-chat record.
 * Strict predicate: isPending === true AND Array.isArray(messages) AND messages.length > 0.
 * Rejects truthy-but-non-boolean isPending values and empty / corrupt messages payloads.
 */
export function isValidPendingRecord(
  data: unknown
): data is PendingChatRecord {
  if (typeof data !== "object" || data === null) return false;
  const r = data as Record<string, unknown>;
  if (r.isPending !== true) return false;
  if (!Array.isArray(r.messages)) return false;
  if (r.messages.length === 0) return false;
  return true;
}

/**
 * Returns true iff `chat` (chatList entry) corresponds to `pending` (localStorage record).
 * Strategy:
 *   1. ID match: chat.dialogue_id === pending.id OR chat.dialogue_id === tempChatId
 *   2. Fallback: exact title equality with first user-role message content
 * Substring / prefix matching is deliberately NOT supported — short prompts like
 * "hi" / "help" collided and silently merged unrelated chats.
 */
export function matchesChat(
  chat: ChatListEntry,
  pending: PendingChatRecord,
  tempChatId: string
): boolean {
  if (
    chat.dialogue_id === pending.id ||
    chat.dialogue_id === tempChatId
  ) {
    return true;
  }
  const firstUserMsg = pending.messages.find((m) => m.role === "user");
  if (!firstUserMsg || typeof firstUserMsg.content !== "string") return false;
  return chat.title === firstUserMsg.content;
}

/**
 * Parses JSON safely. Returns null on parse failure, on null input, or on empty-string
 * input. Logs to console.error on parse failure only. Caller decides whether to
 * removeItem the originating key (current consumers: 3 scanners in chat/index.vue).
 */
export function safeParse<T = PendingChatRecord>(
  raw: string | null | undefined
): T | null {
  if (raw == null || raw === "") return null;
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    console.error("[pendingChat] safeParse failed:", error);
    return null;
  }
}

/**
 * Write a pending-chat record to localStorage at `pending_chat_<dialogueId>`.
 *
 * Caller MUST check isLocalStorageChat(dialogueId) before calling AND pass
 * a stable dialogueId / messages reference captured at sendMessage entry
 * (not a fresh read of currentChatId.value / currentChat.value.messages).
 *
 * Record shape (matches prod-fork for write/read parity + debug readability):
 *   - id:        dialogueId verbatim
 *   - title:     options.title (caller-supplied), truncated to 50 chars + "..."
 *                fallback if no title: last user-role message content
 *   - date:      ISO timestamp at call time
 *   - messages:  sanitized clone of input messages (attachedFiles File objects
 *                replaced with {name, size, type} projection to avoid
 *                JSON.stringify silent data loss)
 *   - isPending: true
 *
 * Error policy (non-blocking):
 *   - empty/null dialogueId or empty messages → console.warn + silent return
 *   - JSON.stringify throws (e.g. circular ref) → console.error + onError(error)
 *   - setItem QuotaExceededError → console.error + onError(error)
 *   - All errors swallowed; helper never throws to caller.
 */
export function writePendingChat(
  dialogueId: string,
  messages: PendingChatRecord["messages"],
  options?: {
    title?: string;
    mode?: "instant" | "expert";
    onError?: (error: unknown) => void;
  }
): void {
  if (typeof dialogueId !== "string" || dialogueId === "") {
    console.warn("[pendingChat] writePendingChat: invalid dialogueId");
    return;
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    console.warn("[pendingChat] writePendingChat: empty messages");
    return;
  }
  try {
    let titleSource: string;
    if (typeof options?.title === "string") {
      titleSource = options.title;
    } else {
      const lastUserMsg = [...messages]
        .reverse()
        .find((m) => m.role === "user");
      titleSource =
        typeof lastUserMsg?.content === "string" ? lastUserMsg.content : "";
    }
    const title =
      titleSource.length > 50
        ? titleSource.substring(0, 50) + "..."
        : titleSource;

    const sanitizedMessages = messages.map((m) => {
      if (
        Array.isArray((m as Record<string, unknown>).attachedFiles)
      ) {
        const files = (m as Record<string, unknown>).attachedFiles as Array<{
          name?: string;
          size?: number;
          type?: string;
        }>;
        return {
          ...m,
          attachedFiles: files.map((f) => ({
            name: typeof f.name === "string" ? f.name : "",
            size: typeof f.size === "number" ? f.size : 0,
            type: typeof f.type === "string" ? f.type : "",
          })),
        };
      }
      return m;
    });

    const record: PendingChatRecord & {
      title: string;
      date: string;
    } = {
      id: dialogueId,
      title,
      date: new Date().toISOString(),
      messages: sanitizedMessages,
      isPending: true as const,
      ...(options?.mode ? { mode: options.mode } : {}),
    };
    localStorage.setItem(
      `pending_chat_${dialogueId}`,
      JSON.stringify(record),
    );
  } catch (error) {
    console.error("[pendingChat] writePendingChat failed:", error);
    options?.onError?.(error);
  }
}

/**
 * Remove the pending-chat record for `dialogueId`. Idempotent.
 *
 * Caller MUST pass a stable dialogueId captured at sendMessage entry, NOT a
 * fresh read of currentChatId.value — between sendMessage entry and finally,
 * an `await getHistoryQuestionData()` runs and the user may have switched
 * chats; reading the ref fresh would clear the wrong key.
 *
 * removeItem on missing key is a no-op; removeItem throwing is extremely rare
 * (old-Safari incognito edge case). Swallowed with console.error only.
 *
 * Caller MUST check isLocalStorageChat(dialogueId) before calling (consistency
 * with writePendingChat — silent return on non-prefix IDs would mask a caller
 * bug).
 */
export function clearPendingChat(dialogueId: string): void {
  if (typeof dialogueId !== "string" || dialogueId === "") {
    console.warn("[pendingChat] clearPendingChat: invalid dialogueId");
    return;
  }
  try {
    localStorage.removeItem(`pending_chat_${dialogueId}`);
  } catch (error) {
    console.error("[pendingChat] clearPendingChat failed:", error);
  }
}

/**
 * Predicate: does this dialogueId represent a localStorage-only pending chat?
 *
 * True iff dialogueId is a non-empty string matching /^new_.+$/ — the prefix
 * minted by startNewChat() at chat/index.vue:1946 (`"new_" + Date.now()`).
 *
 * The require-at-least-one-char-after-prefix rule prevents the degenerate
 * 'new_' edge case (which would pass a startsWith-only check but cannot
 * occur via startNewChat in practice).
 */
export function isLocalStorageChat(
  dialogueId: string | null | undefined
): boolean {
  if (typeof dialogueId !== "string" || dialogueId === "") return false;
  return dialogueId.startsWith("new_") && dialogueId.length > 4;
}
