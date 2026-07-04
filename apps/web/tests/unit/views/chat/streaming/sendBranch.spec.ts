import { describe, it, expect } from "vitest";
import { shouldStream } from "@/views/chat/streaming/sendBranch";

describe("shouldStream", () => {
  it("streams for ChatAgent in instant mode when the flag is on", () => {
    expect(shouldStream("ChatAgent", "instant", true)).toBe(true);
  });
  it("does not stream when the flag is off", () => {
    expect(shouldStream("ChatAgent", "instant", false)).toBe(false);
  });
  it("never streams expert mode (routes via Bot /v1/query/route)", () => {
    expect(shouldStream("ChatAgent", "expert", true)).toBe(false);
  });
  it("does not stream non-chat agents even when the flag is on", () => {
    expect(shouldStream("KnowledgeAgent", "instant", true)).toBe(false);
    expect(shouldStream("DataAgent", "instant", true)).toBe(false);
  });
});
