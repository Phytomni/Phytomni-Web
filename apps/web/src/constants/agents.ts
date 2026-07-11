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
  DigitalDesignAgent: "智能设计智能体",
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

export const CANONICAL_AGENT_ROUTES = {
  KnowledgeAgent: "/knowledge-agent",
  DataAgent: "/data-agent",
  AnalystAgent: "/analyst-agent",
  BriefGeneAgent: "/brief-gene-agent",
  GeneNetworkAgent: "/gene-network-agent",
  DeepGenomeAgent: "/deep-genome-agent",
  DigitalDesignAgent: "/digital-design-agent",
} as const;

export type RoutedAgentTool = keyof typeof CANONICAL_AGENT_ROUTES;

export type CanonicalAtAbleTool = (typeof CANONICAL_AT_ABLE_TOOLS)[number];

export type PickerAgentOption = {
  tool: CanonicalAtAbleTool;
  labelKey: string;
  displayName: string;
};

export function derivePickerOptions(
  rolesTool: readonly string[]
): PickerAgentOption[] {
  return CANONICAL_AT_ABLE_TOOLS.filter((tool) => rolesTool.includes(tool)).map(
    (tool) => ({
      tool,
      labelKey: CANONICAL_AGENT_I18N_KEYS[tool],
      displayName: CANONICAL_AGENT_DISPLAY_NAMES[tool],
    })
  );
}

export type SidebarRouteOption = {
  id: number;
  name: string;
  toolName: RoutedAgentTool;
  icon: string;
  route: string;
  img: string;
};

const SIDEBAR_ROUTE_META: Record<
  RoutedAgentTool,
  { id: number; icon: string; img: string }
> = {
  KnowledgeAgent: { id: 2, icon: "Search", img: "/KnowledgeAgent.jpg" },
  DataAgent: { id: 3, icon: "DataLine", img: "/DataAgent.jpg" },
  AnalystAgent: { id: 4, icon: "Edit", img: "/AnalystAgent.jpg" },
  BriefGeneAgent: { id: 5, icon: "Edit", img: "/BriefGeneAgent.jpg" },
  GeneNetworkAgent: { id: 6, icon: "Edit", img: "/GeneNetworkAgent.jpg" },
  DeepGenomeAgent: { id: 7, icon: "Edit", img: "/DeepGenomeAgent.jpg" },
  DigitalDesignAgent: { id: 8, icon: "Edit", img: "/DigitalDesignAgent.jpg" },
};

export function deriveSidebarRouteOptions(): SidebarRouteOption[] {
  return (Object.keys(CANONICAL_AGENT_ROUTES) as RoutedAgentTool[]).map(
    (toolName) => ({
      id: SIDEBAR_ROUTE_META[toolName].id,
      name: CANONICAL_AGENT_DISPLAY_NAMES[toolName],
      toolName,
      icon: SIDEBAR_ROUTE_META[toolName].icon,
      route: CANONICAL_AGENT_ROUTES[toolName],
      img: SIDEBAR_ROUTE_META[toolName].img,
    })
  );
}
