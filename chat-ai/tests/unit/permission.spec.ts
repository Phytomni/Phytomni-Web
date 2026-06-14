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
const mockStore = { getUserTools: vi.fn(), FedLogOut: vi.fn() };
vi.mock("@/stores", () => ({ userStore: () => mockStore }));
// Keep i18n light — the first-login branch calls i18n.global.t.
vi.mock("@/locales", () => ({ i18n: { global: { t: (k: string) => k } } }));
// Avoid real ElNotification DOM side effects.
vi.mock("element-plus", () => ({
  ElNotification: vi.fn(() => ({ close: vi.fn() })),
}));

import { beforeEachGuard } from "@/permission";
import { getToken } from "@/utils";

const mockGetToken = getToken as unknown as ReturnType<typeof vi.fn>;
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
    mockStore.getUserTools.mockResolvedValue(true);
    mockStore.FedLogOut.mockResolvedValue(true);
  });

  it("1: no token + whitelist path → next() with no arg", () => {
    mockGetToken.mockReturnValue(false);
    const next = vi.fn();
    beforeEachGuard(route("/login") as any, route("/") as any, next as any);
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
    // Backend first-login gate (nky_client_go middleware/first_login_gate.go)
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
});
