/**
 * Helpers for the pending-chat localStorage record shape used by chat/index.vue
 * scanners (TW-D10) and the chat-send/finish writer side (TW-D8).
 *
 * Contract:
 *   - Record key: `pending_chat_<dialogueId>`
 *   - Record shape: { isPending: true, messages: NonEmptyArray, id?: string }
 *   - Read side: silent skip + removeItem on corrupt
 *   - Write side: see TW-D8 design for user-visible error policy
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
 * Predicate(strict, per TW-D10 Q2 lock):
 *   isPending === true AND Array.isArray(messages) AND messages.length > 0
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
 * Strategy(strict, per TW-D10 Q3 lock):
 *   1. ID match: chat.dialogue_id === pending.id OR chat.dialogue_id === tempChatId
 *   2. Fallback: exact title equality with first user-role message content
 * NO substring fuzzy(removed in TW-D10 because short prompts like `hi` / `help`
 * collided and silently merged unrelated chats — Wave 5.1 plan v1.3 §AF-003).
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
 * Parses JSON safely. Returns null on parse failure or empty input + logs the error.
 * Caller decides whether to removeItem the originating key — see TW-D10 Q4 lock
 * (log + removeItem applied by 3 scanners in chat/index.vue).
 */
export function safeParse<T = PendingChatRecord>(
  raw: string | null | undefined
): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    console.error("[pendingChat] safeParse failed:", error);
    return null;
  }
}
