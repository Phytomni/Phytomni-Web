import chatAgentFlowchart from "@/assets/images/chat/ChatAgent.png";
import knowledgeAgentFlowchart from "@/assets/images/chat/KnowledgeAgent.png";
import dataAgentFlowchart from "@/assets/images/chat/DataAgent.png";
import analystAgentFlowchart from "@/assets/images/chat/AnalystAgent.png";
import reviewAgentFlowchart from "@/assets/images/chat/ReviewAgent.png";
import inSilicoResearchAgentFlowchart from "@/assets/images/chat/InSilicoResearchAgent.png";
import geneNetworkAgentFlowchart from "@/assets/images/chat/GeneNetworkAgent.png";
import briefGeneAgentFlowchart from "@/assets/images/chat/BriefGeneAgent.png";
import deepGenomeAgentFlowchart from "@/assets/images/chat/DeepGenomeAgent.png";
import digitalDesignAgentFlowchart from "@/assets/images/chat/DigitalDesignAgent.png";
import {
  CANONICAL_AGENT_I18N_KEYS,
  CANONICAL_AGENT_LABEL_I18N_KEYS,
  type CanonicalAgentTool,
} from "@/constants/agents";

export { default as AgentCapabilityPopover } from "./AgentCapabilityPopover.vue";

export interface AgentPresentation {
  readonly tool: CanonicalAgentTool;
  readonly labelKey: string;
  readonly descriptionKey: string;
  readonly flowchartSrc: string;
  readonly flowchartAltKey: string;
}

export const CANONICAL_AGENT_PRESENTATIONS: Record<
  CanonicalAgentTool,
  AgentPresentation
> = {
  ChatAgent: {
    tool: "ChatAgent",
    labelKey: CANONICAL_AGENT_LABEL_I18N_KEYS.ChatAgent,
    descriptionKey: CANONICAL_AGENT_I18N_KEYS.ChatAgent,
    flowchartSrc: chatAgentFlowchart,
    flowchartAltKey: "chat.agentPresentation.chatAgentAlt",
  },
  KnowledgeAgent: {
    tool: "KnowledgeAgent",
    labelKey: CANONICAL_AGENT_LABEL_I18N_KEYS.KnowledgeAgent,
    descriptionKey: CANONICAL_AGENT_I18N_KEYS.KnowledgeAgent,
    flowchartSrc: knowledgeAgentFlowchart,
    flowchartAltKey: "chat.agentPresentation.knowledgeAgentAlt",
  },
  DataAgent: {
    tool: "DataAgent",
    labelKey: CANONICAL_AGENT_LABEL_I18N_KEYS.DataAgent,
    descriptionKey: CANONICAL_AGENT_I18N_KEYS.DataAgent,
    flowchartSrc: dataAgentFlowchart,
    flowchartAltKey: "chat.agentPresentation.dataAgentAlt",
  },
  AnalystAgent: {
    tool: "AnalystAgent",
    labelKey: CANONICAL_AGENT_LABEL_I18N_KEYS.AnalystAgent,
    descriptionKey: CANONICAL_AGENT_I18N_KEYS.AnalystAgent,
    flowchartSrc: analystAgentFlowchart,
    flowchartAltKey: "chat.agentPresentation.analystAgentAlt",
  },
  ReviewAgent: {
    tool: "ReviewAgent",
    labelKey: CANONICAL_AGENT_LABEL_I18N_KEYS.ReviewAgent,
    descriptionKey: CANONICAL_AGENT_I18N_KEYS.ReviewAgent,
    flowchartSrc: reviewAgentFlowchart,
    flowchartAltKey: "chat.agentPresentation.reviewAgentAlt",
  },
  InSilicoResearchAgent: {
    tool: "InSilicoResearchAgent",
    labelKey: CANONICAL_AGENT_LABEL_I18N_KEYS.InSilicoResearchAgent,
    descriptionKey: CANONICAL_AGENT_I18N_KEYS.InSilicoResearchAgent,
    flowchartSrc: inSilicoResearchAgentFlowchart,
    flowchartAltKey: "chat.agentPresentation.inSilicoResearchAgentAlt",
  },
  GeneNetworkAgent: {
    tool: "GeneNetworkAgent",
    labelKey: CANONICAL_AGENT_LABEL_I18N_KEYS.GeneNetworkAgent,
    descriptionKey: CANONICAL_AGENT_I18N_KEYS.GeneNetworkAgent,
    flowchartSrc: geneNetworkAgentFlowchart,
    flowchartAltKey: "chat.agentPresentation.geneNetworkAgentAlt",
  },
  BriefGeneAgent: {
    tool: "BriefGeneAgent",
    labelKey: CANONICAL_AGENT_LABEL_I18N_KEYS.BriefGeneAgent,
    descriptionKey: CANONICAL_AGENT_I18N_KEYS.BriefGeneAgent,
    flowchartSrc: briefGeneAgentFlowchart,
    flowchartAltKey: "chat.agentPresentation.briefGeneAgentAlt",
  },
  DeepGenomeAgent: {
    tool: "DeepGenomeAgent",
    labelKey: CANONICAL_AGENT_LABEL_I18N_KEYS.DeepGenomeAgent,
    descriptionKey: CANONICAL_AGENT_I18N_KEYS.DeepGenomeAgent,
    flowchartSrc: deepGenomeAgentFlowchart,
    flowchartAltKey: "chat.agentPresentation.deepGenomeAgentAlt",
  },
  DigitalDesignAgent: {
    tool: "DigitalDesignAgent",
    labelKey: CANONICAL_AGENT_LABEL_I18N_KEYS.DigitalDesignAgent,
    descriptionKey: CANONICAL_AGENT_I18N_KEYS.DigitalDesignAgent,
    flowchartSrc: digitalDesignAgentFlowchart,
    flowchartAltKey: "chat.agentPresentation.digitalDesignAgentAlt",
  },
};
