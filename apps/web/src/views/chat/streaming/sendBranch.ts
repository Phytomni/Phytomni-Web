// shouldStream decides whether a send uses the AG-UI stream path. First
// period: only ChatAgent has a Bot streaming primitive (knowledge/review are
// handoff P1); streaming is Instant-only — Expert routes via Bot
// /v1/query/route, which has no streaming variant, and in Expert the mention
// UI is disabled so activeAgentName is always "ChatAgent" and would otherwise
// pass the agent check. The front-end flag gates dark-launch.
const STREAM_CAPABLE = new Set(["ChatAgent"]);

export function shouldStream(
  activeAgentName: string,
  mode: "instant" | "expert",
  flagOn: boolean
): boolean {
  return flagOn && mode === "instant" && STREAM_CAPABLE.has(activeAgentName);
}
