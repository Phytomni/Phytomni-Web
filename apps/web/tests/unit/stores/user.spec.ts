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
