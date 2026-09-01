import { describe, it, expect, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import userStore from "@/stores/user";
import { logout } from "@/api/login";

// FedLogOut's contract: best-effort clearing of localStorage + sessionStorage (a
// throw in one does not block the other); resolve(true) if all succeed, reject with
// the failing storage name(s) if any throw — the caller relies on this to proceed
// with the /login redirect in .finally. The cases below pin down these two semantics;
// any regression that turns reject into resolve, or returns early after the first
// throw, will go red.
describe("userStore.FedLogOut", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(logout).mockReset();
    vi.mocked(logout).mockResolvedValue({ code: 200, data: "logged out" });
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

  it("does not call the server logout on a local-only clear", async () => {
    const store = userStore();
    await expect(store.FedLogOut()).resolves.toBe(true);
    expect(logout).not.toHaveBeenCalled();
  });

  it("revokes the current token then clears local session on explicit logout", async () => {
    const store = userStore();
    await expect(store.FedLogOut({ revoke: true })).resolves.toBe(true);
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("still clears local session when server revoke fails", async () => {
    vi.mocked(logout).mockRejectedValueOnce(new Error("network"));
    const store = userStore();
    await expect(store.FedLogOut({ revoke: true })).resolves.toBe(true);
    expect(logout).toHaveBeenCalledTimes(1);
  });
});

vi.mock("@/api/chat", () => ({ getUserTool: vi.fn() }));
vi.mock("@/api/login", () => ({
  login: vi.fn(),
  logout: vi.fn(),
}));
import { getUserTool } from "@/api/chat";
const mockGetUserTool = vi.mocked(getUserTool);

describe("userStore.expertEnabled", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it("defaults to true", () => {
    expect(userStore().expertEnabled).toBe(true);
  });

  it("is set from the tool-permissions expert_enabled flag", async () => {
    mockGetUserTool.mockResolvedValue({
      code: 200,
      data: {
        permission: "user",
        tool_list: [],
        permission_list: [],
        expert_enabled: true,
      },
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
    mockGetUserTool.mockResolvedValue({
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

  it("orders the server-issued effective list and drops unknown tool names", async () => {
    mockGetUserTool.mockResolvedValue({
      code: 200,
      data: {
        permission: "user",
        tool_list: [
          "ReviewAgent",
          "UnknownAgent",
          "ChatAgent",
          "KnowledgeAgent",
        ],
      },
    });

    const store = userStore();
    await store.getUserTools();

    expect(store.roles).toEqual(["ChatAgent", "KnowledgeAgent", "ReviewAgent"]);
  });

  it("does not add tools that were absent from the server-issued effective list", async () => {
    mockGetUserTool.mockResolvedValue({
      code: 200,
      data: {
        permission: "user",
        tool_list: ["KnowledgeAgent"],
      },
    });

    const store = userStore();
    await store.getUserTools();

    expect(store.roles).toEqual(["KnowledgeAgent"]);
    expect(store.roles).not.toContain("ChatAgent");
  });

  it("keeps an empty effective list empty after permissions finish loading", async () => {
    mockGetUserTool.mockResolvedValue({
      code: 200,
      data: {
        permission: "user",
        tool_list: [],
      },
    });

    const store = userStore();
    await store.getUserTools();

    expect(store.roles).toEqual([]);
    expect(store.rolesLoading).toBe(false);
    expect(store.rolesLoadFailed).toBe(false);
  });

  it("exposes loading and failure states when permission retrieval rejects", async () => {
    let rejectRequest: (error: Error) => void = () => undefined;
    mockGetUserTool.mockReturnValue(
      new Promise((_, reject) => {
        rejectRequest = reject;
      }) as ReturnType<typeof getUserTool>
    );
    const store = userStore();
    const request = store.getUserTools();

    expect(store.rolesLoading).toBe(true);
    expect(store.rolesLoadFailed).toBe(false);

    rejectRequest(new Error("offline"));
    await expect(request).rejects.toThrow("offline");

    expect(store.rolesLoading).toBe(false);
    expect(store.rolesLoadFailed).toBe(true);
  });

  it("keeps a server-authorized remote product visible without Bot capability state", async () => {
    mockGetUserTool.mockResolvedValue({
      code: 200,
      data: {
        permission: "user",
        tool_list: ["InSilicoResearchAgent"],
      },
    });

    const store = userStore();
    await store.getUserTools();

    expect(store.roles).toEqual(["InSilicoResearchAgent"]);
  });
});
