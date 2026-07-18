import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CANONICAL_AGENT_ROUTES,
  deriveSidebarRouteOptions,
} from "@/constants/agents";

const SIDEBAR_SOURCE = readFileSync(
  resolve(__dirname, "../../../../src/views/chat/sidebar.vue"),
  "utf8"
);

describe("sidebar agent route options", () => {
  it("derives seven routed options from the canonical registry", () => {
    const options = deriveSidebarRouteOptions();

    expect(options).toHaveLength(7);
    for (const option of options) {
      expect(option.route).toBe(CANONICAL_AGENT_ROUTES[option.toolName]);
      expect(option.name).toBeTruthy();
      expect(option.img).toBeTruthy();
    }
  });

  it("keeps list visibility and navigation reset in the active sidebar", () => {
    expect(SIDEBAR_SOURCE).toContain(
      "const presetAgents = ref(deriveSidebarRouteOptions())"
    );
    expect(SIDEBAR_SOURCE).toContain(
      "showAgentsList.value = !showAgentsList.value"
    );
    expect(SIDEBAR_SOURCE).toContain("router.push(agent.route)");
    expect(SIDEBAR_SOURCE).toContain("showAgentsList.value = false");
  });
});
