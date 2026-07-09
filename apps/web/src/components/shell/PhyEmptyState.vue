<template>
  <div class="phy-empty-state">
    <h2 v-if="title" class="phy-empty-state__title">{{ title }}</h2>
    <p v-if="subtitle" class="phy-empty-state__subtitle">{{ subtitle }}</p>
    <div v-if="$slots.default" class="phy-empty-state__chips">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  title?: string;
  subtitle?: string;
}>();
</script>

<style scoped>
.phy-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 32px 16px;
  text-align: center;
  color: var(--phy-color-text);
}
.phy-empty-state__title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
}
.phy-empty-state__subtitle {
  margin: 0;
  color: var(--phy-color-text-secondary);
  max-width: 420px;
}
.phy-empty-state__chips {
  width: min(720px, 100%);
}
</style>
