import { describe, expect, it } from "vitest";
import { CANONICAL_AGENT_TOOLS } from "@/constants/agents";
import {
  POLLABLE_CHAT_AGENT_TOOLS,
  isPollableChatAgentTool,
} from "@/views/chat/utils/async-agent-policy";

const EXACT_POLLABLE_TOOLS = [
  "AnalystAgent",
  "DeepGenomeAgent",
  "InSilicoResearchAgent",
  "DigitalDesignAgent",
  "GeneNetworkAgent",
  "DataAgent",
  "ReviewAgent",
] as const;

describe("asynchronous Chat Agent policy", () => {
  it("locks the exact owner-scoped lifecycle set", () => {
    expect(POLLABLE_CHAT_AGENT_TOOLS).toEqual(EXACT_POLLABLE_TOOLS);
    expect(
      [...CANONICAL_AGENT_TOOLS.filter(isPollableChatAgentTool)].sort()
    ).toEqual([...EXACT_POLLABLE_TOOLS].sort());
  });

  it.each([
    "ChatAgent",
    "KnowledgeAgent",
    "BriefGeneAgent",
    "DeepGenomeAgentLegacy",
    "toString",
    "",
    null,
    undefined,
  ])("rejects non-pollable tool %j", (tool) => {
    expect(isPollableChatAgentTool(tool)).toBe(false);
  });
});
