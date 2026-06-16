import { ref, onUnmounted, nextTick } from "vue";
import type { Ref } from "vue";

export interface DeepGenomeTocOpts {
  headings: Ref<Array<{ id: string; [key: string]: unknown }>>;
  nestedHeadings: Ref<Array<{ id: string; children?: unknown[]; [key: string]: unknown }>>;
  mainContentRef: Ref<any>;
}

export function useDeepGenomeToc(opts: DeepGenomeTocOpts) {
  const { headings, nestedHeadings, mainContentRef } = opts;

  // 当前激活的标题 ID
  const activeHeadingId = ref("");

  // Intersection Observer 相关变量
  const observerRef = ref<IntersectionObserver | null>(null);
  const observedElements = ref<Set<Element>>(new Set());

  // 滚动到指定 id 的标题（内部使用，不对外暴露）
  const jumpTo = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      // 使用 nextTick 确保 DOM 更新后再滚动
      nextTick(() => {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }
  };

  // 导航菜单选中事件处理
  const handleNavSelect = (index: string) => {
    jumpTo(index);
  };

  // 改进的自动展开父菜单函数（内部使用，不对外暴露）
  const expandParentMenus = (id: string) => {
    // 首先找到当前激活项在嵌套结构中的路径
    const findPath = (
      items: Array<{ id: string; children?: unknown[]; [key: string]: unknown }>,
      targetId: string,
      path: string[] = []
    ): string[] | null => {
      for (const item of items) {
        if (item.id === targetId) {
          path.push(item.id);
          return path;
        }
        if (item.children && item.children.length > 0) {
          const childPath = findPath(
            item.children as Array<{ id: string; children?: unknown[]; [key: string]: unknown }>,
            targetId,
            [...path, item.id]
          );
          if (childPath) {
            return childPath;
          }
        }
      }
      return null;
    };

    const path = findPath(nestedHeadings.value, id);
    if (!path) return;

    // 展开路径中所有的父菜单（除了最后一个，即当前激活项本身）
    for (let i = 0; i < path.length - 1; i++) {
      const menuId = path[i];
      const subMenuItem = document.querySelector(
        `.el-sub-menu[index="${menuId}"]`
      );

      if (subMenuItem && !subMenuItem.classList.contains("is-opened")) {
        // 使用 Element Plus 的方法展开菜单
        const subMenuTitle = subMenuItem.querySelector(".el-sub-menu__title");
        if (subMenuTitle) {
          (subMenuTitle as HTMLElement).click(); // 模拟点击展开
        }
      }
    }
  };

  // 使用 Intersection Observer 监测标题元素
  const setupIntersectionObserver = () => {
    // 创建 Intersection Observer 实例
    const observer = new IntersectionObserver(
      (entries: IntersectionObserverEntry[]) => {
        const visibleHeadings: Array<{ id: string; top: number }> = [];

        entries.forEach((entry) => {
          const headingId = entry.target.id;

          if (entry.isIntersecting) {
            // 元素进入可视区域
            visibleHeadings.push({
              id: headingId,
              top: entry.boundingClientRect.top,
            });
          }
        });

        // 如果有可见的标题元素，找到最上方的那个作为当前激活的标题
        if (visibleHeadings.length > 0) {
          // 按视口中的位置排序，选择最上方的标题
          visibleHeadings.sort((a, b) => a.top - b.top);

          const currentActiveId = visibleHeadings[0].id;

          if (currentActiveId !== activeHeadingId.value) {
            activeHeadingId.value = currentActiveId;
            expandParentMenus(currentActiveId);
          }
        }
      },
      {
        // 设置根元素为滚动容器
        root: mainContentRef.value?.$el || mainContentRef.value,
        // 设置交叉比例，当元素有20%进入视口时触发
        threshold: 0.2,
        // 设置边距，提前或延后触发
        rootMargin: "-10% 0px -70% 0px",
      }
    );

    observerRef.value = observer;

    // 观察所有标题元素
    headings.value.forEach((heading) => {
      const element = document.getElementById(heading.id);
      if (element && !observedElements.value.has(element)) {
        observer.observe(element);
        observedElements.value.add(element);
      }
    });
  };

  // 确保在组件卸载时清理 Intersection Observer
  onUnmounted(() => {
    if (observerRef.value) {
      // 停止观察所有元素
      observedElements.value.forEach((element) => {
        observerRef.value!.unobserve(element);
      });
      // 断开观察者连接
      observerRef.value.disconnect();
      observerRef.value = null;
      observedElements.value.clear();
    }
  });

  return { activeHeadingId, handleNavSelect, setupIntersectionObserver };
}
