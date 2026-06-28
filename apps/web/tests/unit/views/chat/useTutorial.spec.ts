import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { useTutorial } from "@/views/chat/composables/useTutorial";

// Harness: a lightweight component that only calls useTutorial, so the
// onMounted/onUnmounted lifecycle hooks fire correctly on mount/unmount.
const Harness = defineComponent({
  setup() {
    useTutorial();
    return () => null;
  },
});

describe("useTutorial keydown listener lifecycle", () => {
  let addSpy: ReturnType<typeof vi.spyOn>;
  let removeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Activate a fresh Pinia instance before each test (needed by useTutorial's internal userStore())
    setActivePinia(createPinia());
    addSpy = vi.spyOn(document, "addEventListener");
    removeSpy = vi.spyOn(document, "removeEventListener");
  });

  afterEach(() => {
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it("adds the keydown listener on mount and removes the SAME handler on unmount (no leak)", () => {
    const wrapper = mount(Harness);

    // After mount there should be exactly one keydown add
    const keydownAdds = addSpy.mock.calls.filter((c) => c[0] === "keydown");
    expect(keydownAdds.length).toBe(1);
    const handler = keydownAdds[0][1];

    wrapper.unmount();

    // After unmount there should be exactly one keydown remove, with the same function reference
    const keydownRemoves = removeSpy.mock.calls.filter(
      (c) => c[0] === "keydown"
    );
    expect(keydownRemoves.length).toBe(1);
    // The removed handler must be exactly the one added (same reference), otherwise the leak persists
    expect(keydownRemoves[0][1]).toBe(handler);
  });
});
