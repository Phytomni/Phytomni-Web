// StreamCapability is the typed DTO exchanged by the gateway. The Web branch
// accepts only the canonical mode for each Bot-advertised stream agent.
export interface StreamCapability {
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
  if (agent === "ChatAgent") {
    return true;
  }
  return (
    (agent === "KnowledgeAgent" || agent === "BriefGeneAgent") &&
    mode === "expert"
  );
}

export function shouldStream(
  agent: string,
  mode: "instant" | "expert",
  capability: StreamCapability
): boolean {
  return (
    Array.isArray(capability.agents) &&
    STREAM_CAPABLE.has(agent) &&
    modeRoutesStreamAgent(agent, mode) &&
    capability.agents.includes(agent)
  );
}
