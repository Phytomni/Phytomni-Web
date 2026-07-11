import { nextTick } from "vue";
import { ElMessageBox } from "element-plus";
import ChatAgentImg from "@/assets/images/chat/ChatAgent.png";
import KnowledgeAgentImg from "@/assets/images/chat/KnowledgeAgent.png";
import DataAgentImg from "@/assets/images/chat/DataAgent.png";
import AnalystAgentImg from "@/assets/images/chat/AnalystAgent.png";
import ReviewAgentImg from "@/assets/images/chat/ReviewAgent.png";
import BriefGeneAgentImg from "@/assets/images/chat/BriefGeneAgent.png";
import DeepGenomeAgentImg from "@/assets/images/chat/DeepGenomeAgent.png";
import InSilicoResearchAgentImg from "@/assets/images/chat/InSilicoResearchAgent.png";
import GeneNetworkAgentImg from "@/assets/images/chat/GeneNetworkAgent.png";
import DigitalDesignAgentImg from "@/assets/images/chat/DigitalDesignAgent.png";
import DefaultAgentImg from "@/assets/images/chat/Agents.png";
import {
  CANONICAL_AGENT_DISPLAY_NAMES,
  CANONICAL_AGENT_I18N_KEYS,
  type CanonicalAgentTool,
} from "@/constants/agents";

export function useAgentsPanel(opts: { t: (key: string) => string }) {
  const { t } = opts;

  const getAgentTooltip = (agentName: string) => {
    const canonicalKey =
      CANONICAL_AGENT_I18N_KEYS[agentName as CanonicalAgentTool];
    if (canonicalKey) {
      return t(canonicalKey) || agentName;
    }

    const agentKey = agentName.charAt(0).toLowerCase() + agentName.slice(1);
    return t(`chat.agents.${agentKey}`) || agentName;
  };

  const getAgentImage = (agentName: string) => {
    const imageMap: Record<string, string> = {
      ChatAgent: ChatAgentImg,
      KnowledgeAgent: KnowledgeAgentImg,
      DataAgent: DataAgentImg,
      AnalystAgent: AnalystAgentImg,
      ReviewAgent: ReviewAgentImg,
      BriefGeneAgent: BriefGeneAgentImg,
      DeepGenomeAgent: DeepGenomeAgentImg,
      InSilicoResearchAgent: InSilicoResearchAgentImg,
      GeneNetworkAgent: GeneNetworkAgentImg,
      DigitalDesignAgent: DigitalDesignAgentImg,
    };

    return imageMap[agentName] || DefaultAgentImg;
  };

  const showMoreInfo = (agentName: string) => {
    const displayName =
      CANONICAL_AGENT_DISPLAY_NAMES[agentName as CanonicalAgentTool] ||
      agentName;
    ElMessageBox.alert(
      `<div class="agent-info-dialog">
      <div class="agent-detail">
        <div class="agent-description">
          <p>${getAgentTooltip(agentName)}</p>
        </div>
        <div class="agent-image">
          <img src="${getAgentImage(
            agentName
          )}" style="width: 100%; height: 300px;" alt="${displayName}">
        </div>
      </div>
    </div>`,
      displayName,
      {
        dangerouslyUseHTMLString: true,
        confirmButtonText: t("common.close"),
        customClass: "agent-info-dialog",
      }
    );

    nextTick(() => {
      const messageBoxElement = document.querySelector(
        ".el-message-box.agent-info-dialog"
      );
      if (messageBoxElement) {
        (messageBoxElement as HTMLElement).style.setProperty(
          "--el-messagebox-width",
          "800px"
        );
        (messageBoxElement as HTMLElement).style.setProperty("width", "800px");
        (messageBoxElement as HTMLElement).style.setProperty(
          "max-width",
          "800px"
        );
        (messageBoxElement as HTMLElement).style.setProperty(
          "min-width",
          "800px"
        );

        const contentElement = messageBoxElement.querySelector(
          ".el-message-box__content"
        );
        if (contentElement) {
          (contentElement as HTMLElement).style.setProperty(
            "max-height",
            "600px"
          );
          (contentElement as HTMLElement).style.setProperty("height", "600px");
          (contentElement as HTMLElement).style.setProperty(
            "min-height",
            "600px"
          );
        }
      }
    });
  };

  return {
    getAgentTooltip,
    showMoreInfo,
  };
}
