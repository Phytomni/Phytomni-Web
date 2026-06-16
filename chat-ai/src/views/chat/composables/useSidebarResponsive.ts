import { ref, watch, onMounted, onUnmounted } from "vue";

export function useSidebarResponsive(opts: {
  collapsed: () => boolean; // () => props.collapsed
  onCollapseChange: (value: boolean) => void; // (v) => emit("handleSidebarCollapse", v)
}) {
  // 侧边栏折叠状态
  const sidebarCollapsed = ref(opts.collapsed());

  // 响应式断点（小于此宽度时自动收起侧边栏）
  const RESPONSIVE_BREAKPOINT = 1200;

  // 防抖定时器
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;

  // 用户偏好设置 - 是否启用自动展开功能
  const autoExpandEnabled = ref(true);

  // 检查窗口大小并自动调整侧边栏状态
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

  // 监听窗口大小变化（带防抖）
  const handleResize = () => {
    if (resizeTimer) {
      clearTimeout(resizeTimer);
    }
    resizeTimer = setTimeout(() => {
      checkWindowSize();
    }, 100); // 100ms 防抖延迟
  };

  // 监听外部传入的状态变化
  watch(
    () => opts.collapsed(),
    (newVal) => {
      sidebarCollapsed.value = newVal;
    }
  );

  // 监听内部状态变化，通知父组件
  watch(sidebarCollapsed, (newVal) => {
    opts.onCollapseChange(newVal);
  });

  // 监听自动展开设置变化，保存到localStorage
  watch(autoExpandEnabled, (newVal) => {
    localStorage.setItem("sidebarAutoExpand", JSON.stringify(newVal));
  });

  // 展开侧边栏 - 只有当侧边栏是折叠状态时才能展开
  const expandSidebar = () => {
    if (sidebarCollapsed.value) {
      sidebarCollapsed.value = false;
      // 用户手动展开时，暂时禁用自动展开功能
      autoExpandEnabled.value = false;
      // 3秒后重新启用自动展开功能
      setTimeout(() => {
        autoExpandEnabled.value = true;
      }, 3000);
    }
  };

  // 折叠侧边栏
  const collapseSidebar = () => {
    sidebarCollapsed.value = true;
    // 用户手动收起时，暂时禁用自动展开功能
    autoExpandEnabled.value = false;
    // 3秒后重新启用自动展开功能
    setTimeout(() => {
      autoExpandEnabled.value = true;
    }, 3000);
  };

  // 组件挂载时检查窗口大小并添加监听器
  onMounted(() => {
    checkWindowSize();
    window.addEventListener("resize", handleResize);

    // 从localStorage读取用户偏好设置
    const savedAutoExpand = localStorage.getItem("sidebarAutoExpand");
    if (savedAutoExpand !== null) {
      autoExpandEnabled.value = JSON.parse(savedAutoExpand);
    }
  });

  // 组件卸载时移除监听器和清理定时器
  onUnmounted(() => {
    window.removeEventListener("resize", handleResize);
    if (resizeTimer) {
      clearTimeout(resizeTimer);
    }
  });

  return { sidebarCollapsed, expandSidebar, collapseSidebar };
}
