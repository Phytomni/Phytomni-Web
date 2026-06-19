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
  it("hasPermission 当权限在列表中时返回 true", () => {
    const router = makeRouter();
    const userStore = makeUserStore(["用户管理", "系统监控"]);
    const { hasPermission } = useSidebarNavigation(makeOpts(router, userStore));
    expect(hasPermission("用户管理")).toBe(true);
    expect(hasPermission("系统监控")).toBe(true);
  });

  it("hasPermission 当权限不在列表中时返回 false", () => {
    const router = makeRouter();
    const userStore = makeUserStore([]);
    const { hasPermission } = useSidebarNavigation(makeOpts(router, userStore));
    expect(hasPermission("用户管理")).toBe(false);
  });

  // handleCommand — permission-gated: userManagement
  it("handleCommand('userManagement') 有权限时跳转 /user-list", () => {
    const router = makeRouter();
    const userStore = makeUserStore(["用户管理"]);
    const { handleCommand } = useSidebarNavigation(makeOpts(router, userStore));
    handleCommand("userManagement");
    expect(router.push).toHaveBeenCalledWith("/user-list");
  });

  it("handleCommand('userManagement') 无权限时不跳转", () => {
    const router = makeRouter();
    const userStore = makeUserStore([]);
    const { handleCommand } = useSidebarNavigation(makeOpts(router, userStore));
    handleCommand("userManagement");
    expect(router.push).not.toHaveBeenCalled();
  });

  // handleCommand — permission-gated: systemMonitor
  it("handleCommand('systemMonitor') 有权限时跳转 /log-list", () => {
    const router = makeRouter();
    const userStore = makeUserStore(["系统监控"]);
    const { handleCommand } = useSidebarNavigation(makeOpts(router, userStore));
    handleCommand("systemMonitor");
    expect(router.push).toHaveBeenCalledWith("/log-list");
  });

  it("handleCommand('systemMonitor') 无权限时不跳转", () => {
    const router = makeRouter();
    const userStore = makeUserStore([]);
    const { handleCommand } = useSidebarNavigation(makeOpts(router, userStore));
    handleCommand("systemMonitor");
    expect(router.push).not.toHaveBeenCalled();
  });

  // handleCommand — ungated: feedback
  it("handleCommand('feedback') 无需权限跳转 /feedback", () => {
    const router = makeRouter();
    const userStore = makeUserStore([]);
    const { handleCommand } = useSidebarNavigation(makeOpts(router, userStore));
    handleCommand("feedback");
    expect(router.push).toHaveBeenCalledWith("/feedback");
  });

  // handleCommand — ungated: changePassword
  it("handleCommand('changePassword') 无需权限跳转 /change-password", () => {
    const router = makeRouter();
    const userStore = makeUserStore([]);
    const { handleCommand } = useSidebarNavigation(makeOpts(router, userStore));
    handleCommand("changePassword");
    expect(router.push).toHaveBeenCalledWith("/change-password");
  });

  // handleCommand — logout
  it("handleCommand('logout') 调用 FedLogOut 并在 resolve 后调用 router.replace('/login')", async () => {
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
  it("startNewChat() 调用 onStartNewChat 回调", () => {
    const router = makeRouter();
    const userStore = makeUserStore([]);
    const opts = makeOpts(router, userStore);
    const { startNewChat } = useSidebarNavigation(opts);
    startNewChat();
    expect(opts.onStartNewChat).toHaveBeenCalled();
  });

  it("startTutorial() 调用 onStartTutorial 回调", () => {
    const router = makeRouter();
    const userStore = makeUserStore([]);
    const opts = makeOpts(router, userStore);
    const { startTutorial } = useSidebarNavigation(opts);
    startTutorial();
    expect(opts.onStartTutorial).toHaveBeenCalled();
  });

  it("selectChat(id) 调用 onSelectChat 并传入对话 id", () => {
    const router = makeRouter();
    const userStore = makeUserStore([]);
    const opts = makeOpts(router, userStore);
    const { selectChat } = useSidebarNavigation(opts);
    selectChat("d1");
    expect(opts.onSelectChat).toHaveBeenCalledWith("d1");
  });

  // route-push handlers
  it("openKnowledgeBase() 跳转 /gene-display", () => {
    const router = makeRouter();
    const userStore = makeUserStore([]);
    const { openKnowledgeBase } = useSidebarNavigation(makeOpts(router, userStore));
    openKnowledgeBase();
    expect(router.push).toHaveBeenCalledWith("/gene-display");
  });

  it("openFavorites() 跳转 /favorites", () => {
    const router = makeRouter();
    const userStore = makeUserStore([]);
    const { openFavorites } = useSidebarNavigation(makeOpts(router, userStore));
    openFavorites();
    expect(router.push).toHaveBeenCalledWith("/favorites");
  });
});
