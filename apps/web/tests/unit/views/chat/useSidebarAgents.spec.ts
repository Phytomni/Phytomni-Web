import { describe, it, expect, vi } from "vitest";
import type { Router } from "vue-router";
import { useSidebarAgents } from "@/views/chat/composables/useSidebarAgents";

describe("useSidebarAgents", () => {
  function makeRouter() {
    return { push: vi.fn() } as unknown as Router;
  }

  it("showAgentsList 初始值为 false", () => {
    const router = makeRouter();
    const { showAgentsList } = useSidebarAgents(router);
    expect(showAgentsList.value).toBe(false);
  });

  it("exploreAgent() 切换 showAgentsList(false→true→false)", () => {
    const router = makeRouter();
    const { showAgentsList, exploreAgent } = useSidebarAgents(router);
    expect(showAgentsList.value).toBe(false);
    exploreAgent();
    expect(showAgentsList.value).toBe(true);
    exploreAgent();
    expect(showAgentsList.value).toBe(false);
  });

  it("presetAgents 有 7 个条目，每条均含 route、name、img", () => {
    const router = makeRouter();
    const { presetAgents } = useSidebarAgents(router);
    expect(presetAgents.value).toHaveLength(7);
    for (const agent of presetAgents.value) {
      expect(agent).toHaveProperty("route");
      expect(agent).toHaveProperty("name");
      expect(agent).toHaveProperty("img");
    }
  });

  it("handleAgentClick 调用 router.push 并将 showAgentsList 重置为 false", () => {
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
