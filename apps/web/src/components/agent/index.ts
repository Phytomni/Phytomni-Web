import chatAgentFlowchart from "@/assets/images/chat/ChatAgent.png";
import knowledgeAgentFlowchart from "@/assets/images/chat/KnowledgeAgent.png";
import dataAgentFlowchart from "@/assets/images/chat/DataAgent.png";
import analystAgentFlowchart from "@/assets/images/chat/AnalystAgent.png";
import reviewAgentFlowchart from "@/assets/images/chat/ReviewAgent.png";
import inSilicoResearchAgentFlowchart from "@/assets/images/chat/InSilicoResearchAgent.png";
import geneNetworkAgentFlowchart from "@/assets/images/chat/GeneNetworkAgent.png";
import deepGenomeAgentFlowchart from "@/assets/images/chat/DeepGenomeAgent.png";
import digitalDesignAgentFlowchart from "@/assets/images/chat/DigitalDesignAgent.png";
import {
  CANONICAL_AGENT_I18N_KEYS,
  CANONICAL_AGENT_LABEL_I18N_KEYS,
  type CanonicalAgentTool,
} from "@/constants/agents";

export { default as AgentCapabilityPopover } from "./AgentCapabilityPopover.vue";

export type AgentWorkflowMedia = Readonly<{
  src: string;
  altKey: string;
}>;

export interface AgentPresentation {
  readonly tool: CanonicalAgentTool;
  readonly labelKey: string;
  readonly descriptionKey: string;
  readonly workflow?: AgentWorkflowMedia;
}

export const CANONICAL_AGENT_PRESENTATIONS: Record<
  CanonicalAgentTool,
  AgentPresentation
> = {
  ChatAgent: {
    tool: "ChatAgent",
    labelKey: CANONICAL_AGENT_LABEL_I18N_KEYS.ChatAgent,
    descriptionKey: CANONICAL_AGENT_I18N_KEYS.ChatAgent,
    workflow: {
      src: chatAgentFlowchart,
      altKey: "chat.agentPresentation.chatAgentAlt",
    },
  },
  KnowledgeAgent: {
    tool: "KnowledgeAgent",
    labelKey: CANONICAL_AGENT_LABEL_I18N_KEYS.KnowledgeAgent,
    descriptionKey: CANONICAL_AGENT_I18N_KEYS.KnowledgeAgent,
    workflow: {
      src: knowledgeAgentFlowchart,
      altKey: "chat.agentPresentation.knowledgeAgentAlt",
    },
  },
  DataAgent: {
    tool: "DataAgent",
    labelKey: CANONICAL_AGENT_LABEL_I18N_KEYS.DataAgent,
    descriptionKey: CANONICAL_AGENT_I18N_KEYS.DataAgent,
    workflow: {
      src: dataAgentFlowchart,
      altKey: "chat.agentPresentation.dataAgentAlt",
    },
  },
  AnalystAgent: {
    tool: "AnalystAgent",
    labelKey: CANONICAL_AGENT_LABEL_I18N_KEYS.AnalystAgent,
    descriptionKey: CANONICAL_AGENT_I18N_KEYS.AnalystAgent,
    workflow: {
      src: analystAgentFlowchart,
      altKey: "chat.agentPresentation.analystAgentAlt",
    },
  },
  ReviewAgent: {
    tool: "ReviewAgent",
    labelKey: CANONICAL_AGENT_LABEL_I18N_KEYS.ReviewAgent,
    descriptionKey: CANONICAL_AGENT_I18N_KEYS.ReviewAgent,
    workflow: {
      src: reviewAgentFlowchart,
      altKey: "chat.agentPresentation.reviewAgentAlt",
    },
  },
  InSilicoResearchAgent: {
    tool: "InSilicoResearchAgent",
    labelKey: CANONICAL_AGENT_LABEL_I18N_KEYS.InSilicoResearchAgent,
    descriptionKey: CANONICAL_AGENT_I18N_KEYS.InSilicoResearchAgent,
    workflow: {
      src: inSilicoResearchAgentFlowchart,
      altKey: "chat.agentPresentation.inSilicoResearchAgentAlt",
    },
  },
  GeneNetworkAgent: {
    tool: "GeneNetworkAgent",
    labelKey: CANONICAL_AGENT_LABEL_I18N_KEYS.GeneNetworkAgent,
    descriptionKey: CANONICAL_AGENT_I18N_KEYS.GeneNetworkAgent,
    workflow: {
      src: geneNetworkAgentFlowchart,
      altKey: "chat.agentPresentation.geneNetworkAgentAlt",
    },
  },
  BriefGeneAgent: {
    tool: "BriefGeneAgent",
    labelKey: CANONICAL_AGENT_LABEL_I18N_KEYS.BriefGeneAgent,
    descriptionKey: CANONICAL_AGENT_I18N_KEYS.BriefGeneAgent,
  },
  DeepGenomeAgent: {
    tool: "DeepGenomeAgent",
    labelKey: CANONICAL_AGENT_LABEL_I18N_KEYS.DeepGenomeAgent,
    descriptionKey: CANONICAL_AGENT_I18N_KEYS.DeepGenomeAgent,
    workflow: {
      src: deepGenomeAgentFlowchart,
      altKey: "chat.agentPresentation.deepGenomeAgentAlt",
    },
  },
  DigitalDesignAgent: {
    tool: "DigitalDesignAgent",
    labelKey: CANONICAL_AGENT_LABEL_I18N_KEYS.DigitalDesignAgent,
    descriptionKey: CANONICAL_AGENT_I18N_KEYS.DigitalDesignAgent,
    workflow: {
      src: digitalDesignAgentFlowchart,
      altKey: "chat.agentPresentation.digitalDesignAgentAlt",
    },
  },
};
