import { describe, it, expect } from "vitest";
import { shouldStream } from "@/views/chat/streaming/sendBranch";

describe("shouldStream", () => {
  it("streams only agents present in the enabled capability", () => {
    expect(
      shouldStream("KnowledgeAgent", "expert", {
        enabled: true,
        agents: ["KnowledgeAgent"],
      })
    ).toBe(true);
    expect(
      shouldStream("BriefGeneAgent", "expert", {
        enabled: false,
        agents: ["BriefGeneAgent"],
      })
    ).toBe(false);
    expect(
      shouldStream("AnalystAgent", "expert", {
        enabled: true,
        agents: ["AnalystAgent"],
      })
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
  it("keeps the legacy boolean path out of expert mode", () => {
    expect(shouldStream("ChatAgent", "expert", true)).toBe(false);
  });
  it("rejects agents in a mode that cannot route them", () => {
    expect(shouldStream("KnowledgeAgent", "instant", true)).toBe(false);
    expect(
      shouldStream("KnowledgeAgent", "instant", {
        enabled: true,
        agents: ["KnowledgeAgent"],
      })
    ).toBe(false);
    expect(
      shouldStream("ChatAgent", "expert", {
        enabled: true,
        agents: ["ChatAgent"],
      })
    ).toBe(false);
    expect(shouldStream("DataAgent", "instant", true)).toBe(false);
  });
});
