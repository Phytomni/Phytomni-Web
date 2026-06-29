import { describe, it, expect, vi } from "vitest";
import type { Router } from "vue-router";
import { useSidebarNavigation } from "@/views/chat/composables/useSidebarNavigation";

describe("useSidebarNavigation", () => {
  function makeRouter() {
    return { push: vi.fn(), replace: vi.fn() } as unknown as Router;
  }

  function makeUserStore(permissions: string[] = []) {
    return {
      permission_list: permissions,
      FedLogOut: vi.fn().mockResolvedValue(undefined),
    };
  }

  function makeOpts(
    router: Router,
    userStore: ReturnType<typeof makeUserStore>,
    overrides: Partial<{
      onStartNewChat: () => void;
      onStartTutorial: () => void;
      onSelectChat: (id: string) => void;
    }> = {}
  ) {
    return {
      router,
      userStore,
      onStartNewChat: vi.fn(),
      onStartTutorial: vi.fn(),
      onSelectChat: vi.fn(),
      ...overrides,
    };
  }

  // hasPermission
  it("hasPermission returns true when the permission is in the list", () => {
    const router = makeRouter();
    const userStore = makeUserStore(["User management", "System monitor"]);
    const { hasPermission } = useSidebarNavigation(makeOpts(router, userStore));
    expect(hasPermission("User management")).toBe(true);
    expect(hasPermission("System monitor")).toBe(true);
  });

  it("hasPermission returns false when the permission is not in the list", () => {
    const router = makeRouter();
    const userStore = makeUserStore([]);
    const { hasPermission } = useSidebarNavigation(makeOpts(router, userStore));
    expect(hasPermission("User management")).toBe(false);
  });

  // handleCommand — permission-gated: userManagement
  it("handleCommand('userManagement') navigates to /user-list when permitted", () => {
    const router = makeRouter();
    const userStore = makeUserStore(["User management"]);
    const { handleCommand } = useSidebarNavigation(makeOpts(router, userStore));
    handleCommand("userManagement");
    expect(router.push).toHaveBeenCalledWith("/user-list");
  });

  it("handleCommand('userManagement') does not navigate without permission", () => {
    const router = makeRouter();
    const userStore = makeUserStore([]);
    const { handleCommand } = useSidebarNavigation(makeOpts(router, userStore));
    handleCommand("userManagement");
    expect(router.push).not.toHaveBeenCalled();
  });

  // handleCommand — permission-gated: systemMonitor
  it("handleCommand('systemMonitor') navigates to /log-list when permitted", () => {
    const router = makeRouter();
    const userStore = makeUserStore(["System monitor"]);
    const { handleCommand } = useSidebarNavigation(makeOpts(router, userStore));
    handleCommand("systemMonitor");
    expect(router.push).toHaveBeenCalledWith("/log-list");
  });

  it("handleCommand('systemMonitor') does not navigate without permission", () => {
    const router = makeRouter();
    const userStore = makeUserStore([]);
    const { handleCommand } = useSidebarNavigation(makeOpts(router, userStore));
    handleCommand("systemMonitor");
    expect(router.push).not.toHaveBeenCalled();
  });

  // handleCommand — ungated: feedback
  it("handleCommand('feedback') navigates to /feedback without requiring permission", () => {
    const router = makeRouter();
    const userStore = makeUserStore([]);
    const { handleCommand } = useSidebarNavigation(makeOpts(router, userStore));
    handleCommand("feedback");
    expect(router.push).toHaveBeenCalledWith("/feedback");
  });

  // handleCommand — ungated: changePassword
  it("handleCommand('changePassword') navigates to /change-password without requiring permission", () => {
    const router = makeRouter();
    const userStore = makeUserStore([]);
    const { handleCommand } = useSidebarNavigation(makeOpts(router, userStore));
    handleCommand("changePassword");
    expect(router.push).toHaveBeenCalledWith("/change-password");
  });

  // handleCommand — logout
  it("handleCommand('logout') calls FedLogOut and then router.replace('/login') after it resolves", async () => {
    const router = makeRouter();
    const userStore = makeUserStore([]);
    const { handleCommand } = useSidebarNavigation(makeOpts(router, userStore));
    handleCommand("logout");
    expect(userStore.FedLogOut).toHaveBeenCalled();
    // flush the promise so finally() fires
    await Promise.resolve();
    expect(router.replace).toHaveBeenCalledWith("/login");
  });

  // emit-up callbacks
  it("startNewChat() calls the onStartNewChat callback", () => {
    const router = makeRouter();
    const userStore = makeUserStore([]);
    const opts = makeOpts(router, userStore);
    const { startNewChat } = useSidebarNavigation(opts);
    startNewChat();
    expect(opts.onStartNewChat).toHaveBeenCalled();
  });

  it("startTutorial() calls the onStartTutorial callback", () => {
    const router = makeRouter();
    const userStore = makeUserStore([]);
    const opts = makeOpts(router, userStore);
    const { startTutorial } = useSidebarNavigation(opts);
    startTutorial();
    expect(opts.onStartTutorial).toHaveBeenCalled();
  });

  it("selectChat(id) calls onSelectChat with the dialogue id", () => {
    const router = makeRouter();
    const userStore = makeUserStore([]);
    const opts = makeOpts(router, userStore);
    const { selectChat } = useSidebarNavigation(opts);
    selectChat("d1");
    expect(opts.onSelectChat).toHaveBeenCalledWith("d1");
  });

  // route-push handlers
  it("openKnowledgeBase() navigates to /gene-display", () => {
    const router = makeRouter();
    const userStore = makeUserStore([]);
    const { openKnowledgeBase } = useSidebarNavigation(makeOpts(router, userStore));
    openKnowledgeBase();
    expect(router.push).toHaveBeenCalledWith("/gene-display");
  });

  it("openFavorites() navigates to /favorites", () => {
    const router = makeRouter();
    const userStore = makeUserStore([]);
    const { openFavorites } = useSidebarNavigation(makeOpts(router, userStore));
    openFavorites();
    expect(router.push).toHaveBeenCalledWith("/favorites");
  });
});
