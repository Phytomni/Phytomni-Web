import type { CanonicalAgentTool } from "@/constants/agents";

export const POLLABLE_CHAT_AGENT_TOOLS = [
  "AnalystAgent",
  "DeepGenomeAgent",
  "InSilicoResearchAgent",
  "DigitalDesignAgent",
  "GeneNetworkAgent",
  "DataAgent",
  "ReviewAgent",
] as const satisfies readonly CanonicalAgentTool[];

export type PollableChatAgentTool = (typeof POLLABLE_CHAT_AGENT_TOOLS)[number];

const POLLABLE_CHAT_AGENT_TOOL_SET: ReadonlySet<string> = new Set(
  POLLABLE_CHAT_AGENT_TOOLS
);

export function isPollableChatAgentTool(
  tool: unknown
): tool is PollableChatAgentTool {
  return typeof tool === "string" && POLLABLE_CHAT_AGENT_TOOL_SET.has(tool);
}

export function isPollableWaitTool(tool: unknown): boolean {
  const name = typeof tool === "string" ? tool.trim() : "";
  return name === "" || isPollableChatAgentTool(name);
}
