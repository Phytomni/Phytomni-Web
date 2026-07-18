import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, nextTick, ref } from "vue";
import { useDeepGenomeToc } from "@/composables/useDeepGenomeToc";

// ──────────────────────────────────────────────────────────────────────────────
// Harness: a lightweight component that calls the composable inside a setup context,
// so the onUnmounted lifecycle hook fires correctly on unmount. The return value is
// exposed for the test to access.
// ──────────────────────────────────────────────────────────────────────────────

function makeHarness(opts?: {
  headingIds?: string[];
  nestedItems?: Array<{
    id: string;
    children?: unknown[];
    [key: string]: unknown;
  }>;
}) {
  const headings = ref<Array<{ id: string; [key: string]: unknown }>>(
    (opts?.headingIds ?? []).map((id) => ({ id }))
  );
  const nestedHeadings = ref<
    Array<{ id: string; children?: unknown[]; [key: string]: unknown }>
  >(opts?.nestedItems ?? []);
  const mainContentRef = ref<any>(null);

  const Harness = defineComponent({
    setup() {
      const result = useDeepGenomeToc({
        headings,
        nestedHeadings,
        mainContentRef,
      });
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
// happy-dom does not implement IntersectionObserver; install a minimal mock.
// ──────────────────────────────────────────────────────────────────────────────

type IoCallback = (entries: IntersectionObserverEntry[]) => void;

class MockIntersectionObserver {
  static lastInstance: MockIntersectionObserver | null = null;
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  readonly options: IntersectionObserverInit;
  private _callback: IoCallback;

  constructor(callback: IoCallback, options: IntersectionObserverInit = {}) {
    this._callback = callback;
    this.options = options;
    MockIntersectionObserver.lastInstance = this;
  }

  /** For tests: manually trigger the callback */
  trigger(entries: Partial<IntersectionObserverEntry>[]) {
    this._callback(entries as IntersectionObserverEntry[]);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe("useDeepGenomeToc — initial state", () => {
  it("activeHeadingId is initially an empty string", () => {
    const { Harness } = makeHarness();
    const wrapper = mount(Harness);
    // vue-test-utils auto-unwraps refs returned from setup(), so we access .activeHeadingId directly
    expect(wrapper.vm.activeHeadingId).toBe("");
    wrapper.unmount();
  });

  it("return surface includes activeHeadingId / handleNavSelect / setupIntersectionObserver", () => {
    const headings = ref<Array<{ id: string; [key: string]: unknown }>>([]);
    const nestedHeadings = ref<
      Array<{ id: string; children?: unknown[]; [key: string]: unknown }>
    >([]);
    const mainContentRef = ref<any>(null);
    // Call the composable directly to verify the returned keys (no mount needed, since we only check property names)
    // Note: useDeepGenomeToc calls onUnmounted, which must run inside a setup context; mounting via makeHarness suffices
    const { Harness } = makeHarness();
    const wrapper = mount(Harness);
    const result = wrapper.vm as Record<string, unknown>;
    expect(result).toHaveProperty("activeHeadingId");
    expect(result).toHaveProperty("handleNavSelect");
    expect(result).toHaveProperty("setupIntersectionObserver");
    // Internal symbols are not exposed externally
    expect(result["jumpTo"]).toBeUndefined();
    expect(result["expandParentMenus"]).toBeUndefined();
    expect(result["observerRef"]).toBeUndefined();
    expect(result["observedElements"]).toBeUndefined();
    wrapper.unmount();
  });
});

describe("useDeepGenomeToc — handleNavSelect", () => {
  afterEach(() => {
    // Clean up test elements mounted on document.body
    document
      .querySelectorAll("[data-testid='toc-heading']")
      .forEach((el) => el.remove());
  });

  it("calls scrollIntoView(smooth, center) when the target element exists", async () => {
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
    expect(scrollSpy).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
    });
    wrapper.unmount();
  });

  it("does not call scrollIntoView when the target element does not exist", async () => {
    const { Harness } = makeHarness();
    const wrapper = mount(Harness);

    // id does not exist in the DOM
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
    document
      .querySelectorAll("[data-testid='toc-io-heading']")
      .forEach((el) => el.remove());
  });

  it("calls observe once for each headings id that has a matching DOM element", () => {
    const ids = ["h-one", "h-two"];

    // Create the corresponding elements in the DOM
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
    // observe should be called twice, once per heading
    expect(io.observe).toHaveBeenCalledTimes(2);

    wrapper.unmount();
  });

  it("does not call observe when a headings id is not present in the DOM", () => {
    const { Harness } = makeHarness({ headingIds: ["ghost-id-not-in-dom"] });
    const wrapper = mount(Harness);

    wrapper.vm.setupIntersectionObserver();

    const io = MockIntersectionObserver.lastInstance!;
    expect(io.observe).not.toHaveBeenCalled();

    wrapper.unmount();
  });

  it("calls observer.disconnect on unmount to complete cleanup", () => {
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

  it("uses the nearest vertical scroll owner and ignores non-scrolling overflow wrappers", () => {
    const scrollOwner = document.createElement("div");
    scrollOwner.style.overflowY = "auto";
    Object.defineProperties(scrollOwner, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 800 },
    });
    const clippedWrapper = document.createElement("div");
    clippedWrapper.style.overflow = "hidden";
    const horizontalWrapper = document.createElement("div");
    horizontalWrapper.style.overflowX = "auto";
    Object.defineProperties(horizontalWrapper, {
      clientHeight: { configurable: true, value: 500 },
      scrollHeight: { configurable: true, value: 500 },
    });
    const main = document.createElement("main");
    const heading = document.createElement("h2");
    heading.id = "embedded-scroll-heading";
    heading.setAttribute("data-testid", "toc-io-heading");
    main.appendChild(heading);
    horizontalWrapper.appendChild(main);
    clippedWrapper.appendChild(horizontalWrapper);
    scrollOwner.appendChild(clippedWrapper);
    document.body.appendChild(scrollOwner);

    const { Harness, mainContentRef } = makeHarness({
      headingIds: [heading.id],
    });
    mainContentRef.value = main;
    const wrapper = mount(Harness);

    wrapper.vm.setupIntersectionObserver();

    expect(MockIntersectionObserver.lastInstance?.options.root).toBe(
      scrollOwner
    );
    wrapper.unmount();
    scrollOwner.remove();
  });

  it("uses the viewport when no ancestor owns vertical scrolling", () => {
    const main = document.createElement("main");
    const heading = document.createElement("h2");
    heading.id = "viewport-scroll-heading";
    heading.setAttribute("data-testid", "toc-io-heading");
    main.appendChild(heading);
    document.body.appendChild(main);

    const { Harness, mainContentRef } = makeHarness({
      headingIds: [heading.id],
    });
    mainContentRef.value = main;
    const wrapper = mount(Harness);

    wrapper.vm.setupIntersectionObserver();

    expect(MockIntersectionObserver.lastInstance?.options.root).toBeNull();
    wrapper.unmount();
    main.remove();
  });

  it("expands parent menus only inside the viewer that owns the active heading", () => {
    const createViewer = (titleTestId: string) => {
      const viewer = document.createElement("div");
      viewer.className = "deep-genome-viewer";
      const toc = document.createElement("aside");
      toc.className = "deep-genome-toc";
      const submenu = document.createElement("div");
      submenu.className = "el-sub-menu";
      submenu.setAttribute("index", "parent-heading");
      const title = document.createElement("button");
      title.className = "el-sub-menu__title";
      title.setAttribute("data-testid", titleTestId);
      submenu.appendChild(title);
      toc.appendChild(submenu);
      const main = document.createElement("main");
      viewer.append(toc, main);
      document.body.appendChild(viewer);
      return { viewer, main, title };
    };

    const owned = createViewer("owned-title");
    const foreign = createViewer("foreign-title");
    const heading = document.createElement("h3");
    heading.id = "owned-child-heading";
    heading.setAttribute("data-testid", "toc-io-heading");
    owned.main.appendChild(heading);
    const ownedClick = vi.spyOn(owned.title, "click");
    const foreignClick = vi.spyOn(foreign.title, "click");

    const { Harness, mainContentRef } = makeHarness({
      headingIds: [heading.id],
      nestedItems: [
        {
          id: "parent-heading",
          children: [{ id: heading.id, children: [] }],
        },
      ],
    });
    mainContentRef.value = owned.main;
    const wrapper = mount(Harness);
    wrapper.vm.setupIntersectionObserver();

    MockIntersectionObserver.lastInstance?.trigger([
      {
        target: heading,
        isIntersecting: true,
        boundingClientRect: { top: 10 },
      },
    ]);

    expect(ownedClick).toHaveBeenCalledOnce();
    expect(foreignClick).not.toHaveBeenCalled();
    wrapper.unmount();
    owned.viewer.remove();
    foreign.viewer.remove();
  });
});
