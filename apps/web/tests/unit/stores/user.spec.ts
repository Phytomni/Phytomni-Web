import { describe, it, expect, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import userStore from "@/stores/user";

// FedLogOut's contract: best-effort clearing of localStorage + sessionStorage (a
// throw in one does not block the other); resolve(true) if all succeed, reject with
// the failing storage name(s) if any throw — the caller relies on this to proceed
// with the /login redirect in .finally. The cases below pin down these two semantics;
// any regression that turns reject into resolve, or returns early after the first
// throw, will go red.
describe("userStore.FedLogOut", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("resolves true when both storage clears succeed", async () => {
    const store = userStore();
    await expect(store.FedLogOut()).resolves.toBe(true);
  });

  it("rejects naming localStorage when localStorage.clear throws", async () => {
    vi.spyOn(window.localStorage, "clear").mockImplementation(() => {
      throw new Error("denied");
    });
    const store = userStore();
    await expect(store.FedLogOut()).rejects.toThrow(/localStorage/);
  });

  it("rejects naming sessionStorage when sessionStorage.clear throws", async () => {
    vi.spyOn(window.sessionStorage, "clear").mockImplementation(() => {
      throw new Error("denied");
    });
    const store = userStore();
    await expect(store.FedLogOut()).rejects.toThrow(/sessionStorage/);
  });

  it("names both stores when both clears throw", async () => {
    vi.spyOn(window.localStorage, "clear").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(window.sessionStorage, "clear").mockImplementation(() => {
      throw new Error("denied");
    });
    const store = userStore();
    await expect(store.FedLogOut()).rejects.toThrow(
      /localStorage.*sessionStorage/
    );
  });

  it("attempts sessionStorage.clear even after localStorage.clear throws (best-effort)", async () => {
    vi.spyOn(window.localStorage, "clear").mockImplementation(() => {
      throw new Error("denied");
    });
    const sessionClear = vi.spyOn(window.sessionStorage, "clear");
    const store = userStore();
    await expect(store.FedLogOut()).rejects.toThrow();
    expect(sessionClear).toHaveBeenCalled();
  });
});

vi.mock("@/api/chat", () => ({ getUserTool: vi.fn() }));
import { getUserTool } from "@/api/chat";

describe("userStore.expertEnabled", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it("defaults to false", () => {
    expect(userStore().expertEnabled).toBe(false);
  });

  it("is set from the tool-permissions expert_enabled flag", async () => {
    (getUserTool as any).mockResolvedValue({
      code: 200,
      data: { permission: "user", tool_list: [], permission_list: [], expert_enabled: true },
    });
    const store = userStore();
    await store.getUserTools();
    expect(store.expertEnabled).toBe(true);
  });
});

describe("userStore.isFirstLogin", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  it("is true when login_status is 0", () => {
    const store = userStore();
    store.SET_LOGIN_STATUS("0");
    expect(store.isFirstLogin).toBe(true);
  });

  it("is false when login_status is 1", () => {
    const store = userStore();
    store.SET_LOGIN_STATUS("1");
    expect(store.isFirstLogin).toBe(false);
  });
});

describe("userStore.getUserTools $patch end-state", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it("sets permission, roles, permission_list, and expertEnabled together", async () => {
    (getUserTool as any).mockResolvedValue({
      code: 200,
      data: {
        permission: "admin",
        tool_list: ["ChatAgent"],
        permission_list: ["p1"],
        expert_enabled: true,
      },
    });
    const store = userStore();
    await store.getUserTools();
    expect(store.permission).toBe("admin");
    expect(store.roles).toEqual(["ChatAgent"]);
    expect(store.permission_list).toEqual(["p1"]);
    expect(store.expertEnabled).toBe(true);
  });
});
