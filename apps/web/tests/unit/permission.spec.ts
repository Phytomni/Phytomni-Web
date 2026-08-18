import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { RouteLocationNormalized } from "vue-router";
import type {
  BotCapability,
  BotCapabilityByTool,
} from "@/views/chat/composables/useBotCapabilities";
import { buildRouteLocation } from "../helpers/mockFactories";

// Stub the real router so importing @/permission neither pulls route
// components nor registers a live navigation guard.
vi.mock("@/router", () => ({
  default: { beforeEach: vi.fn(), afterEach: vi.fn(), addRoute: vi.fn() },
}));
// getToken is the guard's auth signal.
vi.mock("@/utils", () => ({ getToken: vi.fn() }));
// Hand-stub the Pinia store factory (no real Pinia needed). Named with the
// "mock" prefix so vitest's vi.mock hoisting allows the reference.
type GuardStoreMock = {
  getUserTools: Mock<() => Promise<boolean>>;
  FedLogOut: Mock<() => Promise<boolean>>;
  roles: string[];
};

const mockStore: GuardStoreMock = {
  getUserTools: vi.fn(),
  FedLogOut: vi.fn(),
  roles: [],
};
vi.mock("@/stores", () => ({ userStore: () => mockStore }));
type CapabilitiesMock = {
  byTool: { value: BotCapabilityByTool };
  load: Mock<(force?: boolean) => Promise<BotCapability[]>>;
};

const mockCapabilities: CapabilitiesMock = {
  byTool: { value: {} },
  load: vi.fn(),
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

const mockGetToken = vi.mocked(getToken);
const mockElNotification = vi.mocked(ElNotification);
function route(
  path: string,
  extra: Partial<RouteLocationNormalized> = {}
): RouteLocationNormalized {
  return buildRouteLocation({
    path,
    fullPath: extra.fullPath ?? path,
    ...extra,
  });
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

  it("1: no token + whitelist path → allow navigation", async () => {
    mockGetToken.mockReturnValue(undefined);
    await expect(beforeEachGuard(route("/login"))).resolves.toBe(undefined);
  });

  it("1b: no token + /terms whitelist path → allow navigation", async () => {
    mockGetToken.mockReturnValue(undefined);
    await expect(beforeEachGuard(route("/terms"))).resolves.toBe(undefined);
  });

  it("2: no token + non-whitelist → redirect to /login with redirect query", async () => {
    mockGetToken.mockReturnValue(undefined);
    await expect(beforeEachGuard(route("/chat"))).resolves.toBe(
      "/login?redirect=/chat"
    );
  });

  it("3: token + first-login status 0 + non-allowed route → changePassword", async () => {
    mockGetToken.mockReturnValue("tok");
    localStorage.setItem("loginStatus", "0");
    await expect(
      beforeEachGuard(route("/chat", { name: "chat" }))
    ).resolves.toEqual({ name: "changePassword" });
  });

  it("4: token + guest-only path → safeRedirect to /chat", async () => {
    mockGetToken.mockReturnValue("tok");
    localStorage.setItem("loginStatus", "1");
    await expect(
      beforeEachGuard(route("/forgot-password", { name: "forgotPassword" }))
    ).resolves.toBe("/chat");
  });

  it("5: token + root path → replace to /chat", async () => {
    mockGetToken.mockReturnValue("tok");
    localStorage.setItem("loginStatus", "1");
    await expect(beforeEachGuard(route("/"))).resolves.toEqual({
      path: "/chat",
      replace: true,
    });
  });

  it("6: token + real route + getUserTools success → allow navigation (covers skipped S3)", async () => {
    mockGetToken.mockReturnValue("tok");
    localStorage.setItem("loginStatus", "1");
    mockStore.getUserTools.mockResolvedValue(true);
    const result = await beforeEachGuard(route("/chat", { name: "chat" }));
    expect(mockStore.getUserTools).toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it("7: token + real route + getUserTools failure → FedLogOut then /login (S4 fail-closed)", async () => {
    mockGetToken.mockReturnValue("tok");
    localStorage.setItem("loginStatus", "1");
    mockStore.getUserTools.mockRejectedValue(new Error("500"));
    const result = await beforeEachGuard(route("/chat", { name: "chat" }));
    expect(mockStore.FedLogOut).toHaveBeenCalled();
    expect(result).toEqual({
      path: "/login",
      query: { redirect: "/chat" },
    });
  });

  it("7b: FedLogOut failure still returns the fail-closed /login redirect", async () => {
    mockGetToken.mockReturnValue("tok");
    localStorage.setItem("loginStatus", "1");
    mockStore.getUserTools.mockRejectedValue(new Error("500"));
    mockStore.FedLogOut.mockRejectedValue(new Error("storage blocked"));

    await expect(
      beforeEachGuard(route("/chat", { name: "chat" }))
    ).resolves.toEqual({
      path: "/login",
      query: { redirect: "/chat" },
    });
  });

  it("8: localStorage throws → fail-open, does not force changePassword", async () => {
    mockGetToken.mockReturnValue("tok");
    const spy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    // guest-only path keeps this synchronous (no getUserTools branch).
    try {
      await expect(
        beforeEachGuard(route("/login", { name: "login" }))
      ).resolves.toBe("/chat");
    } finally {
      spy.mockRestore();
    }
  });

  it("9: token + first-login status 0 + changePassword route → allow without calling getUserTools (first-login gate)", async () => {
    mockGetToken.mockReturnValue("tok");
    localStorage.setItem("loginStatus", "0");
    // Backend first-login gate (apps/server/middleware/first_login_gate.go)
    // 403s getUserTools for login_status==='0'. The guard must reach
    // /change-password directly so the user can clear the flag — not probe the
    // gated endpoint, 403, FedLogOut and bounce to /login (the lockout bug).
    mockStore.getUserTools.mockRejectedValue(new Error("403"));
    const result = await beforeEachGuard(
      route("/change-password", { name: "changePassword" })
    );
    expect(mockStore.getUserTools).not.toHaveBeenCalled();
    expect(mockStore.FedLogOut).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it("10: first-login notification is closed on the post-logout /login transition", async () => {
    // Reset any notification handle leaked from a prior test (module-level
    // state survives vi.clearAllMocks): a /login nav clears it to null.
    mockGetToken.mockReturnValue(undefined);
    await beforeEachGuard(route("/login"));
    mockElNotification.mockClear();
    mockNotifClose.mockClear();

    // Show it: authed first-login user heading to a gated route.
    mockGetToken.mockReturnValue("tok");
    localStorage.setItem("loginStatus", "0");
    await beforeEachGuard(route("/chat", { name: "chat" }));
    expect(mockElNotification).toHaveBeenCalledTimes(1);

    // Logout clears the token; the guard must STILL close the stale
    // notification on the /login transition — the close runs unconditionally,
    // before the auth check, so it fires even in the unauthed branch. Remove
    // that close call and this assertion goes red.
    mockGetToken.mockReturnValue(undefined);
    await beforeEachGuard(route("/login", { name: "login" }));
    expect(mockNotifClose).toHaveBeenCalledTimes(1);
  });

  it("11: token + remote route without its role → safe NotFound redirect", async () => {
    mockGetToken.mockReturnValue("tok");
    localStorage.setItem("loginStatus", "1");
    mockStore.roles = [];
    const result = await beforeEachGuard(
      route("/gene-network-agent", { name: "geneNetworkAgent" })
    );
    expect(result).toEqual({ name: "NotFound" });
    expect(mockCapabilities.load).not.toHaveBeenCalled();
  });

  it("12: localStorage failure does not expose the caught error", async () => {
    mockGetToken.mockReturnValue("tok");
    const storageSpy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      await expect(
        beforeEachGuard(route("/login", { name: "login" }))
      ).resolves.toBe("/chat");
      expect(warn).not.toHaveBeenCalled();
    } finally {
      storageSpy.mockRestore();
      warn.mockRestore();
    }
  });
});
