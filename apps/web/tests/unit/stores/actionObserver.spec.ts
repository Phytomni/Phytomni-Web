import { describe, it, expect, vi, beforeEach } from "vitest";
import { createApp } from "vue";
import { createPinia, defineStore, setActivePinia } from "pinia";
import { createActionObserverPlugin } from "@/stores/actionObserver";

const useProbe = defineStore("probe", {
  actions: {
    ok() {
      return 1;
    },
    fail() {
      throw new Error("boom");
    },
  },
});

describe("createActionObserverPlugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports action name and error message without args", async () => {
    const sink = vi.fn();
    const pinia = createPinia();
    pinia.use(createActionObserverPlugin(sink));
    createApp({}).use(pinia);
    setActivePinia(pinia);
    const store = useProbe();
    expect(() => store.fail()).toThrow("boom");
    expect(sink).toHaveBeenCalledTimes(1);
    const payload = sink.mock.calls[0][0];
    expect(payload).toEqual({ actionName: "fail", errorMessage: "boom" });
    expect(payload).not.toHaveProperty("args");
  });

  it("does not call sink on successful actions", () => {
    const sink = vi.fn();
    const pinia = createPinia();
    pinia.use(createActionObserverPlugin(sink));
    createApp({}).use(pinia);
    setActivePinia(pinia);
    useProbe().ok();
    expect(sink).not.toHaveBeenCalled();
  });

  it("swallows sink errors so the original action error still propagates", () => {
    const sink = vi.fn(() => {
      throw new Error("sink-broke");
    });
    const pinia = createPinia();
    pinia.use(createActionObserverPlugin(sink));
    createApp({}).use(pinia);
    setActivePinia(pinia);
    expect(() => useProbe().fail()).toThrow("boom");
  });
});
