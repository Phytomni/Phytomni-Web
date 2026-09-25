import { normalizePositiveTaskRowId } from "@/api/task";
import type { ChatMessage, ChatUIState } from "../types";

export function resolveCancellableTaskRowId(
  chatState: ChatUIState
): string | null {
  const messages = chatState.renderedChat?.messages ?? [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const row = messages[index];
    if (row.role !== "assistant") continue;
    try {
      return normalizePositiveTaskRowId(row.id ?? "");
    } catch {
      continue;
    }
  }
  return null;
}

export function applyCancelledTaskDraft(
  chatState: ChatUIState,
  rowId: string,
  stoppedLabel: string
): ChatMessage | null {
  const messages = chatState.renderedChat?.messages;
  if (!messages) return null;
  const message = messages.find((row) => {
    try {
      return normalizePositiveTaskRowId(row.id ?? "") === rowId;
    } catch {
      return false;
    }
  });
  if (!message) return null;
  message.status = "CANCELLED";
  message.streamTerminalFailure = "cancelled";
  const content =
    typeof message.content === "string" ? message.content.trim() : "";
  if (!content) {
    message.content = stoppedLabel;
  }
  return message;
}
