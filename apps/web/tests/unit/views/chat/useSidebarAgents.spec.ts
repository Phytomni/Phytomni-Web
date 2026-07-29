import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CANONICAL_AGENT_CASE_ROUTES,
  deriveCaseRouteOptions,
} from "@/constants/agents";

const SIDEBAR_SOURCE = readFileSync(
  resolve(__dirname, "../../../../src/views/chat/ChatSidebar.vue"),
  "utf8"
);

describe("sidebar agent route options", () => {
  it("keeps static Explore Agents discovery visible to guest chat users", () => {
    expect(SIDEBAR_SOURCE).toContain(':can-explore-agents="true"');
  });

  it("derives eight formal Case routes from the canonical registry", () => {
    const options = deriveCaseRouteOptions();

    expect(options).toHaveLength(8);
    expect(options.map((option) => option.toolName)).toEqual([
      "KnowledgeAgent",
      "DataAgent",
      "AnalystAgent",
      "ReviewAgent",
      "GeneNetworkAgent",
      "BriefGeneAgent",
      "DeepGenomeAgent",
      "DigitalDesignAgent",
    ]);
    for (const option of options) {
      expect(option.route).toBe(CANONICAL_AGENT_CASE_ROUTES[option.toolName]);
      expect(option.name).toBeTruthy();
      expect(option.media).toBeTruthy();
    }
    expect(
      options.find((option) => option.toolName === "GeneNetworkAgent")?.route
    ).toBe("/cases/gene-network-agent");
    expect(
      options.find((option) => option.toolName === "DigitalDesignAgent")?.route
    ).toBe("/cases/digital-design-agent");

    const briefGene = options.find(
      (option) => option.toolName === "BriefGeneAgent"
    );
    expect(briefGene?.media).toEqual({ kind: "monogram", text: "BG" });

    for (const option of options.filter(
      (item) => item.toolName !== "BriefGeneAgent"
    )) {
      expect(option.media.kind).toBe("image");
    }
  });

  it("keeps list visibility and navigation reset in the active sidebar", () => {
    expect(SIDEBAR_SOURCE).toContain(
      "const presetAgents = ref(deriveCaseRouteOptions())"
    );
    expect(SIDEBAR_SOURCE).toContain(
      "showAgentsList.value = !showAgentsList.value"
    );
    expect(SIDEBAR_SOURCE).toContain("router.push(agent.route)");
    expect(SIDEBAR_SOURCE).toContain("showAgentsList.value = false");
  });
});
