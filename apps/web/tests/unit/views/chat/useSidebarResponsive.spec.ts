import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, nextTick, ref } from "vue";
import {
  SIDEBAR_COLLAPSED_PREFERENCE_KEY,
  SIDEBAR_LEGACY_AUTO_EXPAND_KEY,
  useSidebarResponsive,
} from "@/views/chat/composables/useSidebarResponsive";

function setInnerWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

function makeHarness(opts?: {
  collapsed?: () => boolean;
  drawerOpen?: () => boolean;
  onCollapseChange?: (value: boolean) => void;
  onDrawerOpenChange?: (value: boolean) => void;
}) {
  return defineComponent({
    setup() {
      return useSidebarResponsive({
        collapsed: opts?.collapsed ?? (() => false),
        drawerOpen: opts?.drawerOpen,
        onCollapseChange: opts?.onCollapseChange ?? vi.fn(),
        onDrawerOpenChange: opts?.onDrawerOpenChange ?? vi.fn(),
      });
    },
    render() {
      return null;
    },
  });
}

describe("useSidebarResponsive", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    setInnerWidth(1440);
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it("derives desktop state from the stored collapsed preference", () => {
    localStorage.setItem(SIDEBAR_COLLAPSED_PREFERENCE_KEY, "true");
    const wrapper = mount(makeHarness());

    expect(wrapper.vm.isMobile).toBe(false);
    expect(wrapper.vm.collapsedPreference).toBe(true);
    expect(wrapper.vm.sidebarCollapsed).toBe(true);
    wrapper.unmount();
  });

  it("keeps a wide desktop expanded when the preference is false", () => {
    const wrapper = mount(makeHarness());

    expect(wrapper.vm.isMobile).toBe(false);
    expect(wrapper.vm.sidebarCollapsed).toBe(false);
    wrapper.unmount();
  });

  it.each([
    {
      label: "expanded desktop",
      width: 1440,
      drawerOpen: false,
      sidebarCollapsed: false,
      isMobile: false,
    },
    {
      label: "compact desktop",
      width: 1024,
      drawerOpen: false,
      sidebarCollapsed: true,
      isMobile: false,
    },
    {
      label: "closed mobile drawer",
      width: 390,
      drawerOpen: false,
      sidebarCollapsed: false,
      isMobile: true,
    },
    {
      label: "open mobile drawer",
      width: 390,
      drawerOpen: true,
      sidebarCollapsed: false,
      isMobile: true,
    },
  ])(
    "maps the $label state without changing desktop preference semantics",
    async ({ width, drawerOpen, sidebarCollapsed, isMobile }) => {
      setInnerWidth(width);
      const wrapper = mount(makeHarness({ drawerOpen: () => drawerOpen }));
      await nextTick();

      expect(wrapper.vm.isMobile).toBe(isMobile);
      expect(wrapper.vm.sidebarCollapsed).toBe(sidebarCollapsed);
      expect(wrapper.vm.drawerOpen).toBe(drawerOpen);
      if (isMobile) {
        expect(
          localStorage.getItem(SIDEBAR_COLLAPSED_PREFERENCE_KEY)
        ).toBeNull();
      }
      wrapper.unmount();
    }
  );

  it("derives compact state between 900 and 1279 pixels without changing preference", async () => {
    localStorage.setItem(SIDEBAR_COLLAPSED_PREFERENCE_KEY, "false");
    const wrapper = mount(makeHarness());

    setInnerWidth(1024);
    window.dispatchEvent(new Event("resize"));
    vi.advanceTimersByTime(100);
    await nextTick();

    expect(wrapper.vm.isMobile).toBe(false);
    expect(wrapper.vm.sidebarCollapsed).toBe(true);
    expect(wrapper.vm.collapsedPreference).toBe(false);
    expect(localStorage.getItem(SIDEBAR_COLLAPSED_PREFERENCE_KEY)).toBe(
      "false"
    );
    wrapper.unmount();
  });

  it("keeps a mobile sidebar out of layout until the drawer is opened", async () => {
    setInnerWidth(390);
    const onDrawerOpenChange = vi.fn();
    const wrapper = mount(makeHarness({ onDrawerOpenChange }));

    expect(wrapper.vm.isMobile).toBe(true);
    expect(wrapper.vm.sidebarCollapsed).toBe(false);
    expect(wrapper.vm.drawerOpen).toBe(false);

    wrapper.vm.openDrawer();
    await nextTick();
    expect(wrapper.vm.drawerOpen).toBe(true);
    expect(onDrawerOpenChange).toHaveBeenCalledWith(true);

    wrapper.vm.closeDrawer();
    await nextTick();
    expect(wrapper.vm.drawerOpen).toBe(false);
    expect(onDrawerOpenChange).toHaveBeenCalledWith(false);
    wrapper.unmount();
  });

  it("toggles the desktop preference but does not persist mobile drawer state", async () => {
    const onCollapseChange = vi.fn();
    const wrapper = mount(makeHarness({ onCollapseChange }));

    wrapper.vm.toggle();
    await nextTick();
    expect(wrapper.vm.collapsedPreference).toBe(true);
    expect(localStorage.getItem(SIDEBAR_COLLAPSED_PREFERENCE_KEY)).toBe("true");
    expect(onCollapseChange).toHaveBeenCalledWith(true);

    setInnerWidth(390);
    window.dispatchEvent(new Event("resize"));
    vi.advanceTimersByTime(100);
    await nextTick();
    localStorage.removeItem(SIDEBAR_COLLAPSED_PREFERENCE_KEY);

    wrapper.vm.toggle();
    await nextTick();
    expect(wrapper.vm.drawerOpen).toBe(true);
    expect(localStorage.getItem(SIDEBAR_COLLAPSED_PREFERENCE_KEY)).toBeNull();
    wrapper.unmount();
  });

  it("migrates a valid legacy auto-expand value once", () => {
    localStorage.setItem(SIDEBAR_LEGACY_AUTO_EXPAND_KEY, "false");
    const wrapper = mount(makeHarness());

    expect(wrapper.vm.collapsedPreference).toBe(true);
    expect(localStorage.getItem(SIDEBAR_COLLAPSED_PREFERENCE_KEY)).toBe("true");
    expect(localStorage.getItem(SIDEBAR_LEGACY_AUTO_EXPAND_KEY)).toBeNull();
    wrapper.unmount();
  });

  it("ignores invalid stored values without throwing", () => {
    localStorage.setItem(SIDEBAR_COLLAPSED_PREFERENCE_KEY, "not-json");
    localStorage.setItem(SIDEBAR_LEGACY_AUTO_EXPAND_KEY, "{");

    const wrapper = mount(makeHarness());
    expect(wrapper.vm.collapsedPreference).toBe(false);
    expect(localStorage.getItem(SIDEBAR_COLLAPSED_PREFERENCE_KEY)).toBeNull();
    wrapper.unmount();
  });

  it("does not let resize reopen a manually collapsed desktop sidebar", async () => {
    const wrapper = mount(makeHarness());

    wrapper.vm.collapseSidebar();
    await nextTick();
    expect(wrapper.vm.collapsedPreference).toBe(true);

    setInnerWidth(1024);
    window.dispatchEvent(new Event("resize"));
    vi.advanceTimersByTime(100);
    await nextTick();
    setInnerWidth(1440);
    window.dispatchEvent(new Event("resize"));
    vi.advanceTimersByTime(100);
    await nextTick();

    expect(wrapper.vm.sidebarCollapsed).toBe(true);
    expect(wrapper.vm.collapsedPreference).toBe(true);
    wrapper.unmount();
  });

  it("syncs external desktop collapse changes for compatibility", async () => {
    const collapsed = ref(false);
    const wrapper = mount(makeHarness({ collapsed: () => collapsed.value }));

    collapsed.value = true;
    await nextTick();

    expect(wrapper.vm.collapsedPreference).toBe(true);
    expect(wrapper.vm.sidebarCollapsed).toBe(true);
    wrapper.unmount();
  });

  it("closes an open mobile drawer when leaving mobile width", async () => {
    setInnerWidth(390);
    const wrapper = mount(makeHarness());
    wrapper.vm.openDrawer();
    await nextTick();
    expect(wrapper.vm.drawerOpen).toBe(true);

    setInnerWidth(1440);
    window.dispatchEvent(new Event("resize"));
    vi.advanceTimersByTime(100);
    await nextTick();

    expect(wrapper.vm.isMobile).toBe(false);
    expect(wrapper.vm.drawerOpen).toBe(false);
    wrapper.unmount();
  });

  it("cleans the resize listener and debounce timer on unmount", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    const wrapper = mount(makeHarness());

    setInnerWidth(1024);
    window.dispatchEvent(new Event("resize"));
    wrapper.unmount();

    expect(removeSpy).toHaveBeenCalledWith("resize", expect.any(Function));
    expect(clearSpy).toHaveBeenCalled();
    removeSpy.mockRestore();
    clearSpy.mockRestore();
  });
});
