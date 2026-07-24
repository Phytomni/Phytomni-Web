<template>
  <div class="phy-page-header">
    <div class="phy-page-header__title">
      <slot name="title">
        <h1 v-if="title">{{ title }}</h1>
      </slot>
    </div>
    <div v-if="$slots.actions" class="phy-page-header__actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  title?: string;
}>();
</script>

<style scoped>
.phy-page-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--phy-space-12);
  min-width: 0;
}
.phy-page-header__title {
  flex: 1 1 16rem;
  min-width: 0;
}
.phy-page-header__title :deep(h1) {
  margin: 0;
  font-size: 1.35rem;
  font-weight: 600;
  color: var(--phy-color-text);
}
.phy-page-header__actions {
  display: flex;
  flex: 0 1 auto;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--phy-space-12);
  min-width: 0;
}
</style>
