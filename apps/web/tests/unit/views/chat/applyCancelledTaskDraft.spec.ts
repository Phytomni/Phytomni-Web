import { describe, expect, it } from "vitest";
import {
  applyCancelledTaskDraft,
  resolveCancellableTaskRowId,
} from "@/views/chat/composables/applyCancelledTaskDraft";
import type { ChatMessage, ChatUIState } from "@/views/chat/types";

function stateWithMessages(messages: ChatMessage[]): ChatUIState {
  return {
    renderedChat: { messages },
  } as ChatUIState;
}

describe("applyCancelledTaskDraft", () => {
  it("resolves the latest assistant Web row id", () => {
    const chatState = stateWithMessages([
      { role: "user", content: "q" },
      { role: "assistant", content: "draft", id: "88" },
    ]);
    expect(resolveCancellableTaskRowId(chatState)).toBe("88");
  });

  it("keeps streamed tokens and marks the same row cancelled", () => {
    const chatState = stateWithMessages([
      { role: "assistant", content: "already streamed tokens", id: "88" },
    ]);
    const message = applyCancelledTaskDraft(
      chatState,
      "88",
      "Generation stopped"
    );
    expect(message?.status).toBe("CANCELLED");
    expect(message?.content).toBe("already streamed tokens");
    expect(message?.streamTerminalFailure).toBe("cancelled");
  });
});
