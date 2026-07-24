<template>
  <div class="phy-doc-layout">
    <header v-if="$slots.header" class="phy-doc-layout__header">
      <slot name="header" />
    </header>
    <div v-if="$slots.metadata" class="phy-doc-layout__metadata">
      <slot name="metadata" />
    </div>
    <div class="phy-doc-layout__content">
      <aside v-if="$slots.toc" class="phy-doc-layout__toc">
        <slot name="toc" />
      </aside>
      <div class="phy-doc-body phy-reading">
        <slot />
      </div>
    </div>
    <footer v-if="$slots.footer" class="phy-doc-layout__footer">
      <slot name="footer" />
    </footer>
  </div>
</template>

<script setup lang="ts"></script>

<style scoped>
.phy-doc-layout {
  box-sizing: border-box;
  container-type: inline-size;
  min-width: 0;
  background: var(--phy-color-bg-page);
  color: var(--phy-color-text);
  font-family: var(--phy-font-shell);
}
.phy-doc-layout__header {
  box-sizing: border-box;
  width: min(100%, 1060px);
  margin: 0 auto;
  border-bottom: 1px solid var(--phy-color-border);
  background: var(--phy-color-bg-elevated);
  padding: 16px 20px;
}
.phy-doc-layout__metadata {
  box-sizing: border-box;
  width: min(100%, 760px);
  margin: 0 auto;
  padding: 20px 20px 0;
}
.phy-doc-layout__content {
  display: grid;
  grid-template-columns: minmax(180px, 220px) minmax(0, 760px);
  gap: 24px;
  width: min(100%, var(--phy-layout-document-max-width));
  min-width: 0;
  margin: 0 auto;
  padding: 24px 20px 48px;
  box-sizing: border-box;
}
.phy-doc-layout__toc {
  box-sizing: border-box;
  position: sticky;
  top: 16px;
  align-self: flex-start;
  background: var(--phy-color-bg-elevated);
  border: 1px solid var(--phy-color-border);
  border-radius: var(--phy-radius-md);
  padding: 12px;
}
.phy-doc-body {
  width: min(100%, 760px);
  max-width: 760px;
  min-width: 0;
}
.phy-doc-layout__footer {
  box-sizing: border-box;
  width: min(100%, 760px);
  margin: 0 auto;
  padding: 0 20px 24px;
}
@media (max-width: 899px) {
  .phy-doc-layout__content {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .phy-doc-layout__toc {
    position: static;
    width: 100%;
  }
}

@media (max-width: 599px) {
  .phy-doc-layout__header {
    padding-inline: 16px;
  }

  .phy-doc-layout__metadata,
  .phy-doc-layout__content,
  .phy-doc-layout__footer {
    padding-inline: 16px;
  }
}
</style>
