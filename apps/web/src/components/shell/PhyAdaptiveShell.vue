<template>
  <div
    class="phy-adaptive-shell"
    ref="shellRef"
    :class="{
      'phy-adaptive-shell--normal': !artifactOpen && !artifactFullscreen,
      'phy-adaptive-shell--artifact-split': artifactOpen && !artifactFullscreen,
      'phy-adaptive-shell--artifact-fullscreen': artifactFullscreen,
      'phy-adaptive-shell--execution': workspaceOpen && !workspaceFullscreen,
      'phy-adaptive-shell--execution-fullscreen': workspaceFullscreen,
      'has-execution-rail': railOpen && !!$slots.rail,
      'phy-adaptive-shell--rail-only':
        railOpen && !!$slots.rail && !workspaceOpen && !workspaceFullscreen,
      'has-shell-header': !!$slots.header,
      'is-sidebar-collapsed': sidebarCollapsed,
    }"
    data-scroll-root="adaptive"
  >
    <aside
      v-if="$slots.sidebar"
      class="phy-adaptive-shell__sidebar"
      :inert="artifactFullscreen || workspaceFullscreen ? true : undefined"
      :aria-hidden="
        artifactFullscreen || workspaceFullscreen ? 'true' : undefined
      "
    >
      <slot name="sidebar" />
    </aside>

    <div v-if="$slots.header" class="phy-adaptive-shell__header">
      <slot name="header" />
    </div>

    <main
      class="phy-adaptive-shell__main"
      :inert="
        mainInert || artifactFullscreen || workspaceFullscreen
          ? true
          : undefined
      "
      :aria-hidden="
        mainInert || artifactFullscreen || workspaceFullscreen
          ? 'true'
          : undefined
      "
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

    <section
      v-if="$slots.workspace && (workspaceOpen || workspaceFullscreen)"
      class="phy-adaptive-shell__workspace"
      :role="workspaceFullscreen ? 'dialog' : undefined"
      :aria-modal="workspaceFullscreen ? 'true' : undefined"
      tabindex="-1"
      @keydown="handleWorkspaceKeydown"
    >
      <slot name="workspace" />
    </section>

    <aside
      v-if="$slots.rail && railOpen && !workspaceFullscreen"
      class="phy-adaptive-shell__rail"
    >
      <slot name="rail" />
    </aside>
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
    workspaceOpen?: boolean;
    workspaceFullscreen?: boolean;
    railOpen?: boolean;
  }>(),
  {
    sidebarCollapsed: false,
    artifactOpen: false,
    artifactFullscreen: false,
    mainInert: false,
    workspaceOpen: false,
    workspaceFullscreen: false,
    railOpen: false,
  }
);

const shellRef = ref<HTMLElement | null>(null);
let previousArtifactFocus: HTMLElement | null = null;
let previousWorkspaceFocus: HTMLElement | null = null;

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

function getWorkspaceSection(): HTMLElement | null {
  return (
    shellRef.value?.querySelector<HTMLElement>(
      ".phy-adaptive-shell__workspace"
    ) ?? null
  );
}

function focusablesWithin(section: HTMLElement | null): HTMLElement[] {
  return section
    ? Array.from(section.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    : [];
}

function getArtifactFocusables(): HTMLElement[] {
  return focusablesWithin(getArtifactSection());
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
  if (!props.artifactFullscreen || event.defaultPrevented) return;

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
  if (
    event.target instanceof Element &&
    event.target.closest('[role="dialog"][aria-modal="true"]') !== artifact
  )
    return;
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

async function focusWorkspace(): Promise<void> {
  await nextTick();
  const workspace = getWorkspaceSection();
  if (!workspace) return;
  focusablesWithin(workspace)[0]?.focus();
  if (
    document.activeElement !== workspace &&
    !workspace.contains(document.activeElement)
  ) {
    workspace.focus();
  }
}

function restoreWorkspaceFocus(): void {
  if (previousWorkspaceFocus?.isConnected) {
    previousWorkspaceFocus.focus();
  }
  previousWorkspaceFocus = null;
}

function handleWorkspaceKeydown(event: KeyboardEvent): void {
  if (!props.workspaceFullscreen) return;
  const workspace = getWorkspaceSection();
  if (event.key === "Escape") {
    event.preventDefault();
    workspace
      ?.querySelector<HTMLElement>(
        '[data-test="execution-workspace-back"], [data-test="execution-workspace-close"]'
      )
      ?.click();
    return;
  }
  if (event.key !== "Tab") return;
  const focusables = focusablesWithin(workspace);
  if (!workspace || focusables.length === 0) {
    event.preventDefault();
    workspace?.focus();
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
      focusArtifact().catch(() => undefined);
      return;
    }
    if (!isFullscreen && wasFullscreen) {
      restoreArtifactFocus();
    }
  },
  { immediate: true }
);

watch(
  () => props.workspaceFullscreen,
  (isFullscreen, wasFullscreen) => {
    if (isFullscreen && !wasFullscreen) {
      previousWorkspaceFocus =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      focusWorkspace().catch(() => undefined);
      return;
    }
    if (!isFullscreen && wasFullscreen) {
      restoreWorkspaceFocus();
    }
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  restoreArtifactFocus();
  restoreWorkspaceFocus();
});
</script>

<style scoped>
.phy-adaptive-shell {
  position: relative;
  container-type: inline-size;
  display: grid;
  grid-template-columns: var(--phy-layout-sidebar-expanded-width) minmax(
      0,
      1fr
    );
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

.phy-adaptive-shell.has-shell-header {
  grid-template-rows: auto minmax(0, 1fr);
}

.phy-adaptive-shell__header {
  grid-column: 2 / -1;
  grid-row: 1;
  min-width: 0;
  min-height: 0;
}

.has-shell-header .phy-adaptive-shell__sidebar {
  grid-column: 1;
  grid-row: 1 / -1;
}

.has-shell-header .phy-adaptive-shell__main,
.has-shell-header .phy-adaptive-shell__artifact,
.has-shell-header .phy-adaptive-shell__workspace,
.has-shell-header .phy-adaptive-shell__rail {
  grid-row: 2;
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

.phy-adaptive-shell--execution {
  grid-template-columns:
    var(--phy-layout-sidebar-expanded-width)
    minmax(360px, 0.9fr)
    minmax(480px, 1.25fr);
}

.phy-adaptive-shell--execution.is-sidebar-collapsed {
  grid-template-columns:
    var(--phy-layout-sidebar-compact-width)
    minmax(360px, 0.9fr)
    minmax(480px, 1.25fr);
}

.phy-adaptive-shell--execution.has-execution-rail {
  grid-template-columns:
    var(--phy-layout-sidebar-expanded-width)
    minmax(340px, 0.82fr)
    minmax(440px, 1.18fr)
    minmax(240px, 280px);
}

.phy-adaptive-shell--execution.has-execution-rail.is-sidebar-collapsed {
  grid-template-columns:
    var(--phy-layout-sidebar-compact-width)
    minmax(340px, 0.82fr)
    minmax(440px, 1.18fr)
    minmax(240px, 280px);
}

.phy-adaptive-shell--execution-fullscreen {
  grid-template-columns: minmax(0, 1fr);
}

.phy-adaptive-shell--rail-only {
  grid-template-columns:
    var(--phy-layout-sidebar-expanded-width)
    minmax(0, 1fr)
    minmax(240px, 280px);
}

.phy-adaptive-shell--rail-only.is-sidebar-collapsed {
  grid-template-columns:
    var(--phy-layout-sidebar-compact-width)
    minmax(0, 1fr)
    minmax(240px, 280px);
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

.phy-adaptive-shell__workspace,
.phy-adaptive-shell__rail {
  min-width: 0;
  min-height: 0;
  width: 100%;
  height: 100%;
}

.phy-adaptive-shell__workspace {
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--phy-color-border-subtle);
}

.phy-adaptive-shell__rail {
  overflow: hidden;
}

.phy-adaptive-shell--execution-fullscreen .phy-adaptive-shell__sidebar,
.phy-adaptive-shell--execution-fullscreen .phy-adaptive-shell__header,
.phy-adaptive-shell--execution-fullscreen .phy-adaptive-shell__main,
.phy-adaptive-shell--execution-fullscreen .phy-adaptive-shell__artifact,
.phy-adaptive-shell--execution-fullscreen .phy-adaptive-shell__rail {
  display: none;
}

.phy-adaptive-shell--execution-fullscreen .phy-adaptive-shell__workspace {
  display: flex;
}

@media (max-width: 1279px) {
  .phy-adaptive-shell--execution.has-execution-rail,
  .phy-adaptive-shell--execution.has-execution-rail.is-sidebar-collapsed {
    grid-template-columns:
      var(--phy-layout-sidebar-compact-width)
      minmax(330px, 0.85fr)
      minmax(420px, 1.15fr);
  }

  .phy-adaptive-shell--execution .phy-adaptive-shell__rail {
    position: absolute;
    z-index: 20;
    top: 0;
    right: 0;
    width: min(320px, 88vw);
    box-shadow: var(--phy-shadow-lg);
  }

  .phy-adaptive-shell--execution.has-shell-header .phy-adaptive-shell__rail {
    top: var(--phy-control-height-primary);
    height: calc(100% - var(--phy-control-height-primary));
  }

  .phy-adaptive-shell--rail-only,
  .phy-adaptive-shell--rail-only.is-sidebar-collapsed {
    grid-template-columns: var(--phy-layout-sidebar-compact-width) minmax(
        0,
        1fr
      );
  }

  .phy-adaptive-shell--rail-only .phy-adaptive-shell__rail {
    position: absolute;
    z-index: 20;
    top: 0;
    right: 0;
    width: min(320px, 88vw);
    box-shadow: var(--phy-shadow-lg);
  }

  .phy-adaptive-shell--rail-only.has-shell-header .phy-adaptive-shell__rail {
    top: var(--phy-control-height-primary);
    height: calc(100% - var(--phy-control-height-primary));
  }
}

.phy-adaptive-shell__main,
.phy-adaptive-shell__artifact {
  display: flex;
  flex-direction: column;
}

@media (max-width: 899px) {
  .phy-adaptive-shell.has-shell-header .phy-adaptive-shell__header {
    grid-column: 1;
    grid-row: 1;
  }

  .phy-adaptive-shell__main[aria-hidden="true"] {
    visibility: hidden;
  }
}

.phy-adaptive-shell--artifact-fullscreen .phy-adaptive-shell__sidebar,
.phy-adaptive-shell--artifact-fullscreen .phy-adaptive-shell__header,
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

  .phy-adaptive-shell--normal.has-shell-header .phy-adaptive-shell__sidebar {
    grid-row: 1 / -1;
  }

  .phy-adaptive-shell--normal.has-shell-header .phy-adaptive-shell__main {
    grid-row: 2;
  }

  .phy-adaptive-shell--normal .phy-adaptive-shell__sidebar {
    width: 0;
  }

  .phy-adaptive-shell--execution,
  .phy-adaptive-shell--execution.is-sidebar-collapsed,
  .phy-adaptive-shell--execution.has-execution-rail,
  .phy-adaptive-shell--execution.has-execution-rail.is-sidebar-collapsed {
    grid-template-columns: minmax(0, 1fr);
  }

  .phy-adaptive-shell--execution .phy-adaptive-shell__sidebar,
  .phy-adaptive-shell--execution .phy-adaptive-shell__main,
  .phy-adaptive-shell--execution .phy-adaptive-shell__rail {
    display: none;
  }

  .phy-adaptive-shell--execution .phy-adaptive-shell__workspace {
    display: flex;
    grid-row: 2;
    grid-column: 1;
  }

  .phy-adaptive-shell--rail-only,
  .phy-adaptive-shell--rail-only.is-sidebar-collapsed {
    grid-template-columns: minmax(0, 1fr);
  }

  .phy-adaptive-shell--rail-only .phy-adaptive-shell__rail {
    position: fixed;
    z-index: 30;
    top: var(--phy-control-height-primary);
    right: 0;
    width: min(320px, 92vw);
    height: calc(100dvh - var(--phy-control-height-primary));
  }
}
</style>
