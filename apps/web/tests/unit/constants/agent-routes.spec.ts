import { describe, expect, it } from "vitest";
import router from "@/router";
import {
  CANONICAL_AGENT_ROUTES,
  deriveCaseRouteOptions,
  deriveSidebarRouteOptions,
} from "@/constants/agents";

describe("CANONICAL_AGENT_ROUTES registry lock", () => {
  it("has exactly the eight approved tool→route pairs byte-for-byte", () => {
    expect(CANONICAL_AGENT_ROUTES).toEqual({
      KnowledgeAgent: "/knowledge-agent",
      DataAgent: "/data-agent",
      AnalystAgent: "/analyst-agent",
      ReviewAgent: "/review-agent",
      BriefGeneAgent: "/brief-gene-agent",
      GeneNetworkAgent: "/gene-network-agent",
      DeepGenomeAgent: "/deep-genome-agent",
      DigitalDesignAgent: "/digital-design-agent",
    });
    expect(Object.keys(CANONICAL_AGENT_ROUTES)).toHaveLength(8);
  });

  it("resolves every route value to an active router record", () => {
    for (const route of Object.values(CANONICAL_AGENT_ROUTES)) {
      const resolved = router.resolve(route);
      expect(resolved.matched.length, route).toBeGreaterThan(0);
    }
  });

  it("derives eight sidebar route options from the registry", () => {
    const options = deriveSidebarRouteOptions();
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
      expect(option.route).toBe(CANONICAL_AGENT_ROUTES[option.toolName]);
      expect(option.name).toBeTruthy();
      expect(option.media).toBeTruthy();
    }
  });

  it("derives case options in fixed product order", () => {
    const caseOptions = deriveCaseRouteOptions();

    expect(caseOptions.map((option) => option.toolName)).toEqual([
      "KnowledgeAgent",
      "DataAgent",
      "AnalystAgent",
      "ReviewAgent",
      "GeneNetworkAgent",
      "BriefGeneAgent",
      "DeepGenomeAgent",
      "DigitalDesignAgent",
    ]);
    expect(caseOptions.map((option) => option.route)).toEqual([
      "/cases/knowledge-agent",
      "/cases/data-agent",
      "/cases/analyst-agent",
      "/cases/review-agent",
      "/cases/gene-network-agent",
      "/cases/brief-gene-agent",
      "/cases/deep-genome-agent",
      "/cases/digital-design-agent",
    ]);

    const briefGene = caseOptions.find(
      (option) => option.toolName === "BriefGeneAgent"
    );
    expect(briefGene?.media).toEqual({ kind: "monogram", text: "BG" });

    for (const option of caseOptions.filter(
      (item) => item.toolName !== "BriefGeneAgent"
    )) {
      expect(option.media.kind).toBe("image");
    }
  });
});
