import { ref, computed, nextTick } from "vue";
import type { WritableComputedRef } from "vue";
import type { Router } from "vue-router";
import { ElMessageBox } from "element-plus";
import ChatAgentImg from "@/assets/images/chat/ChatAgent.png";
import KnowledgeAgentImg from "@/assets/images/chat/KnowledgeAgent.png";
import DataAgentImg from "@/assets/images/chat/DataAgent.png";
import AnalystAgentImg from "@/assets/images/chat/AnalystAgent.png";
import ReviewAgentImg from "@/assets/images/chat/ReviewAgent.png";
import BriefReviewAgentImg from "@/assets/images/chat/BriefReviewAgent.png";
import DeepGenomeAgentImg from "@/assets/images/chat/DeepGenomeAgent.png";
import InSilicoResearchAgentImg from "@/assets/images/chat/InSilicoResearchAgent.png";
import GeneNetworkAgentImg from "@/assets/images/chat/GeneNetworkAgent.png";
import DigitalDesignAgentImg from "@/assets/images/chat/DigitalDesignAgent.png";
import DefaultAgentImg from "@/assets/images/chat/Agents.png";

export function useAgentsPanel(opts: {
  t: (key: string) => string;
  isSending: WritableComputedRef<boolean>;
  router: Router;
  scrollToBottom: () => void;
}) {
  const { t, isSending, router, scrollToBottom } = opts;

  // 基础高度
  const baseHeight = 140;
  // 展开时的高度
  const expandedHeight = 480;
  // 额外的覆盖高度
  const overlayHeight = 10;

  // 是否展开
  const isExpanded = ref(false);

  // 是否正在动画中
  const isAnimating = ref(false);

  // 计算当前容器高度
  const containerHeight = computed(() => {
    return isExpanded.value ? expandedHeight : baseHeight;
  });

  // 计算当前容器的样式
  const containerStyle = computed(() => ({
    height: `${containerHeight.value}px`,
    transform: isExpanded.value ? `translateY(-${overlayHeight}px)` : "none",
  }));

  // 处理滚动
  const handleScroll = (event: WheelEvent) => {
    if (isAnimating.value) return;

    // 向下滚动且未展开
    if (event.deltaY > 0 && !isExpanded.value) {
      isAnimating.value = true;
      isExpanded.value = true;
      setTimeout(() => {
        isAnimating.value = false;
      }, 500);
    }
    // 向上滚动且已展开
    else if (event.deltaY < 0 && isExpanded.value) {
      isAnimating.value = true;
      isExpanded.value = false;
      setTimeout(() => {
        isAnimating.value = false;
      }, 500);
    }

    // 确保滚动到底部
    nextTick(() => {
      scrollToBottom();
    });
  };

  // 处理agent点击
  const handleAgentClick = (agent: any) => {
    // 如果正在发送或刷新，阻止操作
    if (isSending.value) return;

    // 确保滚动到底部
    nextTick(() => {
      scrollToBottom();
    });

    router.push(agent.route);
  };

  // 预设的agents数据
  const presetAgents = ref([
    {
      id: 1,
      name: t("chat.geneDetail"),
      icon: "Document",
      route: "/gene-display",
    },
    {
      id: 2,
      name: "Knowledge Agent",
      icon: "Search",
      route: "/knowledge-agent",
    },
    {
      id: 3,
      name: "Data Agent",
      icon: "DataLine",
      route: "/data-agent",
    },
    {
      id: 4,
      name: "Analyst Agent",
      icon: "Edit",
      route: "/analyst-agent",
    },
    {
      id: 5,
      name: "Brief Review Agent",
      icon: "Edit",
      route: "/brief-review-agent",
    },
    {
      id: 6,
      name: "Gene Network Agent",
      icon: "Edit",
      route: "/gene-network-agent",
    },
    {
      id: 7,
      name: "Deep Genome Agent",
      icon: "Edit",
      route: "/deep-genome-agent",
    },
    {
      id: 8,
      name: "Digital Design Agent",
      icon: "Edit",
      route: "/digital-design-agent",
    },
  ]);

  // 获取智能体提示信息
  const getAgentTooltip = (agentName: string) => {
    //首字母小写
    const agentKey = agentName.charAt(0).toLowerCase() + agentName.slice(1);
    return t(`chat.agents.${agentKey}`) || agentName;
  };

  // 获取智能体对应的图片路径
  const getAgentImage = (agentName: string) => {
    const imageMap: Record<string, string> = {
      ChatAgent: ChatAgentImg,
      KnowledgeAgent: KnowledgeAgentImg,
      DataAgent: DataAgentImg,
      AnalystAgent: AnalystAgentImg,
      ReviewAgent: ReviewAgentImg,
      BriefReviewAgent: BriefReviewAgentImg,
      DeepGenomeAgent: DeepGenomeAgentImg,
      InSilicoResearchAgent: InSilicoResearchAgentImg,
      GeneNetworkAgent: GeneNetworkAgentImg,
      DigitalDesignAgent: DigitalDesignAgentImg,
    };

    return imageMap[agentName] || DefaultAgentImg;
  };

  // 显示更多信息弹出窗口
  const showMoreInfo = (agentName: string) => {
    const messageBox = ElMessageBox.alert(
      `<div class="agent-info-dialog">
      <div class="agent-detail">
        <div class="agent-description">
          <p>${getAgentTooltip(agentName)}</p>
        </div>
        <div class="agent-image">
          <img src="${getAgentImage(
            agentName
          )}" style="width: 100%; height: 300px;" alt="${agentName}">
        </div>
      </div>
    </div>`,
      agentName,
      {
        dangerouslyUseHTMLString: true,
        confirmButtonText: t("common.close"),
        customClass: "agent-info-dialog",
      }
    );

    // 强制设置弹窗尺寸
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
