import { ref, onUnmounted, nextTick } from "vue";
import type { Ref } from "vue";

export interface DeepGenomeTocHeading {
  id: string;
  children?: DeepGenomeTocHeading[];
  [key: string]: unknown;
}

export type DeepGenomeTocMainContentValue =
  HTMLElement | { $el?: Element | null } | null;

export interface DeepGenomeTocOpts {
  headings: Ref<Array<{ id: string; [key: string]: unknown }>>;
  nestedHeadings: Ref<DeepGenomeTocHeading[]>;
  mainContentRef: Ref<DeepGenomeTocMainContentValue>;
}

export function useDeepGenomeToc(opts: DeepGenomeTocOpts) {
  const { headings, nestedHeadings, mainContentRef } = opts;

  // currently active heading ID
  const activeHeadingId = ref("");

  // Intersection Observer state
  const observerRef = ref<IntersectionObserver | null>(null);
  const observedElements = ref<Set<Element>>(new Set());

  const resolveMainElement = (): HTMLElement | null => {
    const value = mainContentRef.value;
    const candidate = value instanceof HTMLElement ? value : value?.$el;
    return candidate instanceof HTMLElement ? candidate : null;
  };

  const resolveViewerRoot = (): HTMLElement | null =>
    resolveMainElement()?.closest<HTMLElement>(".deep-genome-viewer") ?? null;

  const findOwnedHeading = (id: string): HTMLElement | null => {
    const viewerRoot = resolveViewerRoot();
    if (!viewerRoot) return document.getElementById(id);

    return (
      Array.from(viewerRoot.querySelectorAll<HTMLElement>("[id]")).find(
        (element) => element.id === id
      ) ?? null
    );
  };

  const findScrollOwner = (): HTMLElement | null => {
    let element: HTMLElement | null = resolveMainElement();

    while (
      element &&
      element !== document.body &&
      element !== document.documentElement
    ) {
      const overflowY = window.getComputedStyle(element).overflowY;
      const ownsVerticalScroll = element.scrollHeight > element.clientHeight;
      if (/^(auto|scroll|overlay)$/.test(overflowY) && ownsVerticalScroll) {
        return element;
      }
      element = element.parentElement;
    }

    return null;
  };

  // scroll to the heading with the given id (internal, not exposed)
  const jumpTo = (id: string) => {
    const element = findOwnedHeading(id);
    if (element) {
      // use nextTick to scroll after the DOM updates
      nextTick(() => {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
      }).catch(() => undefined);
    }
  };

  // navigation menu select handler
  const handleNavSelect = (index: string) => {
    jumpTo(index);
  };

  // improved auto-expand of parent menus (internal, not exposed)
  const expandParentMenus = (id: string) => {
    // first find the active item's path in the nested structure
    const findPath = (
      items: Array<{
        id: string;
        children?: DeepGenomeTocHeading[];
        [key: string]: unknown;
      }>,
      targetId: string,
      path: string[] = []
    ): string[] | null => {
      for (const item of items) {
        if (item.id === targetId) {
          path.push(item.id);
          return path;
        }
        if (item.children && item.children.length > 0) {
          const childPath = findPath(item.children, targetId, [
            ...path,
            item.id,
          ]);
          if (childPath) {
            return childPath;
          }
        }
      }
      return null;
    };

    const path = findPath(nestedHeadings.value, id);
    if (!path) return;

    // expand all parent menus along the path (except the last, which is the active item itself)
    for (let i = 0; i < path.length - 1; i++) {
      const menuId = path[i];
      if (!menuId) continue;
      const queryRoot =
        resolveViewerRoot()?.querySelector(".deep-genome-toc") ?? document;
      const subMenuItem = Array.from(
        queryRoot.querySelectorAll<HTMLElement>(".el-sub-menu[index]")
      ).find((element) => element.getAttribute("index") === menuId);

      if (subMenuItem && !subMenuItem.classList.contains("is-opened")) {
        // expand the menu via Element Plus's mechanism
        const subMenuTitle = subMenuItem.querySelector(".el-sub-menu__title");
        if (subMenuTitle) {
          (subMenuTitle as HTMLElement).click(); // simulate a click to expand
        }
      }
    }
  };

  // observe heading elements with an Intersection Observer
  const setupIntersectionObserver = () => {
    // create the Intersection Observer instance
    const observer = new IntersectionObserver(
      (entries: IntersectionObserverEntry[]) => {
        const visibleHeadings: Array<{ id: string; top: number }> = [];

        entries.forEach((entry) => {
          const headingId = entry.target.id;

          if (entry.isIntersecting) {
            // element entered the viewport
            visibleHeadings.push({
              id: headingId,
              top: entry.boundingClientRect.top,
            });
          }
        });

        // if there are visible headings, pick the topmost as the active heading
        if (visibleHeadings.length > 0) {
          // sort by viewport position and choose the topmost heading
          visibleHeadings.sort((a, b) => a.top - b.top);

          const topHeading = visibleHeadings[0];
          if (!topHeading) return;
          const currentActiveId = topHeading.id;

          if (currentActiveId !== activeHeadingId.value) {
            activeHeadingId.value = currentActiveId;
            expandParentMenus(currentActiveId);
          }
        }
      },
      {
        // set the root to the scroll container
        root: findScrollOwner(),
        // trigger when 20% of the element is in the viewport
        threshold: 0.2,
        // margin to trigger earlier or later
        rootMargin: "-10% 0px -70% 0px",
      }
    );

    observerRef.value = observer;

    // observe all heading elements
    headings.value.forEach((heading) => {
      const element = findOwnedHeading(heading.id);
      if (element && !observedElements.value.has(element)) {
        observer.observe(element);
        observedElements.value.add(element);
      }
    });
  };

  // clean up the Intersection Observer on unmount
  onUnmounted(() => {
    const observer = observerRef.value;
    if (observer) {
      // stop observing all elements
      observedElements.value.forEach((element) => {
        observer.unobserve(element);
      });
      // disconnect the observer
      observer.disconnect();
      observerRef.value = null;
      observedElements.value.clear();
    }
  });

  return { activeHeadingId, handleNavSelect, setupIntersectionObserver };
}
