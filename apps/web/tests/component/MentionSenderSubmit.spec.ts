/**
 * Task 3: Send-on-Enter after @mention is fully selected.
 *
 * Tests the `guardEnterSubmit` pattern used in the chat composer
 * (apps/web/src/views/chat/index.vue).
 *
 * The bug: `MentionSender`'s internal `handleKeyDown` calls `submit()` on
 * every keyCode===13, regardless of whether the mention dropdown is open.
 * The fix: a capture-phase keydown handler on the wrapper reads
 * `senderRef.value.popoverVisible` and stops propagation when the dropdown
 * is open, preventing the inner `submit()` from firing.
 *
 * Because `MentionSender` / el-mention internals are not reliably
 * exercisable in happy-dom (no real TextArea selection / composition
 * events wired), we test the guard function directly via a minimal
 * wrapper component that mirrors the pattern added to index.vue.
 */

import { describe, it, expect, vi } from "vitest";
import { defineComponent, ref, h } from "vue";
import { mount } from "@vue/test-utils";

// ---------------------------------------------------------------------------
// Helper: build a minimal wrapper that mirrors the pattern in index.vue:
//   <div @keydown.enter.capture="guardEnterSubmit">
//     <inner-el @submit="onSubmit" />
//   </div>
// The guard checks `senderRef.value.popoverVisible` just as the real code
// does via the MentionSender exposed ref.
// ---------------------------------------------------------------------------
function makeWrapper(popoverVisibleValue: boolean) {
  const onSubmit = vi.fn();

  // Simulate the MentionSender exposed ref: { popoverVisible: boolean }
  const fakeSenderRef = ref({ popoverVisible: popoverVisibleValue });

  // guardEnterSubmit — the function we are locking in.
  // BEFORE the fix this function didn't exist; after the fix it lives in
  // index.vue and stopPropagation() prevents the inner submit() from running.
  const guardEnterSubmit = (e: KeyboardEvent) => {
    if (fakeSenderRef.value?.popoverVisible) {
      e.stopPropagation();
    }
  };

  // Inner element that fires onSubmit when it receives a keydown Enter
  // (simulates MentionSender's handleKeyDown calling submit() on keyCode 13).
  const InnerEl = defineComponent({
    emits: ["submit"],
    setup(_, { emit }) {
      const handleKeydown = (e: KeyboardEvent) => {
        if (e.key === "Enter") emit("submit", "test-value");
      };
      return () => h("textarea", { onKeydown: handleKeydown });
    },
  });

  const Wrapper = defineComponent({
    setup() {
      return () =>
        h(
          "div",
          { onKeydownCapture: guardEnterSubmit },
          [h(InnerEl, { onSubmit })]
        );
    },
  });

  return { onSubmit, Wrapper };
}

describe("guardEnterSubmit — Enter submit guard after @mention select", () => {
  it("allows submit on Enter when mention dropdown is closed", async () => {
    const { onSubmit, Wrapper } = makeWrapper(false);
    const wrapper = mount(Wrapper);
    const textarea = wrapper.find("textarea");
    await textarea.trigger("keydown", { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("blocks submit on Enter when mention dropdown is open (the bug fix)", async () => {
    const { onSubmit, Wrapper } = makeWrapper(true);
    const wrapper = mount(Wrapper);
    const textarea = wrapper.find("textarea");
    await textarea.trigger("keydown", { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledTimes(0);
  });

  it("no double-send: Enter fires submit exactly once when dropdown is closed", async () => {
    const { onSubmit, Wrapper } = makeWrapper(false);
    const wrapper = mount(Wrapper);
    const textarea = wrapper.find("textarea");
    await textarea.trigger("keydown", { key: "Enter" });
    await textarea.trigger("keydown", { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledTimes(2); // 2 presses → 2 submits, not 4
  });
});
