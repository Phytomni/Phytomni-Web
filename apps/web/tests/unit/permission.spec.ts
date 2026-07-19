import { describe, it, expect, vi, beforeEach } from "vitest";

// Stub the real router so importing @/permission neither pulls route
// components nor registers a live navigation guard.
vi.mock("@/router", () => ({
  default: { beforeEach: vi.fn(), afterEach: vi.fn(), addRoute: vi.fn() },
}));
// getToken is the guard's auth signal.
vi.mock("@/utils", () => ({ getToken: vi.fn() }));
// Hand-stub the Pinia store factory (no real Pinia needed). Named with the
// "mock" prefix so vitest's vi.mock hoisting allows the reference.
const mockStore = {
  getUserTools: vi.fn(),
  FedLogOut: vi.fn(),
  roles: [] as string[],
};
vi.mock("@/stores", () => ({ userStore: () => mockStore }));
const mockCapabilities = {
  byTool: { value: {} as Record<string, unknown> },
  load: vi.fn().mockResolvedValue([]),
};
vi.mock("@/views/chat/composables/useBotCapabilities", () => ({
  useBotCapabilities: () => mockCapabilities,
}));
// Keep i18n light — the first-login branch calls i18n.global.t.
vi.mock("@/locales", () => ({ i18n: { global: { t: (k: string) => k } } }));
// Avoid real ElNotification DOM side effects. mockNotifClose is a STABLE close
// spy (hoisted so the eager reference inside the factory is TDZ-safe) shared by
// every notification handle, so a test can assert the guard closed it.
const { mockNotifClose } = vi.hoisted(() => ({ mockNotifClose: vi.fn() }));
vi.mock("element-plus", () => ({
  ElNotification: vi.fn(() => ({ close: mockNotifClose })),
}));

import { beforeEachGuard } from "@/permission";
import { getToken } from "@/utils";
import { ElNotification } from "element-plus";

const mockGetToken = getToken as unknown as ReturnType<typeof vi.fn>;
const mockElNotification = ElNotification as unknown as ReturnType<
  typeof vi.fn
>;
// setTimeout(0) flushes the microtask chain (guard calls next() inside
// getUserTools .then / .catch().finally).
const flush = () => new Promise((r) => setTimeout(r, 0));

function route(path: string, extra: Record<string, unknown> = {}) {
  return {
    path,
    name: (extra.name as string) ?? undefined,
    fullPath: (extra.fullPath as string) ?? path,
    query: (extra.query as Record<string, unknown>) ?? {},
  };
}

describe("beforeEachGuard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockStore.roles = [];
    mockCapabilities.byTool.value = {};
    mockStore.getUserTools.mockResolvedValue(true);
    mockStore.FedLogOut.mockResolvedValue(true);
    mockCapabilities.load.mockResolvedValue([]);
  });

  it("1: no token + whitelist path → next() with no arg", () => {
    mockGetToken.mockReturnValue(false);
    const next = vi.fn();
    beforeEachGuard(route("/login") as any, route("/") as any, next as any);
    expect(next).toHaveBeenCalledWith();
  });

  it("1b: no token + /terms whitelist path → next() with no arg", () => {
    mockGetToken.mockReturnValue(false);
    const next = vi.fn();
    beforeEachGuard(route("/terms") as any, route("/") as any, next as any);
    expect(next).toHaveBeenCalledWith();
  });

  it("2: no token + non-whitelist → redirect to /login with redirect query", () => {
    mockGetToken.mockReturnValue(false);
    const next = vi.fn();
    beforeEachGuard(route("/chat") as any, route("/") as any, next as any);
    expect(next).toHaveBeenCalledWith("/login?redirect=/chat");
  });

  it("3: token + first-login status 0 + non-allowed route → changePassword", () => {
    mockGetToken.mockReturnValue("tok");
    localStorage.setItem("loginStatus", "0");
    const next = vi.fn();
    beforeEachGuard(
      route("/chat", { name: "chat" }) as any,
      route("/") as any,
      next as any
    );
    expect(next).toHaveBeenCalledWith({ name: "changePassword" });
  });

  it("4: token + guest-only path → safeRedirect to /chat", () => {
    mockGetToken.mockReturnValue("tok");
    localStorage.setItem("loginStatus", "1");
    const next = vi.fn();
    beforeEachGuard(
      route("/forgot-password", { name: "forgotPassword" }) as any,
      route("/") as any,
      next as any
    );
    expect(next).toHaveBeenCalledWith("/chat");
  });

  it("5: token + root path → next() with no arg", () => {
    mockGetToken.mockReturnValue("tok");
    localStorage.setItem("loginStatus", "1");
    const next = vi.fn();
    beforeEachGuard(route("/") as any, route("/login") as any, next as any);
    expect(next).toHaveBeenCalledWith();
  });

  it("6: token + real route + getUserTools success → next() (covers skipped S3)", async () => {
    mockGetToken.mockReturnValue("tok");
    localStorage.setItem("loginStatus", "1");
    mockStore.getUserTools.mockResolvedValue(true);
    const next = vi.fn();
    beforeEachGuard(
      route("/chat", { name: "chat" }) as any,
      route("/") as any,
      next as any
    );
    await flush();
    expect(mockStore.getUserTools).toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
  });

  it("7: token + real route + getUserTools failure → FedLogOut then /login (S4 fail-closed)", async () => {
    mockGetToken.mockReturnValue("tok");
    localStorage.setItem("loginStatus", "1");
    mockStore.getUserTools.mockRejectedValue(new Error("500"));
    const next = vi.fn();
    beforeEachGuard(
      route("/chat", { name: "chat" }) as any,
      route("/") as any,
      next as any
    );
    await flush();
    expect(mockStore.FedLogOut).toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith({
      path: "/login",
      query: { redirect: "/chat" },
    });
  });

  it("8: localStorage throws → fail-open, does not force changePassword", () => {
    mockGetToken.mockReturnValue("tok");
    const spy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    const next = vi.fn();
    // guest-only path keeps this synchronous (no getUserTools branch).
    beforeEachGuard(
      route("/login", { name: "login" }) as any,
      route("/") as any,
      next as any
    );
    expect(next).not.toHaveBeenCalledWith({ name: "changePassword" });
    expect(next).toHaveBeenCalledWith("/chat");
    spy.mockRestore();
  });

  it("9: token + first-login status 0 + changePassword route → next() WITHOUT calling getUserTools (first-login gate)", async () => {
    mockGetToken.mockReturnValue("tok");
    localStorage.setItem("loginStatus", "0");
    // Backend first-login gate (apps/server/middleware/first_login_gate.go)
    // 403s getUserTools for login_status==='0'. The guard must reach
    // /change-password directly so the user can clear the flag — not probe the
    // gated endpoint, 403, FedLogOut and bounce to /login (the lockout bug).
    mockStore.getUserTools.mockRejectedValue(new Error("403"));
    const next = vi.fn();
    beforeEachGuard(
      route("/change-password", { name: "changePassword" }) as any,
      route("/login") as any,
      next as any
    );
    await flush();
    expect(mockStore.getUserTools).not.toHaveBeenCalled();
    expect(mockStore.FedLogOut).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
  });

  it("10: first-login notification is closed on the post-logout /login transition", () => {
    // Reset any notification handle leaked from a prior test (module-level
    // state survives vi.clearAllMocks): a /login nav clears it to null.
    mockGetToken.mockReturnValue(false);
    beforeEachGuard(route("/login") as any, route("/") as any, vi.fn() as any);
    mockElNotification.mockClear();
    mockNotifClose.mockClear();

    // Show it: authed first-login user heading to a gated route.
    mockGetToken.mockReturnValue("tok");
    localStorage.setItem("loginStatus", "0");
    const next = vi.fn();
    beforeEachGuard(
      route("/chat", { name: "chat" }) as any,
      route("/") as any,
      next as any
    );
    expect(mockElNotification).toHaveBeenCalledTimes(1);

    // Logout clears the token; the guard must STILL close the stale
    // notification on the /login transition — the close runs unconditionally,
    // before the auth check, so it fires even in the unauthed branch. Remove
    // that close call and this assertion goes red.
    mockGetToken.mockReturnValue(false);
    beforeEachGuard(
      route("/login", { name: "login" }) as any,
      route("/chat") as any,
      next as any
    );
    expect(mockNotifClose).toHaveBeenCalledTimes(1);
  });

  it("11: token + remote route without its role → safe NotFound redirect", async () => {
    mockGetToken.mockReturnValue("tok");
    localStorage.setItem("loginStatus", "1");
    mockStore.roles = [];
    const next = vi.fn();
    beforeEachGuard(
      route("/gene-network-agent", { name: "geneNetworkAgent" }) as any,
      route("/chat") as any,
      next as any
    );
    await flush();
    expect(next).toHaveBeenCalledWith({ name: "NotFound" });
    expect(mockCapabilities.load).not.toHaveBeenCalled();
  });

  it("12: localStorage failure does not expose the caught error", () => {
    mockGetToken.mockReturnValue("tok");
    const storageSpy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const next = vi.fn();

    try {
      beforeEachGuard(
        route("/login", { name: "login" }) as unknown as Parameters<
          typeof beforeEachGuard
        >[0],
        route("/") as unknown as Parameters<typeof beforeEachGuard>[1],
        next as unknown as Parameters<typeof beforeEachGuard>[2]
      );
      expect(next).toHaveBeenCalledWith("/chat");
      expect(warn).not.toHaveBeenCalled();
    } finally {
      storageSpy.mockRestore();
      warn.mockRestore();
    }
  });
});
