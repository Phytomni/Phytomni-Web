<template>
  <main class="phy-workspace-shell" data-scroll-root="workspace">
    <!-- Header owns page identity and primary actions; it does not own scrolling. -->
    <header v-if="$slots.header" class="phy-workspace-shell__header">
      <slot name="header" />
    </header>

    <!-- Filters owns query controls; page views keep search and filter state here. -->
    <section v-if="$slots.filters" class="phy-workspace-shell__filters">
      <slot name="filters" />
    </section>

    <!-- Default owns the page body; the shell supplies spacing and the single scroll root. -->
    <section class="phy-workspace-shell__content">
      <slot />
    </section>

    <!-- Footer is for in-flow pagination or summary actions, never a fixed page footer. -->
    <footer v-if="$slots.footer" class="phy-workspace-shell__footer">
      <slot name="footer" />
    </footer>
  </main>
</template>

<style scoped>
.phy-workspace-shell {
  --phy-workspace-gutter: var(--phy-space-40);
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: var(--phy-space-24);
  width: 100%;
  height: 100%;
  min-height: 0;
  min-width: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding: var(--phy-workspace-gutter);
  padding-bottom: calc(var(--phy-workspace-gutter) + var(--phy-space-24));
  scrollbar-gutter: stable;
  background: var(--phy-color-bg-page);
  color: var(--phy-color-text);
  font-family: var(--phy-font-shell);
}

.phy-workspace-shell__header,
.phy-workspace-shell__filters,
.phy-workspace-shell__content,
.phy-workspace-shell__footer {
  width: 100%;
  min-width: 0;
}

.phy-workspace-shell__header,
.phy-workspace-shell__filters {
  flex: 0 0 auto;
}

.phy-workspace-shell__content {
  flex: 0 0 auto;
}

.phy-workspace-shell__footer {
  flex: 0 0 auto;
}

@media (max-width: 1279px) {
  .phy-workspace-shell {
    --phy-workspace-gutter: var(--phy-space-32);
  }
}

@media (max-width: 899px) {
  .phy-workspace-shell {
    --phy-workspace-gutter: var(--phy-space-24);
  }
}

@media (max-width: 599px) {
  .phy-workspace-shell {
    --phy-workspace-gutter: var(--phy-space-16);
    gap: var(--phy-space-16);
  }
}
</style>
