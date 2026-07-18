import { describe, it, expect } from "vitest";
import { shouldStream } from "@/views/chat/streaming/sendBranch";

describe("shouldStream", () => {
  it("streams only agents present in the enabled capability", () => {
    expect(
      shouldStream("KnowledgeAgent", "instant", {
        enabled: true,
        agents: ["KnowledgeAgent"],
      }),
    ).toBe(true);
    expect(
      shouldStream("BriefGeneAgent", "instant", {
        enabled: false,
        agents: ["BriefGeneAgent"],
      }),
    ).toBe(false);
    expect(
      shouldStream("AnalystAgent", "instant", {
        enabled: true,
        agents: ["AnalystAgent"],
      }),
    ).toBe(false);
  });

  it("keeps the legacy environment boolean limited to ChatAgent", () => {
    expect(shouldStream("ChatAgent", "instant", true)).toBe(true);
    expect(shouldStream("KnowledgeAgent", "instant", true)).toBe(false);
    expect(shouldStream("BriefGeneAgent", "instant", true)).toBe(false);
  });

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
