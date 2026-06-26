// Single source of truth for agent tool names on the Web side. These MUST equal
// the Bot /v1/agents tool names (see apps/server external/bot CanonicalAgentTool
// and its drift-guard test). The @-able subset is what users can mention/send.
export const CANONICAL_AGENT_TOOLS = [
  "ChatAgent",
  "KnowledgeAgent",
  "DataAgent",
  "ReviewAgent",
  "BriefGeneAgent",
  "AnalystAgent",
  "DeepGenomeAgent",
  "InSilicoResearchAgent",
  "GeneNetworkAgent",
  "DigitalDesignAgent",
] as const;

export const CANONICAL_AT_ABLE_TOOLS = [
  "ChatAgent",
  "KnowledgeAgent",
  "DataAgent",
  "ReviewAgent",
  "BriefGeneAgent",
] as const;
