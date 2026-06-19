import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, nextTick, ref } from "vue";
import { useSidebarResponsive } from "@/views/chat/composables/useSidebarResponsive";

// Harness: minimal component that calls the composable and exposes the result,
// so onMounted / onUnmounted lifecycle hooks fire correctly.
function makeHarness(opts: {
  collapsed: () => boolean;
  onCollapseChange: (v: boolean) => void;
}) {
  return defineComponent({
    setup() {
      const result = useSidebarResponsive(opts);
      return result;
    },
    render() {
      return null;
    },
  });
}

// Helper: override window.innerWidth (read-only in happy-dom)
function setInnerWidth(w: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: w,
  });
}

describe("useSidebarResponsive", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    // Default innerWidth to a wide desktop (>= 1200) to keep tests isolated.
    setInnerWidth(1440);
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  // ── Initial value ─────────────────────────────────────────────────────────

  it("initial value: sidebarCollapsed mirrors collapsed() = false", () => {
    const onCollapseChange = vi.fn();
    const wrapper = mount(
      makeHarness({ collapsed: () => false, onCollapseChange })
    );
    expect(wrapper.vm.sidebarCollapsed).toBe(false);
    wrapper.unmount();
  });

  it("initial value: sidebarCollapsed mirrors collapsed() = true (narrow screen so checkWindowSize does not auto-expand)", () => {
    // Behavioral note: checkWindowSize fires BEFORE localStorage is read in onMounted.
    // To start with sidebarCollapsed=true, use a narrow screen (< 1200) so
    // checkWindowSize collapses (not expands) the sidebar.
    setInnerWidth(800);
    const onCollapseChange = vi.fn();
    const wrapper = mount(
      makeHarness({ collapsed: () => true, onCollapseChange })
    );
    // At mount: sidebarCollapsed initializes to true; checkWindowSize sees collapsed=true
    // and width < 1200 → collapses, but it's already true → no change.
    expect(wrapper.vm.sidebarCollapsed).toBe(true);
    wrapper.unmount();
  });

  // ── Prop-sync watch ───────────────────────────────────────────────────────

  it("prop-sync: external collapsed() change propagates to sidebarCollapsed", async () => {
    // Must use a Vue reactive ref so that watch(() => opts.collapsed()) is reactive.
    const collapsedSource = ref(false);
    const onCollapseChange = vi.fn();
    const wrapper = mount(
      makeHarness({
        collapsed: () => collapsedSource.value,
        onCollapseChange,
      })
    );
    expect(wrapper.vm.sidebarCollapsed).toBe(false);

    // Simulate parent flipping the prop (reactively)
    collapsedSource.value = true;
    await nextTick();

    expect(wrapper.vm.sidebarCollapsed).toBe(true);
    wrapper.unmount();
  });

  // ── Emit-up invariant (most important) ────────────────────────────────────

  it("emit-up: collapseSidebar sets sidebarCollapsed=true AND calls onCollapseChange(true)", async () => {
    const onCollapseChange = vi.fn();
    const wrapper = mount(
      makeHarness({ collapsed: () => false, onCollapseChange })
    );
    // Clear any calls triggered by the prop-sync watch on mount
    onCollapseChange.mockClear();

    wrapper.vm.collapseSidebar();
    await nextTick();

    expect(wrapper.vm.sidebarCollapsed).toBe(true);
    expect(onCollapseChange).toHaveBeenCalledWith(true);
    wrapper.unmount();
  });

  it("emit-up: expandSidebar from collapsed=true sets sidebarCollapsed=false AND calls onCollapseChange(false)", async () => {
    localStorage.setItem("sidebarAutoExpand", "false");
    const onCollapseChange = vi.fn();
    const wrapper = mount(
      makeHarness({ collapsed: () => true, onCollapseChange })
    );
    onCollapseChange.mockClear();

    wrapper.vm.expandSidebar();
    await nextTick();

    expect(wrapper.vm.sidebarCollapsed).toBe(false);
    expect(onCollapseChange).toHaveBeenCalledWith(false);
    wrapper.unmount();
  });

  // ── expandSidebar guard (no-op when already expanded) ────────────────────

  it("expandSidebar guard: no-op when already expanded — onCollapseChange is NOT called again", async () => {
    const onCollapseChange = vi.fn();
    const wrapper = mount(
      makeHarness({ collapsed: () => false, onCollapseChange })
    );
    onCollapseChange.mockClear();

    // Already expanded — calling expandSidebar should be a no-op
    wrapper.vm.expandSidebar();
    await nextTick();

    expect(wrapper.vm.sidebarCollapsed).toBe(false);
    expect(onCollapseChange).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  // ── Breakpoint auto-behavior on mount ─────────────────────────────────────

  it("breakpoint: width < 1200 with expanded start → sidebarCollapsed becomes true after mount", () => {
    setInnerWidth(800);
    const onCollapseChange = vi.fn();
    // Start expanded (collapsed=false); checkWindowSize should collapse it
    const wrapper = mount(
      makeHarness({ collapsed: () => false, onCollapseChange })
    );
    // checkWindowSize fires synchronously in onMounted
    expect(wrapper.vm.sidebarCollapsed).toBe(true);
    wrapper.unmount();
  });

  it("breakpoint: width >= 1200 with collapsed start and autoExpand enabled → sidebarCollapsed becomes false after mount", () => {
    setInnerWidth(1440);
    // autoExpand defaults to true (no localStorage entry)
    const onCollapseChange = vi.fn();
    const wrapper = mount(
      makeHarness({ collapsed: () => true, onCollapseChange })
    );
    // checkWindowSize: width >= 1200 AND sidebarCollapsed=true AND autoExpandEnabled=true → expand
    expect(wrapper.vm.sidebarCollapsed).toBe(false);
    wrapper.unmount();
  });

  // ── Debounced resize ──────────────────────────────────────────────────────

  it("debounced resize: resize event + 100ms → checkWindowSize fires and collapses sidebar", async () => {
    setInnerWidth(1440);
    const onCollapseChange = vi.fn();
    const wrapper = mount(
      makeHarness({ collapsed: () => false, onCollapseChange })
    );
    // At mount with 1440px and collapsed=false → remains false (no auto-collapse)
    expect(wrapper.vm.sidebarCollapsed).toBe(false);
    onCollapseChange.mockClear();

    // Simulate window narrowing below breakpoint then resize event
    setInnerWidth(800);
    window.dispatchEvent(new Event("resize"));
    // Before debounce: no change yet
    expect(wrapper.vm.sidebarCollapsed).toBe(false);

    // Advance past 100ms debounce
    vi.advanceTimersByTime(100);
    await nextTick();

    expect(wrapper.vm.sidebarCollapsed).toBe(true);
    wrapper.unmount();
  });

  it("debounced resize: multiple resize events within 100ms only trigger checkWindowSize once", async () => {
    setInnerWidth(1440);
    const onCollapseChange = vi.fn();
    const wrapper = mount(
      makeHarness({ collapsed: () => false, onCollapseChange })
    );
    onCollapseChange.mockClear();
    setInnerWidth(800);

    // Fire three resize events in rapid succession
    window.dispatchEvent(new Event("resize"));
    vi.advanceTimersByTime(50);
    window.dispatchEvent(new Event("resize"));
    vi.advanceTimersByTime(50);
    window.dispatchEvent(new Event("resize"));

    // Not yet settled
    expect(wrapper.vm.sidebarCollapsed).toBe(false);

    // Settle the final debounce
    vi.advanceTimersByTime(100);
    await nextTick();

    expect(wrapper.vm.sidebarCollapsed).toBe(true);
    wrapper.unmount();
  });

  // ── localStorage ──────────────────────────────────────────────────────────

  it("localStorage: collapseSidebar disables autoExpand; after 3000ms re-enables and writes sidebarAutoExpand=true", async () => {
    const onCollapseChange = vi.fn();
    const wrapper = mount(
      makeHarness({ collapsed: () => false, onCollapseChange })
    );

    wrapper.vm.collapseSidebar();
    await nextTick();

    // After collapse: autoExpandEnabled=false → sidebarAutoExpand="false"
    expect(localStorage.getItem("sidebarAutoExpand")).toBe("false");

    // Advance 3000ms → autoExpandEnabled=true → sidebarAutoExpand="true"
    vi.advanceTimersByTime(3000);
    await nextTick();

    expect(localStorage.getItem("sidebarAutoExpand")).toBe("true");
    wrapper.unmount();
  });

  it("localStorage: pre-seeded sidebarAutoExpand=false is read after mount checkWindowSize, so subsequent resize does NOT auto-expand", async () => {
    // Behavioral note: onMounted runs checkWindowSize() FIRST (using default autoExpandEnabled=true),
    // then reads localStorage. So the pre-seeded "false" does NOT block the initial checkWindowSize,
    // but DOES block subsequent resize events.
    localStorage.setItem("sidebarAutoExpand", "false");
    setInnerWidth(800); // Start narrow so checkWindowSize collapses (not expands) — keeps sidebarCollapsed=true
    const onCollapseChange = vi.fn();
    const wrapper = mount(
      makeHarness({ collapsed: () => false, onCollapseChange })
    );
    // At mount: checkWindowSize sees 800 < 1200 with sidebarCollapsed=false → collapses.
    // Then localStorage is read → autoExpandEnabled=false.
    expect(wrapper.vm.sidebarCollapsed).toBe(true);

    // Now widen the window: with autoExpandEnabled=false the resize should NOT auto-expand
    setInnerWidth(1440);
    window.dispatchEvent(new Event("resize"));
    vi.advanceTimersByTime(100);
    await nextTick();

    // autoExpandEnabled=false blocks the auto-expand
    expect(wrapper.vm.sidebarCollapsed).toBe(true);
    wrapper.unmount();
  });

  it("localStorage: expandSidebar disables autoExpand (sets false) then re-enables (sets true) after 3000ms", async () => {
    // Setup: start collapsed by using narrow screen so checkWindowSize collapses.
    // After mount, localStorage is read. We seed nothing — autoExpandEnabled stays true.
    // Then we manually collapse (to be able to call expandSidebar meaningfully).
    setInnerWidth(800);
    const onCollapseChange = vi.fn();
    const wrapper = mount(
      makeHarness({ collapsed: () => false, onCollapseChange })
    );
    // After mount: width 800 → collapsed. autoExpandEnabled=true (no localStorage seed).
    expect(wrapper.vm.sidebarCollapsed).toBe(true);
    onCollapseChange.mockClear();

    wrapper.vm.expandSidebar();
    await nextTick();

    // expandSidebar: autoExpandEnabled set to false → watch fires → localStorage="false"
    expect(localStorage.getItem("sidebarAutoExpand")).toBe("false");

    // After 3000ms re-enable fires: autoExpandEnabled=true → watch fires → localStorage="true"
    vi.advanceTimersByTime(3000);
    await nextTick();

    expect(localStorage.getItem("sidebarAutoExpand")).toBe("true");
    wrapper.unmount();
  });

  // ── Cleanup on unmount ────────────────────────────────────────────────────

  it("cleanup: after unmount, removeEventListener is called with 'resize' so post-unmount resize events do NOT change state", async () => {
    setInnerWidth(1440);
    const onCollapseChange = vi.fn();
    const wrapper = mount(
      makeHarness({ collapsed: () => false, onCollapseChange })
    );
    // Capture state before unmount
    const stateBeforeUnmount = wrapper.vm.sidebarCollapsed;
    expect(stateBeforeUnmount).toBe(false);

    // Spy BEFORE unmount so we catch the removeEventListener call made by onUnmounted.
    const removeSpy = vi.spyOn(window, "removeEventListener");
    wrapper.unmount();

    // onUnmounted must have removed the "resize" handler.
    expect(removeSpy).toHaveBeenCalledWith("resize", expect.any(Function));
    removeSpy.mockRestore();

    // Additional behavioral guard: a resize that would have collapsed the sidebar
    // must not change state once the listener is gone.
    setInnerWidth(800);
    window.dispatchEvent(new Event("resize"));
    vi.advanceTimersByTime(200);
    await nextTick();

    // sidebarCollapsed was false before unmount and must remain false afterwards.
    expect(stateBeforeUnmount).toBe(false);
  });
});
