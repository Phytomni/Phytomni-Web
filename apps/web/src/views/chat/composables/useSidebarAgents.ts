import { ref } from "vue";
import type { Router } from "vue-router";
import { CANONICAL_AGENT_DISPLAY_NAMES } from "@/constants/agents";

export function useSidebarAgents(router: Router) {
  // 是否显示 agents 列表
  const showAgentsList = ref(false);

  // 切换 agents 列表显示
  const exploreAgent = () => {
    showAgentsList.value = !showAgentsList.value;
  };

  // 预设的 agents 数据(快捷入口,对应已注册路由)
  const presetAgents = ref([
    {
      id: 2,
      name: CANONICAL_AGENT_DISPLAY_NAMES.KnowledgeAgent,
      toolName: "KnowledgeAgent",
      icon: "Search",
      route: "/knowledge-agent",
      img: "/KnowledgeAgent.jpg",
    },
    {
      id: 3,
      name: CANONICAL_AGENT_DISPLAY_NAMES.DataAgent,
      toolName: "DataAgent",
      icon: "DataLine",
      route: "/data-agent",
      img: "/DataAgent.jpg",
    },
    {
      id: 4,
      name: CANONICAL_AGENT_DISPLAY_NAMES.AnalystAgent,
      toolName: "AnalystAgent",
      icon: "Edit",
      route: "/analyst-agent",
      img: "/AnalystAgent.jpg",
    },
    {
      id: 5,
      name: CANONICAL_AGENT_DISPLAY_NAMES.BriefGeneAgent,
      toolName: "BriefGeneAgent",
      icon: "Edit",
      route: "/brief-gene-agent",
      img: "/BriefGeneAgent.jpg",
    },
    {
      id: 6,
      name: CANONICAL_AGENT_DISPLAY_NAMES.GeneNetworkAgent,
      toolName: "GeneNetworkAgent",
      icon: "Edit",
      route: "/gene-network-agent",
      img: "/GeneNetworkAgent.jpg",
    },
    {
      id: 7,
      name: CANONICAL_AGENT_DISPLAY_NAMES.DeepGenomeAgent,
      toolName: "DeepGenomeAgent",
      icon: "Edit",
      route: "/deep-genome-agent",
      img: "/DeepGenomeAgent.jpg",
    },
    {
      id: 8,
      name: CANONICAL_AGENT_DISPLAY_NAMES.DigitalDesignAgent,
      toolName: "DigitalDesignAgent",
      icon: "Edit",
      route: "/digital-design-agent",
      img: "/DigitalDesignAgent.jpg",
    },
  ]);

  // 点击 agent 跳转
  const handleAgentClick = (agent: { route: string }) => {
    router.push(agent.route);
    showAgentsList.value = false;
  };

  return { showAgentsList, exploreAgent, presetAgents, handleAgentClick };
}
