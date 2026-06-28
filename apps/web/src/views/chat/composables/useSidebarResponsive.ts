import { ref, watch, onMounted, onUnmounted } from "vue";

export function useSidebarResponsive(opts: {
  collapsed: () => boolean; // () => props.collapsed
  onCollapseChange: (value: boolean) => void; // (v) => emit("handleSidebarCollapse", v)
}) {
  // sidebar collapse state
  const sidebarCollapsed = ref(opts.collapsed());

  // responsive breakpoint (auto-collapse the sidebar below this width)
  const RESPONSIVE_BREAKPOINT = 1200;

  // debounce timer
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;

  // user preference - whether auto-expand is enabled
  const autoExpandEnabled = ref(true);

  // check the window size and auto-adjust the sidebar state
  const checkWindowSize = () => {
    const windowWidth = window.innerWidth;
    if (windowWidth < RESPONSIVE_BREAKPOINT && !sidebarCollapsed.value) {
      sidebarCollapsed.value = true;
    } else if (
      windowWidth >= RESPONSIVE_BREAKPOINT &&
      sidebarCollapsed.value &&
      autoExpandEnabled.value
    ) {
      sidebarCollapsed.value = false;
    }
  };

  // watch window size changes (debounced)
  const handleResize = () => {
    if (resizeTimer) {
      clearTimeout(resizeTimer);
    }
    resizeTimer = setTimeout(() => {
      checkWindowSize();
    }, 100); // 100ms debounce delay
  };

  // watch externally provided state changes
  watch(
    () => opts.collapsed(),
    (newVal) => {
      sidebarCollapsed.value = newVal;
    }
  );

  // watch internal state changes and notify the parent
  watch(sidebarCollapsed, (newVal) => {
    opts.onCollapseChange(newVal);
  });

  // watch the auto-expand setting and persist to localStorage
  watch(autoExpandEnabled, (newVal) => {
    localStorage.setItem("sidebarAutoExpand", JSON.stringify(newVal));
  });

  // expand the sidebar - only when it is collapsed
  const expandSidebar = () => {
    if (sidebarCollapsed.value) {
      sidebarCollapsed.value = false;
      // temporarily disable auto-expand when the user expands manually
      autoExpandEnabled.value = false;
      // re-enable auto-expand after 3 seconds
      setTimeout(() => {
        autoExpandEnabled.value = true;
      }, 3000);
    }
  };

  // collapse the sidebar
  const collapseSidebar = () => {
    sidebarCollapsed.value = true;
    // temporarily disable auto-expand when the user collapses manually
    autoExpandEnabled.value = false;
    // re-enable auto-expand after 3 seconds
    setTimeout(() => {
      autoExpandEnabled.value = true;
    }, 3000);
  };

  // on mount, check the window size and add listeners
  onMounted(() => {
    checkWindowSize();
    window.addEventListener("resize", handleResize);

    // read the user preference from localStorage
    const savedAutoExpand = localStorage.getItem("sidebarAutoExpand");
    if (savedAutoExpand !== null) {
      autoExpandEnabled.value = JSON.parse(savedAutoExpand);
    }
  });

  // on unmount, remove listeners and clear the timer
  onUnmounted(() => {
    window.removeEventListener("resize", handleResize);
    if (resizeTimer) {
      clearTimeout(resizeTimer);
    }
  });

  return { sidebarCollapsed, expandSidebar, collapseSidebar };
}
