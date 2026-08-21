import { describe, expect, it } from "vitest";
import { CANONICAL_AGENT_TOOLS } from "@/constants/agents";
import {
  POLLABLE_CHAT_AGENT_TOOLS,
  isActivePollableAssistantWait,
  isPollableChatAgentTool,
  isPollableWaitTool,
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

  it("treats empty tool_name as a wait-card tool without expanding the pollable set", () => {
    expect(isPollableWaitTool("")).toBe(true);
    expect(isPollableWaitTool("   ")).toBe(true);
    expect(isPollableWaitTool("AnalystAgent")).toBe(true);
    expect(isPollableWaitTool("DataAgent")).toBe(true);
    expect(isPollableWaitTool("ChatAgent")).toBe(false);
    expect(isPollableWaitTool("KnowledgeAgent")).toBe(false);
    expect(isPollableWaitTool("BriefGeneAgent")).toBe(false);
    expect(POLLABLE_CHAT_AGENT_TOOLS).not.toContain("");
  });

  it("does not treat sendFailed or first-turn Stop drafts as an active wait", () => {
    expect(
      isActivePollableAssistantWait({
        role: "assistant",
        content: "chat.sendFailed",
        tool_name: "",
        status: "",
        instantMessage: true,
      })
    ).toBe(false);
    expect(
      isActivePollableAssistantWait({
        role: "assistant",
        content: "chat.generationStopped",
        instantMessage: true,
      })
    ).toBe(false);
  });

  it("keeps Expert Auto selecting rows with a positive id as an active wait", () => {
    expect(
      isActivePollableAssistantWait({
        role: "assistant",
        tool_name: "",
        status: "RUNNING",
        id: "5",
        content: "",
      })
    ).toBe(true);
  });
});
