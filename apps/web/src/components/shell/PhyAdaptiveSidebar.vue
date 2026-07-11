<template>
  <aside
    class="phy-adaptive-sidebar"
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
      aria-label="Close sidebar"
      @click="emit('close')"
    />

    <div class="phy-adaptive-sidebar__surface">
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

      <div v-if="$slots.close" class="phy-adaptive-sidebar__close">
        <button
          type="button"
          data-action="close"
          aria-label="Close sidebar"
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
withDefaults(
  defineProps<{
    collapsed?: boolean;
    drawerOpen?: boolean;
  }>(),
  {
    collapsed: false,
    drawerOpen: false,
  }
);

const emit = defineEmits<{
  (event: "close"): void;
  (event: "toggle"): void;
}>();
</script>

<style scoped>
.phy-adaptive-sidebar {
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  background: var(--phy-color-bg-sidebar);
  color: var(--phy-color-text);
  font-family: var(--phy-font-shell);
}

.phy-adaptive-sidebar__surface {
  display: flex;
  flex-direction: column;
  width: var(--phy-layout-sidebar-expanded-width);
  height: 100%;
  min-width: 0;
  min-height: 0;
  border-right: 1px solid var(--phy-color-border-subtle);
  background: var(--phy-color-bg-sidebar);
  box-shadow: var(--phy-shadow-soft);
}

.phy-adaptive-sidebar.is-collapsed .phy-adaptive-sidebar__surface {
  width: var(--phy-layout-sidebar-compact-width);
}

.phy-adaptive-sidebar__toggle,
.phy-adaptive-sidebar__close {
  flex: 0 0 auto;
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

.phy-adaptive-sidebar__scrim {
  display: none;
}

@media (max-width: 899px) {
  .phy-adaptive-sidebar {
    position: fixed;
    inset: 0;
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
