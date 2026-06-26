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

export type CanonicalAgentTool = (typeof CANONICAL_AGENT_TOOLS)[number];

export const CANONICAL_AT_ABLE_TOOLS = [
  "ChatAgent",
  "KnowledgeAgent",
  "DataAgent",
  "ReviewAgent",
  "BriefGeneAgent",
] as const;

export const CANONICAL_AGENT_DISPLAY_NAMES: Record<CanonicalAgentTool, string> = {
  ChatAgent: "Chat Agent",
  KnowledgeAgent: "Knowledge Agent",
  DataAgent: "Data Agent",
  ReviewAgent: "Review Agent",
  BriefGeneAgent: "Brief Gene Agent",
  AnalystAgent: "Analyst Agent",
  DeepGenomeAgent: "Deep Genome Agent",
  InSilicoResearchAgent: "In Silico Research Agent",
  GeneNetworkAgent: "Gene Network Agent",
  DigitalDesignAgent: "Digital Design Agent",
} as const;

export const CANONICAL_AGENT_ZH_NAMES: Record<CanonicalAgentTool, string> = {
  ChatAgent: "对话智能体",
  KnowledgeAgent: "知识智能体",
  DataAgent: "数据智能体",
  ReviewAgent: "综述智能体",
  BriefGeneAgent: "基因综述智能体",
  AnalystAgent: "分析智能体",
  DeepGenomeAgent: "基因深度分析智能体",
  InSilicoResearchAgent: "虚拟研究智能体",
  GeneNetworkAgent: "基因网络智能体",
  DigitalDesignAgent: "数字设计智能体",
} as const;

export const CANONICAL_AGENT_I18N_KEYS: Record<CanonicalAgentTool, string> = {
  ChatAgent: "chat.agents.chatAgent",
  KnowledgeAgent: "chat.agents.knowledgeAgent",
  DataAgent: "chat.agents.dataAgent",
  ReviewAgent: "chat.agents.reviewAgent",
  BriefGeneAgent: "chat.agents.briefGeneAgent",
  AnalystAgent: "chat.agents.analystAgent",
  DeepGenomeAgent: "chat.agents.deepGenomeAgent",
  InSilicoResearchAgent: "chat.agents.inSilicoResearchAgent",
  GeneNetworkAgent: "chat.agents.geneNetworkAgent",
  DigitalDesignAgent: "chat.agents.digitalDesignAgent",
} as const;

export const CANONICAL_AGENT_PAGE_TITLE_KEYS: Partial<
  Record<CanonicalAgentTool, string>
> = {
  KnowledgeAgent: "agents.knowledge.title",
  DataAgent: "agents.data.title",
  BriefGeneAgent: "agents.briefGene.title",
  AnalystAgent: "agents.analyst.title",
  DeepGenomeAgent: "agents.deepGenome.title",
  GeneNetworkAgent: "agents.geneNetwork.title",
  DigitalDesignAgent: "agents.digitalDesign.title",
} as const;
