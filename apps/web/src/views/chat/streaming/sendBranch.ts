// StreamCapability is the typed DTO exchanged by the gateway for the stream
// dark launch. The gateway owns the enabled agent list; the Web branch only
// accepts an exact listed agent in Instant mode.
export interface StreamCapability {
  enabled: boolean;
  agents: readonly string[];
}

// Keep the pre-capability boolean call compatible with the existing send
// composable. A true environment flag can still expose ChatAgent, while new
// agents remain dark until their capability DTO is explicitly supplied.
const LEGACY_CHAT_CAPABILITY: StreamCapability = {
  enabled: true,
  agents: ["ChatAgent"],
};
// These are the only canonical tools the Web stream reducer currently knows
// how to render. A capability manifest must still opt in each one explicitly;
// the legacy boolean overload below intentionally exposes ChatAgent only.
export const STREAM_CAPABLE_AGENTS = [
  "ChatAgent",
  "KnowledgeAgent",
  "BriefGeneAgent",
] as const;
const STREAM_CAPABLE = new Set<string>(STREAM_CAPABLE_AGENTS);

export function shouldStream(
  agent: string,
  mode: "instant" | "expert",
  capability: StreamCapability
): boolean;
export function shouldStream(
  agent: string,
  mode: "instant" | "expert",
  flagOn: boolean
): boolean;
export function shouldStream(
  agent: string,
  mode: "instant" | "expert",
  capabilityOrFlag: StreamCapability | boolean
): boolean {
  const capability =
    typeof capabilityOrFlag === "boolean"
      ? capabilityOrFlag
        ? LEGACY_CHAT_CAPABILITY
        : { enabled: false, agents: [] as const }
      : capabilityOrFlag;
  return (
    capability.enabled &&
    mode === "instant" &&
    STREAM_CAPABLE.has(agent) &&
    capability.agents.includes(agent)
  );
}
