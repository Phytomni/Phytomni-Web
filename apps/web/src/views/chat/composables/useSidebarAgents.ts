import { ref } from "vue";
import type { Router } from "vue-router";
import { CANONICAL_AGENT_DISPLAY_NAMES } from "@/constants/agents";

export function useSidebarAgents(router: Router) {
  // whether to show the agents list
  const showAgentsList = ref(false);

  // toggle the agents list
  const exploreAgent = () => {
    showAgentsList.value = !showAgentsList.value;
  };

  // preset agents data (quick links to registered routes)
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

  // navigate on agent click
  const handleAgentClick = (agent: { route: string }) => {
    router.push(agent.route);
    showAgentsList.value = false;
  };

  return { showAgentsList, exploreAgent, presetAgents, handleAgentClick };
}
