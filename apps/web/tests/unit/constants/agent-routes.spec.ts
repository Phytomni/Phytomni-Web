import { describe, expect, it } from "vitest";
import router from "@/router";
import {
  CANONICAL_AGENT_ROUTES,
  deriveSidebarRouteOptions,
} from "@/constants/agents";

describe("CANONICAL_AGENT_ROUTES registry lock", () => {
  it("has exactly the seven approved tool→route pairs byte-for-byte", () => {
    expect(CANONICAL_AGENT_ROUTES).toEqual({
      KnowledgeAgent: "/knowledge-agent",
      DataAgent: "/data-agent",
      AnalystAgent: "/analyst-agent",
      BriefGeneAgent: "/brief-gene-agent",
      GeneNetworkAgent: "/gene-network-agent",
      DeepGenomeAgent: "/deep-genome-agent",
      DigitalDesignAgent: "/digital-design-agent",
    });
    expect(Object.keys(CANONICAL_AGENT_ROUTES)).toHaveLength(7);
  });

  it("resolves every route value to an active router record", () => {
    for (const route of Object.values(CANONICAL_AGENT_ROUTES)) {
      const resolved = router.resolve(route);
      expect(resolved.matched.length, route).toBeGreaterThan(0);
    }
  });

  it("derives seven sidebar route options from the registry", () => {
    const options = deriveSidebarRouteOptions();
    expect(options).toHaveLength(7);
    for (const option of options) {
      expect(option.route).toBe(CANONICAL_AGENT_ROUTES[option.toolName]);
      expect(option.name).toBeTruthy();
      expect(option.img).toBeTruthy();
    }
  });
});
