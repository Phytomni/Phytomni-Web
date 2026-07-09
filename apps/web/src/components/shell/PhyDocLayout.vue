<template>
  <div class="phy-doc-layout">
    <header v-if="$slots.header" class="phy-doc-layout__header">
      <slot name="header" />
    </header>
    <div class="phy-doc-layout__content">
      <aside v-if="$slots.toc" class="phy-doc-layout__toc">
        <slot name="toc" />
      </aside>
      <div class="phy-doc-body phy-reading">
        <slot />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts"></script>

<style scoped>
.phy-doc-layout {
  min-height: 100vh;
  background: var(--phy-color-bg-page);
  color: var(--phy-color-text);
  font-family: var(--phy-font-shell);
}
.phy-doc-layout__header {
  border-bottom: 1px solid var(--phy-color-border);
  background: var(--phy-color-bg-elevated);
  padding: 16px 20px;
}
.phy-doc-layout__content {
  display: flex;
  gap: 24px;
  max-width: 1100px;
  margin: 0 auto;
  padding: 24px 20px 48px;
  box-sizing: border-box;
}
.phy-doc-layout__toc {
  flex: 0 0 220px;
  position: sticky;
  top: 16px;
  align-self: flex-start;
  background: var(--phy-color-bg-elevated);
  border: 1px solid var(--phy-color-border);
  border-radius: var(--phy-radius-md);
  padding: 12px;
}
.phy-doc-body {
  flex: 1;
  min-width: 0;
  max-width: 760px;
}
@media (max-width: 900px) {
  .phy-doc-layout__content {
    flex-direction: column;
  }
  .phy-doc-layout__toc {
    position: static;
    flex-basis: auto;
    width: 100%;
  }
}
</style>
