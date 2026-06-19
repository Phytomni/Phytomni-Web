import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { useTutorial } from "@/views/chat/composables/useTutorial";

// Harness: 一个轻量组件,仅调用 useTutorial,使 onMounted/onUnmounted
// 生命周期钩子在 mount/unmount 时正常触发。
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
    // 每个测试前激活一个全新的 Pinia 实例(useTutorial 内部 userStore() 需要)
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

    // mount 后应有且仅有一次 keydown 的 add
    const keydownAdds = addSpy.mock.calls.filter((c) => c[0] === "keydown");
    expect(keydownAdds.length).toBe(1);
    const handler = keydownAdds[0][1];

    wrapper.unmount();

    // unmount 后应有且仅有一次 keydown 的 remove,且是同一个函数引用
    const keydownRemoves = removeSpy.mock.calls.filter(
      (c) => c[0] === "keydown"
    );
    expect(keydownRemoves.length).toBe(1);
    // 被移除的 handler 必须与 add 时完全相同(同一引用),否则泄漏依然存在
    expect(keydownRemoves[0][1]).toBe(handler);
  });
});
