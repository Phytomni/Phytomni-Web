// StreamCapability is the typed DTO exchanged by the gateway for the stream
// dark launch. The gateway owns the enabled agent list; the Web branch accepts
// only the canonical mode for each listed agent.
export interface StreamCapability {
  enabled: boolean;
  agents: readonly string[];
}

// These are the only canonical tools the Web stream reducer currently knows
// how to render. A capability manifest must still opt in each one explicitly;
// local flags alone never synthesize support for an agent.
export const STREAM_CAPABLE_AGENTS = [
  "ChatAgent",
  "KnowledgeAgent",
  "BriefGeneAgent",
] as const;
const STREAM_CAPABLE = new Set<string>(STREAM_CAPABLE_AGENTS);

function modeRoutesStreamAgent(
  agent: string,
  mode: "instant" | "expert"
): boolean {
  return agent === "ChatAgent"
    ? mode === "instant"
    : (agent === "KnowledgeAgent" || agent === "BriefGeneAgent") &&
        mode === "expert";
}

export function shouldStream(
  agent: string,
  mode: "instant" | "expert",
  capability: StreamCapability
): boolean {
  return (
    capability.enabled === true &&
    Array.isArray(capability.agents) &&
    STREAM_CAPABLE.has(agent) &&
    modeRoutesStreamAgent(agent, mode) &&
    capability.agents.includes(agent)
  );
}
