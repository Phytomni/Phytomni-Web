import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { userStore } from "@/stores";
import { useTutorial } from "@/views/chat/composables/useTutorial";

describe("useTutorial", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    sessionStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens when seen_tutorial is 0 after checkTutorialStatus", () => {
    userStore().SET_SEEN_TUTORIAL("0");
    const t = useTutorial();
    t.checkTutorialStatus();
    vi.advanceTimersByTime(1000);
    expect(t.showTutorial.value).toBe(true);
  });

  it("consumes tutorial_pending and opens", () => {
    sessionStorage.setItem("tutorial_pending", "1");
    userStore().SET_SEEN_TUTORIAL("1");
    const t = useTutorial();
    t.checkTutorialStatus();
    vi.advanceTimersByTime(1000);
    expect(userStore().seen_tutorial).toBe("0");
    expect(t.showTutorial.value).toBe(true);
    expect(sessionStorage.getItem("tutorial_pending")).toBeNull();
  });

  it("completeTutorial closes and marks seen", () => {
    const t = useTutorial();
    t.startTutorial();
    t.completeTutorial();
    expect(t.showTutorial.value).toBe(false);
    expect(userStore().seen_tutorial).toBe("1");
  });

  it("prepares responsive navigation before opening the tour", () => {
    const beforeStart = vi.fn(() => {
      expect(tutorial.showTutorial.value).toBe(false);
    });

    const tutorial = useTutorial({ beforeStart });
    tutorial.startTutorial();

    expect(beforeStart).toHaveBeenCalledTimes(1);
    expect(tutorial.showTutorial.value).toBe(true);
  });

  it("also prepares responsive navigation for delayed first-run tours", () => {
    const beforeStart = vi.fn();
    userStore().SET_SEEN_TUTORIAL("0");
    const tutorial = useTutorial({ beforeStart });

    tutorial.checkTutorialStatus();
    vi.advanceTimersByTime(1000);

    expect(beforeStart).toHaveBeenCalledTimes(1);
    expect(tutorial.showTutorial.value).toBe(true);
  });
});
