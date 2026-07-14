<template>
  <div
    class="phy-adaptive-shell"
    :class="{
      'phy-adaptive-shell--normal': !artifactOpen && !artifactFullscreen,
      'phy-adaptive-shell--artifact-split': artifactOpen && !artifactFullscreen,
      'phy-adaptive-shell--artifact-fullscreen': artifactFullscreen,
      'is-sidebar-collapsed': sidebarCollapsed,
    }"
    data-scroll-root="adaptive"
  >
    <aside v-if="$slots.sidebar" class="phy-adaptive-shell__sidebar">
      <slot name="sidebar" />
    </aside>

    <main
      class="phy-adaptive-shell__main"
      :inert="mainInert ? true : undefined"
      :aria-hidden="mainInert ? 'true' : undefined"
    >
      <slot name="main">
        <slot />
      </slot>
    </main>

    <section
      v-if="$slots.artifact && (artifactOpen || artifactFullscreen)"
      class="phy-adaptive-shell__artifact"
    >
      <slot name="artifact" />
    </section>
  </div>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    sidebarCollapsed?: boolean;
    artifactOpen?: boolean;
    artifactFullscreen?: boolean;
    mainInert?: boolean;
  }>(),
  {
    sidebarCollapsed: false,
    artifactOpen: false,
    artifactFullscreen: false,
    mainInert: false,
  }
);
</script>

<style scoped>
.phy-adaptive-shell {
  display: grid;
  grid-template-columns: var(--phy-layout-sidebar-expanded-width) minmax(0, 1fr);
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--phy-color-bg-page);
  color: var(--phy-color-text);
  font-family: var(--phy-font-shell);
}

.phy-adaptive-shell.is-sidebar-collapsed {
  grid-template-columns: var(--phy-layout-sidebar-compact-width) minmax(0, 1fr);
}

.phy-adaptive-shell--artifact-split {
  grid-template-columns:
    var(--phy-layout-sidebar-expanded-width)
    minmax(0, 38fr)
    minmax(0, 62fr);
}

.phy-adaptive-shell--artifact-split.is-sidebar-collapsed {
  grid-template-columns:
    var(--phy-layout-sidebar-compact-width)
    minmax(0, 38fr)
    minmax(0, 62fr);
}

.phy-adaptive-shell.phy-adaptive-shell--artifact-fullscreen {
  grid-template-columns: minmax(0, 1fr);
}

.phy-adaptive-shell__sidebar,
.phy-adaptive-shell__main,
.phy-adaptive-shell__artifact {
  min-width: 0;
  min-height: 0;
  width: 100%;
  height: 100%;
}

.phy-adaptive-shell__main,
.phy-adaptive-shell__artifact {
  display: flex;
  flex-direction: column;
}

@media (max-width: 899px) {
  .phy-adaptive-shell__main[aria-hidden="true"] {
    visibility: hidden;
  }
}

.phy-adaptive-shell--artifact-fullscreen .phy-adaptive-shell__sidebar,
.phy-adaptive-shell--artifact-fullscreen .phy-adaptive-shell__main {
  display: none;
}

.phy-adaptive-shell--artifact-fullscreen .phy-adaptive-shell__artifact {
  display: flex;
}

@media (max-width: 899px) {
  .phy-adaptive-shell--artifact-split {
    grid-template-columns: minmax(0, 1fr);
  }

  .phy-adaptive-shell--artifact-split .phy-adaptive-shell__sidebar,
  .phy-adaptive-shell--artifact-split .phy-adaptive-shell__main {
    display: none;
  }

  .phy-adaptive-shell--artifact-split .phy-adaptive-shell__artifact {
    display: flex;
  }

  .phy-adaptive-shell--normal,
  .phy-adaptive-shell--normal.is-sidebar-collapsed {
    grid-template-columns: minmax(0, 1fr);
  }

  .phy-adaptive-shell--normal .phy-adaptive-shell__sidebar,
  .phy-adaptive-shell--normal .phy-adaptive-shell__main {
    grid-row: 1;
    grid-column: 1;
  }

  .phy-adaptive-shell--normal .phy-adaptive-shell__sidebar {
    width: 0;
  }
}
</style>
