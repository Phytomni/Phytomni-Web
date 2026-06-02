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
