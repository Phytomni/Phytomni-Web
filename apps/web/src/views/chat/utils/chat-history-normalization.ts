import type { ChatMessage } from "../types";
import { messagePlainText } from "../messageTypes";

export const MAX_CONVERSATION_HISTORY_MESSAGES = 20;
const MAX_HISTORY_CONTENT_CODE_POINTS = 32768;

type HistoryTransportMessage = {
  role: "user" | "assistant";
  content: string;
};

function boundCodePoints(value: string, limit: number): string {
  let codePoints = 0;
  let codeUnits = 0;
  for (const point of value) {
    if (codePoints === limit) return value.slice(0, codeUnits);
    codePoints += 1;
    codeUnits += point.length;
  }
  return value;
}

export function projectHistoryForTransport(
  history: readonly ChatMessage[] | null | undefined
): HistoryTransportMessage[] {
  if (!Array.isArray(history)) return [];

  return history
    .filter(
      (message): message is ChatMessage & { role: "user" | "assistant" } =>
        message.role === "user" || message.role === "assistant"
    )
    .slice(-MAX_CONVERSATION_HISTORY_MESSAGES)
    .map((message) => ({
      role: message.role,
      content: boundCodePoints(
        messagePlainText(message),
        MAX_HISTORY_CONTENT_CODE_POINTS
      ),
    }));
}

export function normalizeHistoryRows(data: unknown): Record<string, unknown>[] {
  if (!Array.isArray(data)) return [];
  return data.filter(
    (item): item is Record<string, unknown> =>
      typeof item === "object" && item !== null && !Array.isArray(item)
  );
}

export function resolveHistoryQuestion(
  row: Record<string, unknown>,
  conversationTitle: string
): string {
  if (typeof row.query === "string" && row.query.trim()) {
    return row.query;
  }

  for (const candidate of [row.title_query, conversationTitle]) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return "";
}
