<template>
  <div class="phy-data-toolbar is-wrappable phy-data-toolbar--wrap">
    <!-- Filters contains query controls; actions contains create/export/bulk actions. -->
    <div class="phy-data-toolbar__filters">
      <slot name="filters">
        <slot />
      </slot>
    </div>
    <div v-if="$slots.actions" class="phy-data-toolbar__actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<style scoped>
.phy-data-toolbar {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--phy-space-16);
  width: 100%;
  min-width: 0;
  color: var(--phy-color-text);
  font-family: var(--phy-font-shell);
}

.phy-data-toolbar.is-wrappable,
.phy-data-toolbar--wrap {
  flex-wrap: wrap;
}

.phy-data-toolbar__filters,
.phy-data-toolbar__actions {
  display: flex;
  align-items: flex-end;
  gap: var(--phy-space-12);
  min-width: 0;
}

.phy-data-toolbar__filters {
  flex: 1 1 20rem;
  flex-wrap: wrap;
}

.phy-data-toolbar__actions {
  flex: 0 1 auto;
  flex-wrap: wrap;
  margin-inline-start: auto;
}

@media (max-width: 899px) {
  .phy-data-toolbar__actions {
    margin-inline-start: 0;
  }
}

@media (max-width: 599px) {
  .phy-data-toolbar {
    align-items: stretch;
    gap: var(--phy-space-12);
  }

  .phy-data-toolbar__filters,
  .phy-data-toolbar__actions {
    width: 100%;
    flex-basis: 100%;
  }
}
</style>
