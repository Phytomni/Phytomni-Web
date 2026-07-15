<template>
  <div
    class="phy-adaptive-shell"
    ref="shellRef"
    :class="{
      'phy-adaptive-shell--normal': !artifactOpen && !artifactFullscreen,
      'phy-adaptive-shell--artifact-split': artifactOpen && !artifactFullscreen,
      'phy-adaptive-shell--artifact-fullscreen': artifactFullscreen,
      'is-sidebar-collapsed': sidebarCollapsed,
    }"
    data-scroll-root="adaptive"
  >
    <aside
      v-if="$slots.sidebar"
      class="phy-adaptive-shell__sidebar"
      :inert="artifactFullscreen ? true : undefined"
      :aria-hidden="artifactFullscreen ? 'true' : undefined"
    >
      <slot name="sidebar" />
    </aside>

    <main
      class="phy-adaptive-shell__main"
      :inert="mainInert || artifactFullscreen ? true : undefined"
      :aria-hidden="mainInert || artifactFullscreen ? 'true' : undefined"
    >
      <slot name="main">
        <slot />
      </slot>
    </main>

    <section
      v-if="$slots.artifact && (artifactOpen || artifactFullscreen)"
      class="phy-adaptive-shell__artifact"
      :role="artifactFullscreen ? 'dialog' : undefined"
      :aria-modal="artifactFullscreen ? 'true' : undefined"
      :aria-labelledby="
        artifactFullscreen ? 'research-artifact-title' : undefined
      "
      tabindex="-1"
      @keydown="handleArtifactKeydown"
    >
      <slot name="artifact" />
    </section>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from "vue";

const props = withDefaults(
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

const shellRef = ref<HTMLElement | null>(null);
let previousArtifactFocus: HTMLElement | null = null;

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

function getArtifactSection(): HTMLElement | null {
  return (
    shellRef.value?.querySelector<HTMLElement>(
      ".phy-adaptive-shell__artifact"
    ) ?? null
  );
}

function getArtifactFocusables(): HTMLElement[] {
  const artifact = getArtifactSection();
  return artifact
    ? Array.from(artifact.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    : [];
}

async function focusArtifact(): Promise<void> {
  await nextTick();
  const artifact = getArtifactSection();
  if (!artifact) return;
  getArtifactFocusables()[0]?.focus();
  if (
    document.activeElement !== artifact &&
    !artifact.contains(document.activeElement)
  ) {
    artifact.focus();
  }
}

function restoreArtifactFocus(): void {
  if (previousArtifactFocus?.isConnected) {
    previousArtifactFocus.focus();
  }
  previousArtifactFocus = null;
}

function handleArtifactKeydown(event: KeyboardEvent): void {
  if (!props.artifactFullscreen) return;

  if (event.key === "Escape") {
    event.preventDefault();
    const closeControl = getArtifactSection()?.querySelector<HTMLElement>(
      '[data-test="artifact-back"], [data-test="artifact-close"]'
    );
    closeControl?.click();
    return;
  }

  if (event.key !== "Tab") return;
  const artifact = getArtifactSection();
  const focusables = getArtifactFocusables();
  if (!artifact || focusables.length === 0) {
    event.preventDefault();
    artifact?.focus();
    return;
  }

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
  () => props.artifactFullscreen,
  (isFullscreen, wasFullscreen) => {
    if (isFullscreen && !wasFullscreen) {
      previousArtifactFocus =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      void focusArtifact();
      return;
    }
    if (!isFullscreen && wasFullscreen) {
      restoreArtifactFocus();
    }
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  restoreArtifactFocus();
});
</script>

<style scoped>
.phy-adaptive-shell {
  display: grid;
  grid-template-columns: var(--phy-layout-sidebar-expanded-width) minmax(0, 1fr);
  width: 100%;
  height: 100vh;
  height: 100dvh;
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
