import { computed, onMounted, onUnmounted, ref, watch } from "vue";

/** The persisted desktop preference for the Chat control-plane sidebar. */
export const SIDEBAR_COLLAPSED_PREFERENCE_KEY = "sidebarCollapsedPreference";
/** The pre-v2 key, retained only for one-time migration. */
export const SIDEBAR_LEGACY_AUTO_EXPAND_KEY = "sidebarAutoExpand";
export const SIDEBAR_MOBILE_BREAKPOINT = 900;
export const SIDEBAR_COMPACT_BREAKPOINT = 1280;

type SidebarResponsiveOptions = {
  collapsed: () => boolean;
  drawerOpen?: () => boolean;
  onCollapseChange: (value: boolean) => void;
  onDrawerOpenChange?: (value: boolean) => void;
};

function readBoolean(value: string | null): boolean | null {
  if (value === null) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "boolean" ? parsed : null;
  } catch {
    return null;
  }
}

function readStoredPreference(fallback: boolean): boolean {
  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    const stored = window.localStorage.getItem(
      SIDEBAR_COLLAPSED_PREFERENCE_KEY
    );
    if (stored !== null) {
      const parsed = readBoolean(stored);
      if (parsed !== null) {
        return parsed;
      }
      window.localStorage.removeItem(SIDEBAR_COLLAPSED_PREFERENCE_KEY);
    }

    const legacy = window.localStorage.getItem(SIDEBAR_LEGACY_AUTO_EXPAND_KEY);
    if (legacy !== null) {
      const parsed = readBoolean(legacy);
      window.localStorage.removeItem(SIDEBAR_LEGACY_AUTO_EXPAND_KEY);
      if (parsed !== null) {
        const migrated = !parsed;
        window.localStorage.setItem(
          SIDEBAR_COLLAPSED_PREFERENCE_KEY,
          JSON.stringify(migrated)
        );
        return migrated;
      }
    }
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }

  return fallback;
}

function persistPreference(value: boolean): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      SIDEBAR_COLLAPSED_PREFERENCE_KEY,
      JSON.stringify(value)
    );
  } catch {
    // A blocked storage area must not prevent the sidebar from working.
  }
}

function getWindowWidth(): number {
  return typeof window === "undefined" ? SIDEBAR_COMPACT_BREAKPOINT : window.innerWidth;
}

/**
 * Owns sidebar breakpoint derivation and the desktop/mobile interaction state.
 * Rendering remains the responsibility of PhyAdaptiveSidebar.
 */
export function useSidebarResponsive(opts: SidebarResponsiveOptions) {
  const viewportWidth = ref(getWindowWidth());
  const collapsedPreference = ref(readStoredPreference(opts.collapsed()));
  const drawerOpen = ref(opts.drawerOpen?.() ?? false);

  const isMobile = computed(
    () => viewportWidth.value < SIDEBAR_MOBILE_BREAKPOINT
  );
  const sidebarCollapsed = computed(
    () =>
      !isMobile.value &&
      (viewportWidth.value < SIDEBAR_COMPACT_BREAKPOINT ||
        collapsedPreference.value)
  );

  let resizeTimer: ReturnType<typeof setTimeout> | null = null;

  const emitDrawerState = (value: boolean) => {
    opts.onDrawerOpenChange?.(value);
  };

  const updateViewport = () => {
    viewportWidth.value = getWindowWidth();
    if (!isMobile.value && drawerOpen.value) {
      drawerOpen.value = false;
    }
  };

  const handleResize = () => {
    if (resizeTimer !== null) {
      clearTimeout(resizeTimer);
    }
    resizeTimer = setTimeout(() => {
      resizeTimer = null;
      updateViewport();
    }, 100);
  };

  const setCollapsedPreference = (value: boolean) => {
    if (collapsedPreference.value === value) {
      return;
    }
    collapsedPreference.value = value;
    if (!isMobile.value) {
      persistPreference(value);
    }
  };

  const openDrawer = () => {
    if (!isMobile.value || drawerOpen.value) {
      return;
    }
    drawerOpen.value = true;
  };

  const closeDrawer = () => {
    if (!drawerOpen.value) {
      return;
    }
    drawerOpen.value = false;
  };

  const toggle = () => {
    if (isMobile.value) {
      if (drawerOpen.value) {
        closeDrawer();
      } else {
        openDrawer();
      }
      return;
    }
    setCollapsedPreference(!collapsedPreference.value);
  };

  // Compatibility names used by the current Sidebar until the root shell is remounted.
  const expandSidebar = () => {
    if (isMobile.value) {
      openDrawer();
      return;
    }
    setCollapsedPreference(false);
  };

  const collapseSidebar = () => {
    if (isMobile.value) {
      closeDrawer();
      return;
    }
    setCollapsedPreference(true);
  };

  watch(
    sidebarCollapsed,
    (value, previousValue) => {
      if (value !== previousValue) {
        opts.onCollapseChange(value);
      }
    }
  );

  watch(drawerOpen, emitDrawerState);

  watch(
    () => opts.collapsed(),
    (value) => {
      // A compact derived state must not turn a resize into a stored preference.
      if (isMobile.value || viewportWidth.value < SIDEBAR_COMPACT_BREAKPOINT) {
        return;
      }
      setCollapsedPreference(value);
    }
  );

  if (opts.drawerOpen) {
    watch(opts.drawerOpen, (value) => {
      if (value !== drawerOpen.value) {
        drawerOpen.value = value;
      }
    });
  }

  onMounted(() => {
    updateViewport();
    window.addEventListener("resize", handleResize);
    if (opts.collapsed() !== sidebarCollapsed.value) {
      opts.onCollapseChange(sidebarCollapsed.value);
    }
  });

  onUnmounted(() => {
    window.removeEventListener("resize", handleResize);
    if (resizeTimer !== null) {
      clearTimeout(resizeTimer);
      resizeTimer = null;
    }
  });

  return {
    isMobile,
    collapsedPreference,
    drawerOpen,
    sidebarCollapsed,
    effectiveCollapsed: sidebarCollapsed,
    toggle,
    openDrawer,
    closeDrawer,
    expandSidebar,
    collapseSidebar,
  };
}
