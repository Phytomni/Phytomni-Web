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
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.phy-page-header__title :deep(h1) {
  margin: 0;
  font-size: 1.35rem;
  font-weight: 600;
  color: var(--phy-color-text);
}
.phy-page-header__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
