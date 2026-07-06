import { ref, computed, nextTick } from "vue";
import type { WritableComputedRef } from "vue";
import type { Router } from "vue-router";
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

export function useAgentsPanel(opts: {
  t: (key: string) => string;
  isSending: WritableComputedRef<boolean>;
  router: Router;
  scrollToBottom: () => void;
}) {
  const { t, isSending, router, scrollToBottom } = opts;

  // base height
  const baseHeight = 140;
  // expanded height
  const expandedHeight = 480;
  // extra overlay height
  const overlayHeight = 10;

  // whether expanded
  const isExpanded = ref(false);

  // whether currently animating
  const isAnimating = ref(false);

  // compute the current container height
  const containerHeight = computed(() => {
    return isExpanded.value ? expandedHeight : baseHeight;
  });

  // compute the current container style
  const containerStyle = computed(() => ({
    height: `${containerHeight.value}px`,
    transform: isExpanded.value ? `translateY(-${overlayHeight}px)` : "none",
  }));

  // handle scroll
  const handleScroll = (event: WheelEvent) => {
    if (isAnimating.value) return;

    // scrolling down and not expanded
    if (event.deltaY > 0 && !isExpanded.value) {
      isAnimating.value = true;
      isExpanded.value = true;
      setTimeout(() => {
        isAnimating.value = false;
      }, 500);
    }
    // scrolling up and expanded
    else if (event.deltaY < 0 && isExpanded.value) {
      isAnimating.value = true;
      isExpanded.value = false;
      setTimeout(() => {
        isAnimating.value = false;
      }, 500);
    }

    // ensure it scrolls to the bottom
    nextTick(() => {
      scrollToBottom();
    });
  };

  // handle agent click
  const handleAgentClick = (agent: any) => {
    // block the action while sending or refreshing
    if (isSending.value) return;

    // ensure it scrolls to the bottom
    nextTick(() => {
      scrollToBottom();
    });

    router.push(agent.route);
  };

  // preset agents data
  const presetAgents = ref([
    {
      id: 1,
      name: t("chat.deepGenome"),
      icon: "Document",
      route: "/gene-display",
    },
    {
      id: 2,
      name: CANONICAL_AGENT_DISPLAY_NAMES.KnowledgeAgent,
      toolName: "KnowledgeAgent",
      icon: "Search",
      route: "/knowledge-agent",
    },
    {
      id: 3,
      name: CANONICAL_AGENT_DISPLAY_NAMES.DataAgent,
      toolName: "DataAgent",
      icon: "DataLine",
      route: "/data-agent",
    },
    {
      id: 4,
      name: CANONICAL_AGENT_DISPLAY_NAMES.AnalystAgent,
      toolName: "AnalystAgent",
      icon: "Edit",
      route: "/analyst-agent",
    },
    {
      id: 5,
      name: CANONICAL_AGENT_DISPLAY_NAMES.BriefGeneAgent,
      toolName: "BriefGeneAgent",
      icon: "Edit",
      route: "/brief-gene-agent",
    },
    {
      id: 6,
      name: CANONICAL_AGENT_DISPLAY_NAMES.GeneNetworkAgent,
      toolName: "GeneNetworkAgent",
      icon: "Edit",
      route: "/gene-network-agent",
    },
    {
      id: 7,
      name: CANONICAL_AGENT_DISPLAY_NAMES.DeepGenomeAgent,
      toolName: "DeepGenomeAgent",
      icon: "Edit",
      route: "/deep-genome-agent",
    },
    {
      id: 8,
      name: CANONICAL_AGENT_DISPLAY_NAMES.DigitalDesignAgent,
      toolName: "DigitalDesignAgent",
      icon: "Edit",
      route: "/digital-design-agent",
    },
  ]);

  // get the agent tooltip
  const getAgentTooltip = (agentName: string) => {
    const canonicalKey =
      CANONICAL_AGENT_I18N_KEYS[agentName as CanonicalAgentTool];
    if (canonicalKey) {
      return t(canonicalKey) || agentName;
    }

    // lowercase the first letter
    const agentKey = agentName.charAt(0).toLowerCase() + agentName.slice(1);
    return t(`chat.agents.${agentKey}`) || agentName;
  };

  // get the agent's image path
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

  // show the "more info" popup
  const showMoreInfo = (agentName: string) => {
    const displayName =
      CANONICAL_AGENT_DISPLAY_NAMES[agentName as CanonicalAgentTool] ||
      agentName;
    const messageBox = ElMessageBox.alert(
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

    // force the dialog size
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
    presetAgents,
    containerStyle,
    handleScroll,
    handleAgentClick,
    getAgentTooltip,
    showMoreInfo,
  };
}
