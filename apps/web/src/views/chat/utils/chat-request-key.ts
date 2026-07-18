/** Module-scoped monotonic sequence — distinct keys even within the same ms. */
let requestKeySeq = 0;

/**
 * Runtime-only chat request key. Never embed user/dialogue/message data;
 * never send this value as a server message id or FormData field.
 */
export function createChatRequestKey(): string {
  requestKeySeq += 1;
  return `chat-request-${Date.now()}-${requestKeySeq}`;
}
