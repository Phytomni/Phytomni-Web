import { normalizePositiveTaskRowId } from "@/api/task";
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

const POLLABLE_WAIT_TERMINAL = new Set([
  "SUCCEEDED",
  "FAILED",
  "TIMED_OUT",
  "TIMEOUT",
  "CANCELLED",
  "CANCELED",
]);

export function isActivePollableAssistantWait(
  message:
    | {
        role?: string;
        tool_name?: unknown;
        status?: unknown;
        id?: unknown;
      }
    | null
    | undefined
): boolean {
  if (!message || message.role !== "assistant") return false;
  if (!isPollableWaitTool(message.tool_name)) return false;
  const status = String(message.status ?? "")
    .trim()
    .toUpperCase();
  if (status !== "" && POLLABLE_WAIT_TERMINAL.has(status)) return false;
  try {
    if (typeof message.id !== "string" && typeof message.id !== "number") {
      return false;
    }
    normalizePositiveTaskRowId(message.id);
    return true;
  } catch {
    return false;
  }
}
