import { describe, expect, it } from "vitest";
import { messageActionCapabilities } from "@/views/chat/utils/message-action-capabilities";

describe("messageActionCapabilities", () => {
  it.each([
    { role: "user", id: "11", tool_name: "ChatAgent" },
    { role: "assistant", tool_name: "ChatAgent" },
    {
      role: "assistant",
      id: "11",
      streaming: true,
      tool_name: "ChatAgent",
    },
  ])("keeps server-backed actions hidden for %#", (message) => {
    expect(messageActionCapabilities(message)).toEqual({
      canRefresh: false,
      canReact: false,
      generatedFormats: [],
    });
  });

  it("enables refresh and reactions for a persisted assistant row", () => {
    expect(messageActionCapabilities({ role: "assistant", id: "11" })).toEqual({
      canRefresh: true,
      canReact: true,
      generatedFormats: [],
    });
  });

  it("exposes the supported generated formats only for persisted rows", () => {
    expect(
      messageActionCapabilities({
        role: "assistant",
        id: "11",
        tool_name: "DataAgent",
      }).generatedFormats
    ).toEqual(["PDF", "Markdown", "Xlsx"]);

    expect(
      messageActionCapabilities({
        role: "assistant",
        id: "12",
        tool_name: "ReviewAgent",
      }).generatedFormats
    ).toEqual(["PDF", "Markdown", "Word"]);
  });
});
