import { describe, it, expect, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import userStore from "@/stores/user";

// FedLogOut 的契约:尽力清空 localStorage + sessionStorage(best-effort,
// 一处抛错不阻断另一处),全部成功则 resolve(true),任一抛错则带上失败的
// 存储名 reject —— 调用方据此在 .finally 里继续跳转 /login。下面的用例钉死
// 这两条语义,任何把 reject 改成 resolve、或第一处抛错后提前返回的回归都会变红。
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
