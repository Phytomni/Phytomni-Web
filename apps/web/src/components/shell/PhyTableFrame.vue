<template>
  <div class="phy-table-frame">
    <!-- Default owns the actual table and its columns; this frame owns surface and overflow. -->
    <div
      class="phy-table-frame__overflow phy-table-frame__scroll"
      data-horizontal-scroll="table"
    >
      <slot />
    </div>

    <!-- Pagination owns page state and controls; it remains in normal document flow. -->
    <div v-if="$slots.pagination" class="phy-table-frame__pagination">
      <slot name="pagination" />
    </div>
  </div>
</template>

<style scoped>
.phy-table-frame {
  --el-table-header-bg-color: var(--phy-color-fill-subtle);
  --el-table-tr-bg-color: var(--phy-color-bg-elevated);
  width: 100%;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--phy-color-border-subtle);
  border-radius: var(--phy-radius-md);
  background: var(--phy-color-bg-elevated);
  color: var(--phy-color-text);
  font-family: var(--phy-font-shell);
}

.phy-table-frame__overflow {
  width: 100%;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  background: var(--phy-color-bg-elevated);
  scrollbar-gutter: stable;
}

.phy-table-frame__pagination {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  min-height: var(--phy-control-height-default);
  padding: var(--phy-space-12) var(--phy-space-16);
  border-top: 1px solid var(--phy-color-border-subtle);
  background: var(--phy-color-bg-elevated);
}

@media (max-width: 599px) {
  .phy-table-frame__pagination {
    justify-content: flex-start;
    padding-inline: var(--phy-space-12);
  }
}
</style>
