import { describe, it, expect } from "vitest";
import { createChatRequestKey } from "@/views/chat/utils/chat-request-key";

describe("createChatRequestKey", () => {
  it("uses a fixed chat-request- prefix and contains no dialogue/user/message data", () => {
    const key = createChatRequestKey();
    expect(key.startsWith("chat-request-")).toBe(true);
    expect(key).not.toMatch(/new_/);
    expect(key).not.toContain("@");
    expect(key).not.toContain("dialogue");
  });

  it("produces two distinct keys in the same millisecond", () => {
    const a = createChatRequestKey();
    const b = createChatRequestKey();
    expect(a).not.toBe(b);
    expect(a.startsWith("chat-request-")).toBe(true);
    expect(b.startsWith("chat-request-")).toBe(true);
  });
});
