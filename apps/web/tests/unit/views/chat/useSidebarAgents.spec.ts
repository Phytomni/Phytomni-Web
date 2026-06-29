import { describe, it, expect, vi } from "vitest";
import type { Router } from "vue-router";
import { useSidebarAgents } from "@/views/chat/composables/useSidebarAgents";

describe("useSidebarAgents", () => {
  function makeRouter() {
    return { push: vi.fn() } as unknown as Router;
  }

  it("showAgentsList is initially false", () => {
    const router = makeRouter();
    const { showAgentsList } = useSidebarAgents(router);
    expect(showAgentsList.value).toBe(false);
  });

  it("exploreAgent() toggles showAgentsList (false→true→false)", () => {
    const router = makeRouter();
    const { showAgentsList, exploreAgent } = useSidebarAgents(router);
    expect(showAgentsList.value).toBe(false);
    exploreAgent();
    expect(showAgentsList.value).toBe(true);
    exploreAgent();
    expect(showAgentsList.value).toBe(false);
  });

  it("presetAgents has 7 entries, each with route, name, and img", () => {
    const router = makeRouter();
    const { presetAgents } = useSidebarAgents(router);
    expect(presetAgents.value).toHaveLength(7);
    for (const agent of presetAgents.value) {
      expect(agent).toHaveProperty("route");
      expect(agent).toHaveProperty("name");
      expect(agent).toHaveProperty("img");
    }
  });

  it("handleAgentClick calls router.push and resets showAgentsList to false", () => {
    const router = makeRouter();
    const { showAgentsList, exploreAgent, handleAgentClick } = useSidebarAgents(router);

    // First open the list
    exploreAgent();
    expect(showAgentsList.value).toBe(true);

    // After clicking, navigate and close the list
    handleAgentClick({ route: "/x" });
    expect(router.push).toHaveBeenCalledWith("/x");
    expect(showAgentsList.value).toBe(false);
  });
});
