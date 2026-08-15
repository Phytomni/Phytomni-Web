import { describe, it, expect } from "vitest";
import {
  shouldStream,
  type StreamCapability,
} from "@/views/chat/streaming/sendBranch";

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

  it("does not synthesize Chat streaming from a legacy boolean", () => {
    expect(
      shouldStream("ChatAgent", "instant", true as unknown as StreamCapability)
    ).toBe(false);
  });

  it("streams Chat only from an enabled negotiated capability", () => {
    expect(
      shouldStream("ChatAgent", "instant", {
        enabled: true,
        agents: ["ChatAgent"],
      })
    ).toBe(true);
    expect(
      shouldStream("ChatAgent", "instant", {
        enabled: false,
        agents: ["ChatAgent"],
      })
    ).toBe(false);
  });
  it("rejects agents in a mode that cannot route them", () => {
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
    expect(
      shouldStream("DataAgent", "instant", {
        enabled: true,
        agents: ["DataAgent"],
      })
    ).toBe(false);
  });
});
