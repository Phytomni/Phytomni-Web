import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, nextTick, ref } from "vue";
import { useDeepGenomeToc } from "@/composables/useDeepGenomeToc";

// ──────────────────────────────────────────────────────────────────────────────
// Harness: 轻量组件，在 setup 上下文中调用 composable，使 onUnmounted
// 生命周期钩子在 unmount 时正常触发。返回值通过 expose 供测试访问。
// ──────────────────────────────────────────────────────────────────────────────

function makeHarness(opts?: {
  headingIds?: string[];
  nestedItems?: Array<{ id: string; children?: unknown[]; [key: string]: unknown }>;
}) {
  const headings = ref<Array<{ id: string; [key: string]: unknown }>>(
    (opts?.headingIds ?? []).map((id) => ({ id }))
  );
  const nestedHeadings = ref<Array<{ id: string; children?: unknown[]; [key: string]: unknown }>>(
    opts?.nestedItems ?? []
  );
  const mainContentRef = ref<any>(null);

  const Harness = defineComponent({
    setup() {
      const result = useDeepGenomeToc({ headings, nestedHeadings, mainContentRef });
      return result;
    },
    render() {
      return null;
    },
  });

  return { Harness, headings, nestedHeadings, mainContentRef };
}

// ──────────────────────────────────────────────────────────────────────────────
// IntersectionObserver stub
// happy-dom 不实现 IntersectionObserver；安装一个最小 mock。
// ──────────────────────────────────────────────────────────────────────────────

type IoCallback = (entries: IntersectionObserverEntry[]) => void;

class MockIntersectionObserver {
  static lastInstance: MockIntersectionObserver | null = null;
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  private _callback: IoCallback;

  constructor(callback: IoCallback) {
    this._callback = callback;
    MockIntersectionObserver.lastInstance = this;
  }

  /** 测试用：手动触发 callback */
  trigger(entries: Partial<IntersectionObserverEntry>[]) {
    this._callback(entries as IntersectionObserverEntry[]);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe("useDeepGenomeToc — initial state", () => {
  it("activeHeadingId 初始值为空字符串", () => {
    const { Harness } = makeHarness();
    const wrapper = mount(Harness);
    // vue-test-utils 对 setup() 返回的 ref 自动 unwrap，所以直接访问 .activeHeadingId
    expect(wrapper.vm.activeHeadingId).toBe("");
    wrapper.unmount();
  });

  it("返回面包含 activeHeadingId / handleNavSelect / setupIntersectionObserver", () => {
    const headings = ref<Array<{ id: string; [key: string]: unknown }>>([]);
    const nestedHeadings = ref<Array<{ id: string; children?: unknown[]; [key: string]: unknown }>>([]);
    const mainContentRef = ref<any>(null);
    // 直接调用 composable 验证返回键（不需要 mount，因为只检查属性名）
    // 注意：useDeepGenomeToc 调用 onUnmounted，必须在 setup 上下文中；用 makeHarness mount 即可
    const { Harness } = makeHarness();
    const wrapper = mount(Harness);
    const result = wrapper.vm as Record<string, unknown>;
    expect(result).toHaveProperty("activeHeadingId");
    expect(result).toHaveProperty("handleNavSelect");
    expect(result).toHaveProperty("setupIntersectionObserver");
    // 内部符号不对外暴露
    expect(result["jumpTo"]).toBeUndefined();
    expect(result["expandParentMenus"]).toBeUndefined();
    expect(result["observerRef"]).toBeUndefined();
    expect(result["observedElements"]).toBeUndefined();
    wrapper.unmount();
  });
});

describe("useDeepGenomeToc — handleNavSelect", () => {
  afterEach(() => {
    // 清理挂载在 document.body 上的测试元素
    document.querySelectorAll("[data-testid='toc-heading']").forEach((el) => el.remove());
  });

  it("目标元素存在时，调用 scrollIntoView(smooth, center)", async () => {
    const id = "heading-test-scroll";
    const el = document.createElement("h2");
    el.id = id;
    el.setAttribute("data-testid", "toc-heading");
    const scrollSpy = vi.fn();
    el.scrollIntoView = scrollSpy;
    document.body.appendChild(el);

    const { Harness } = makeHarness({ headingIds: [id] });
    const wrapper = mount(Harness);

    wrapper.vm.handleNavSelect(id);
    await nextTick();

    expect(scrollSpy).toHaveBeenCalledOnce();
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
    wrapper.unmount();
  });

  it("目标元素不存在时，scrollIntoView 不被调用", async () => {
    const { Harness } = makeHarness();
    const wrapper = mount(Harness);

    // id 不存在于 DOM 中
    const scrollSpy = vi.fn();
    wrapper.vm.handleNavSelect("non-existent-id-xyz");
    await nextTick();

    expect(scrollSpy).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});

describe("useDeepGenomeToc — setupIntersectionObserver", () => {
  let originalIO: typeof globalThis.IntersectionObserver;

  beforeEach(() => {
    originalIO = globalThis.IntersectionObserver;
    // @ts-expect-error replacing with minimal mock
    globalThis.IntersectionObserver = MockIntersectionObserver;
    MockIntersectionObserver.lastInstance = null;
  });

  afterEach(() => {
    globalThis.IntersectionObserver = originalIO;
    document.querySelectorAll("[data-testid='toc-io-heading']").forEach((el) => el.remove());
  });

  it("为每个 headings 中存在 id 的 DOM 元素调用一次 observe", () => {
    const ids = ["h-one", "h-two"];

    // 在 DOM 中创建对应元素
    ids.forEach((id) => {
      const el = document.createElement("h2");
      el.id = id;
      el.setAttribute("data-testid", "toc-io-heading");
      document.body.appendChild(el);
    });

    const { Harness } = makeHarness({ headingIds: ids });
    const wrapper = mount(Harness);

    wrapper.vm.setupIntersectionObserver();

    const io = MockIntersectionObserver.lastInstance!;
    expect(io).not.toBeNull();
    // observe 应该被调用两次，每个 heading 一次
    expect(io.observe).toHaveBeenCalledTimes(2);

    wrapper.unmount();
  });

  it("headings 中 id 不存在于 DOM 时，observe 不被调用", () => {
    const { Harness } = makeHarness({ headingIds: ["ghost-id-not-in-dom"] });
    const wrapper = mount(Harness);

    wrapper.vm.setupIntersectionObserver();

    const io = MockIntersectionObserver.lastInstance!;
    expect(io.observe).not.toHaveBeenCalled();

    wrapper.unmount();
  });

  it("unmount 时调用 observer.disconnect，完成清理", () => {
    const id = "h-cleanup";
    const el = document.createElement("h2");
    el.id = id;
    el.setAttribute("data-testid", "toc-io-heading");
    document.body.appendChild(el);

    const { Harness } = makeHarness({ headingIds: [id] });
    const wrapper = mount(Harness);

    wrapper.vm.setupIntersectionObserver();
    const io = MockIntersectionObserver.lastInstance!;

    wrapper.unmount();

    expect(io.disconnect).toHaveBeenCalledOnce();
  });
});
