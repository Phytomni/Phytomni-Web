<template>
  <aside
    ref="sidebarRef"
    class="phy-adaptive-sidebar"
    :role="drawerOpen ? 'dialog' : undefined"
    :aria-modal="drawerOpen ? 'true' : undefined"
    :aria-labelledby="drawerOpen ? 'phy-adaptive-sidebar-title' : undefined"
    :inert="offCanvas ? true : undefined"
    :aria-hidden="offCanvas ? 'true' : undefined"
    :class="{
      'is-collapsed': collapsed,
      'is-drawer-open': drawerOpen,
    }"
  >
    <button
      v-if="drawerOpen"
      type="button"
      class="phy-adaptive-sidebar__scrim"
      data-action="close"
      :aria-label="closeLabel"
      @click="emit('close')"
    />

    <div class="phy-adaptive-sidebar__surface" @keydown="handleKeydown">
      <h2
        v-if="drawerOpen"
        id="phy-adaptive-sidebar-title"
        class="phy-adaptive-sidebar__dialog-title"
      >
        {{ dialogLabel }}
      </h2>
      <div v-if="$slots.toggle" class="phy-adaptive-sidebar__toggle">
        <button
          type="button"
          data-action="toggle"
          aria-label="Toggle sidebar"
          :aria-expanded="!collapsed"
          @click="emit('toggle')"
        >
          <slot name="toggle" />
        </button>
      </div>

      <div
        v-if="$slots.close && drawerOpen"
        class="phy-adaptive-sidebar__close"
      >
        <button
          type="button"
          data-action="close"
          data-testid="sidebar-drawer-close"
          :aria-label="closeLabel"
          @click="emit('close')"
        >
          <slot name="close" />
        </button>
      </div>

      <div class="phy-adaptive-sidebar__content">
        <slot />
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from "vue";

const props = withDefaults(
  defineProps<{
    collapsed?: boolean;
    drawerOpen?: boolean;
    closeLabel?: string;
    offCanvas?: boolean;
    dialogLabel?: string;
  }>(),
  {
    collapsed: false,
    drawerOpen: false,
    closeLabel: "Close sidebar",
    offCanvas: false,
    dialogLabel: "Sidebar",
  }
);

const emit = defineEmits<{
  (event: "close"): void;
  (event: "toggle"): void;
}>();

const sidebarRef = ref<HTMLElement | null>(null);
let previousDrawerFocus: HTMLElement | null = null;

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

function getSurfaceFocusables(): HTMLElement[] {
  return sidebarRef.value
    ? Array.from(
        sidebarRef.value.querySelectorAll<HTMLElement>(
          `.phy-adaptive-sidebar__surface ${FOCUSABLE_SELECTOR}`
        )
      )
    : [];
}

function focusDrawer(): void {
  void nextTick(() => {
    const closeControl = sidebarRef.value?.querySelector<HTMLElement>(
      '[data-testid="sidebar-drawer-close"]'
    );
    const focusTarget = closeControl || getSurfaceFocusables()[0];
    focusTarget?.focus();
  });
}

function restoreDrawerFocus(): void {
  if (previousDrawerFocus?.isConnected) {
    previousDrawerFocus.focus();
  }
  previousDrawerFocus = null;
}

function handleKeydown(event: KeyboardEvent): void {
  if (!props.drawerOpen) return;

  if (event.key === "Escape") {
    event.preventDefault();
    emit("close");
    return;
  }

  if (event.key !== "Tab") return;
  const focusables = getSurfaceFocusables();
  if (focusables.length === 0) return;

  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

watch(
  () => props.drawerOpen,
  (isOpen, wasOpen) => {
    if (isOpen && !wasOpen) {
      previousDrawerFocus =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      focusDrawer();
      return;
    }
    if (!isOpen && wasOpen) {
      restoreDrawerFocus();
    }
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  restoreDrawerFocus();
});
</script>

<style scoped>
.phy-adaptive-sidebar {
  position: relative;
  width: var(--phy-layout-sidebar-expanded-width);
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--phy-color-bg-sidebar);
  color: var(--phy-color-text);
  font-family: var(--phy-font-shell);
}

.phy-adaptive-sidebar__surface {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border-right: 1px solid var(--phy-color-border-subtle);
  background: var(--phy-color-bg-sidebar);
  box-shadow: var(--phy-shadow-soft);
}

.phy-adaptive-sidebar.is-collapsed .phy-adaptive-sidebar__surface {
  width: 100%;
}

.phy-adaptive-sidebar.is-collapsed {
  width: var(--phy-layout-sidebar-compact-width);
}

.phy-adaptive-sidebar__toggle,
.phy-adaptive-sidebar__close {
  flex: 0 0 auto;
}

.phy-adaptive-sidebar__close {
  display: none;
}

.phy-adaptive-sidebar__toggle button,
.phy-adaptive-sidebar__close button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: var(--phy-control-height-default);
  min-height: var(--phy-control-height-default);
  padding: var(--phy-space-8);
  border: 0;
  border-radius: var(--phy-radius-sm);
  background: transparent;
  color: var(--phy-color-text-secondary);
  cursor: pointer;
}

.phy-adaptive-sidebar__toggle button:hover,
.phy-adaptive-sidebar__close button:hover {
  background: var(--phy-color-fill-subtle);
  color: var(--phy-color-text);
}

.phy-adaptive-sidebar__toggle button:focus-visible,
.phy-adaptive-sidebar__close button:focus-visible {
  outline: 2px solid var(--phy-color-focus);
  outline-offset: 2px;
}

.phy-adaptive-sidebar__content {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.phy-adaptive-sidebar__dialog-title {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.phy-adaptive-sidebar__scrim {
  display: none;
}

@media (max-width: 899px) {
  .phy-adaptive-sidebar {
    position: fixed;
    inset: 0;
    width: 100vw;
    z-index: var(--phy-z-drawer);
    pointer-events: none;
    background: transparent;
  }

  .phy-adaptive-sidebar.is-drawer-open {
    pointer-events: auto;
  }

  .phy-adaptive-sidebar__surface {
    position: relative;
    z-index: 1;
    width: var(--phy-layout-sidebar-expanded-width);
    max-width: calc(100vw - var(--phy-space-32));
    transform: translateX(-100%);
    transition: transform var(--phy-motion-normal) var(--phy-motion-ease-out);
  }

  .phy-adaptive-sidebar__close {
    position: absolute;
    inset-block-start: var(--phy-space-8);
    inset-inline-end: var(--phy-space-8);
    z-index: 2;
    display: block;
  }

  .phy-adaptive-sidebar__close button {
    background: var(--phy-color-fill-subtle);
    color: var(--phy-color-text);
  }

  .phy-adaptive-sidebar.is-drawer-open .phy-adaptive-sidebar__surface {
    transform: translateX(0);
  }

  .phy-adaptive-sidebar__scrim {
    position: absolute;
    inset: 0;
    z-index: 0;
    display: block;
    width: 100%;
    height: 100%;
    padding: 0;
    border: 0;
    background: var(--phy-color-overlay);
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--phy-motion-normal) var(--phy-motion-ease-out);
  }

  .phy-adaptive-sidebar.is-drawer-open .phy-adaptive-sidebar__scrim {
    opacity: 1;
    pointer-events: auto;
  }
}

@media (prefers-reduced-motion: reduce) {
  .phy-adaptive-sidebar__surface,
  .phy-adaptive-sidebar__scrim {
    transition: none;
  }
}
</style>
