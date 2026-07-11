<template>
  <div class="phy-empty-state">
    <div v-if="$slots.mark" class="phy-empty-state__mark" aria-hidden="true">
      <slot name="mark" />
    </div>
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
  gap: var(--phy-space-12);
  padding: 32px 16px;
  text-align: center;
  color: var(--phy-color-text);
}
.phy-empty-state__mark {
  display: grid;
  place-items: center;
  min-height: var(--phy-control-height-primary);
}
.phy-empty-state__title {
  margin: 0;
  font-size: clamp(1.25rem, 2vw, 1.75rem);
  font-weight: 600;
  letter-spacing: -0.02em;
}
.phy-empty-state__subtitle {
  margin: 0;
  color: var(--phy-color-text-secondary);
  max-width: 560px;
  line-height: 1.6;
}
.phy-empty-state__chips {
  width: min(760px, 100%);
}
</style>
