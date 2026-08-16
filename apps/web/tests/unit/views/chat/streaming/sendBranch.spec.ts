import { describe, it, expect } from "vitest";
import {
  shouldStream,
  type StreamCapability,
} from "@/views/chat/streaming/sendBranch";

describe("shouldStream", () => {
  it("streams only agents present in the advertised capability", () => {
    expect(
      shouldStream("KnowledgeAgent", "expert", {
        agents: ["KnowledgeAgent"],
      })
    ).toBe(true);
    expect(
      shouldStream("AnalystAgent", "expert", {
        agents: ["AnalystAgent"],
      })
    ).toBe(false);
  });

  it("does not synthesize Chat streaming from a legacy boolean", () => {
    expect(
      shouldStream("ChatAgent", "instant", true as unknown as StreamCapability)
    ).toBe(false);
  });

  it("streams Chat from a negotiated capability", () => {
    expect(
      shouldStream("ChatAgent", "instant", {
        agents: ["ChatAgent"],
      })
    ).toBe(true);
  });
  it("rejects agents in a mode that cannot route them", () => {
    expect(
      shouldStream("KnowledgeAgent", "instant", {
        agents: ["KnowledgeAgent"],
      })
    ).toBe(false);
    expect(
      shouldStream("ChatAgent", "expert", {
        agents: ["ChatAgent"],
      })
    ).toBe(false);
    expect(
      shouldStream("DataAgent", "instant", {
        agents: ["DataAgent"],
      })
    ).toBe(false);
  });
});
