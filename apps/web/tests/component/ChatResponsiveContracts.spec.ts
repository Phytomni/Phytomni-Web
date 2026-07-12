/**
 * Chat responsive contracts at breakpoint boundaries.
 * Asserts deterministic class/state/hook contracts only — never geometry
 * (scrollWidth, rectangles, visibility, occlusion). Live geometry belongs to
 * tests/visual/chat/measure-geometry.js + assert-geometry.js in a real browser.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mount } from "@vue/test-utils";
import { defineComponent, nextTick } from "vue";
import {
  SIDEBAR_COMPACT_BREAKPOINT,
  SIDEBAR_MOBILE_BREAKPOINT,
  useSidebarResponsive,
} from "@/views/chat/composables/useSidebarResponsive";
import PhyAdaptiveShell from "@/components/shell/PhyAdaptiveShell.vue";
import PhyAdaptiveSidebar from "@/components/shell/PhyAdaptiveSidebar.vue";

const CHAT_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/index.vue"),
  "utf8"
);
const COMPOSER_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/components/ChatComposer.vue"),
  "utf8"
);
const NAV_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/components/ChatSidebarNav.vue"),
  "utf8"
);
const SIDEBAR_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/sidebar.vue"),
  "utf8"
);
const SHELL_SOURCE = readFileSync(
  resolve(__dirname, "../../src/components/shell/PhyAdaptiveShell.vue"),
  "utf8"
);

const countOccurrences = (source: string, needle: string) =>
  source.split(needle).length - 1;

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

describe("ChatResponsiveContracts — breakpoint controller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    setInnerWidth(1440);
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it.each([
    {
      label: "small below 600",
      width: 599,
      isMobile: true,
      sidebarCollapsed: false,
    },
    {
      label: "small at 600",
      width: 600,
      isMobile: true,
      sidebarCollapsed: false,
    },
    {
      label: "mobile below 900",
      width: 899,
      isMobile: true,
      sidebarCollapsed: false,
    },
    {
      label: "compact at 900",
      width: 900,
      isMobile: false,
      sidebarCollapsed: true,
    },
    {
      label: "compact below 1280",
      width: 1279,
      isMobile: false,
      sidebarCollapsed: true,
    },
    {
      label: "desktop at 1280",
      width: 1280,
      isMobile: false,
      sidebarCollapsed: false,
    },
  ])(
    "maps $label ($width CSS px) without geometry claims",
    async ({ width, isMobile, sidebarCollapsed }) => {
      setInnerWidth(width);
      const wrapper = mount(makeHarness());
      await nextTick();

      expect(wrapper.vm.isMobile).toBe(isMobile);
      expect(wrapper.vm.sidebarCollapsed).toBe(sidebarCollapsed);
      expect(wrapper.vm.drawerOpen).toBe(false);
      wrapper.unmount();
    }
  );

  it("opens and closes the mobile drawer only below the mobile breakpoint", async () => {
    setInnerWidth(899);
    const onDrawer = vi.fn();
    const wrapper = mount(makeHarness({ onDrawerOpenChange: onDrawer }));

    expect(wrapper.vm.isMobile).toBe(true);
    wrapper.vm.openDrawer();
    await nextTick();
    expect(wrapper.vm.drawerOpen).toBe(true);
    expect(onDrawer).toHaveBeenCalledWith(true);

    setInnerWidth(900);
    window.dispatchEvent(new Event("resize"));
    vi.advanceTimersByTime(100);
    await nextTick();
    expect(wrapper.vm.isMobile).toBe(false);
    expect(wrapper.vm.drawerOpen).toBe(false);
    wrapper.unmount();
  });

  it("keeps breakpoint constants aligned with token CSS pixels", () => {
    expect(SIDEBAR_MOBILE_BREAKPOINT).toBe(900);
    expect(SIDEBAR_COMPACT_BREAKPOINT).toBe(1280);
  });
});

describe("ChatResponsiveContracts — shell class and drawer presentation", () => {
  it("applies collapsed and drawer-open classes from props", () => {
    const expanded = mount(PhyAdaptiveShell, {
      props: { sidebarCollapsed: false },
      slots: { sidebar: "<nav />", main: "<main />" },
    });
    expect(expanded.classes()).toContain("phy-adaptive-shell--normal");
    expect(expanded.classes()).not.toContain("is-sidebar-collapsed");
    expect(expanded.attributes("data-scroll-root")).toBe("adaptive");

    const collapsed = mount(PhyAdaptiveShell, {
      props: { sidebarCollapsed: true },
      slots: { sidebar: "<nav />", main: "<main />" },
    });
    expect(collapsed.classes()).toContain("is-sidebar-collapsed");

    const drawer = mount(PhyAdaptiveSidebar, {
      props: { collapsed: false, drawerOpen: true },
      slots: { default: "<nav />" },
    });
    expect(drawer.classes()).toContain("is-drawer-open");
  });

  it("wires ChatSidebarNav matchMedia to the mobile breakpoint minus one", () => {
    expect(NAV_SOURCE).toContain("SIDEBAR_MOBILE_BREAKPOINT");
    expect(NAV_SOURCE).toContain("window.matchMedia");
    expect(NAV_SOURCE).toContain(
      "`(max-width: ${SIDEBAR_MOBILE_BREAKPOINT - 1}px)`"
    );
    expect(NAV_SOURCE).toContain("CHAT_SIDEBAR_DRAWER_OPEN_KEY");
  });
});

describe("ChatResponsiveContracts — single scroll owner and stable hooks", () => {
  it("keeps one transcript scroll-owner hook and one messageContainer ref", () => {
    expect(
      countOccurrences(CHAT_SOURCE, 'data-test="chat-transcript-scroll-root"')
    ).toBe(1);
    expect(countOccurrences(CHAT_SOURCE, 'data-testid="chat-transcript"')).toBe(
      1
    );
    expect(countOccurrences(CHAT_SOURCE, 'ref="messageContainer"')).toBe(1);
    expect(CHAT_SOURCE).toContain(
      'class="message-container"\n        data-testid="chat-transcript"'
    );
    expect(SHELL_SOURCE).toContain('data-scroll-root="adaptive"');
  });

  it("keeps singleton capture hooks without duplicates", () => {
    expect(countOccurrences(CHAT_SOURCE, 'data-testid="chat-root"')).toBe(1);
    expect(
      countOccurrences(CHAT_SOURCE, 'data-testid="chat-sidebar-trigger"')
    ).toBe(1);
    expect(
      countOccurrences(COMPOSER_SOURCE, 'data-testid="chat-composer"')
    ).toBe(1);
    expect(
      countOccurrences(NAV_SOURCE, 'data-testid="chat-primary-action"')
    ).toBe(1);
    expect(
      countOccurrences(NAV_SOURCE, 'data-testid="chat-account-identity"')
    ).toBe(1);
    expect(
      countOccurrences(CHAT_SOURCE, 'data-testid="chat-primary-action"')
    ).toBe(0);
  });

  it("locks Composer safe-area padding on the composer root class", () => {
    expect(COMPOSER_SOURCE).toContain('data-testid="chat-composer"');
    expect(COMPOSER_SOURCE).toContain('class="chat-composer"');
    expect(COMPOSER_SOURCE).toContain("safe-area-inset-bottom");
    expect(COMPOSER_SOURCE).toMatch(
      /\.chat-composer\s*\{[\s\S]*safe-area-inset-bottom/
    );
  });

  it("bridges sidebar collapsed and drawer state into the adaptive shell", () => {
    expect(CHAT_SOURCE).toContain(':sidebar-collapsed="leftSidebarCollapsed"');
    expect(CHAT_SOURCE).toContain(':drawer-open="leftSidebarDrawerOpen"');
    expect(SIDEBAR_SOURCE).toContain(':collapsed="sidebarCollapsed"');
    expect(SIDEBAR_SOURCE).toContain(':drawer-open="drawerOpen"');
    expect(CHAT_SOURCE).toContain(
      ':data-sidebar-drawer-state="sidebarDrawerStateAttr"'
    );
  });
});
