<template>
  <section class="phy-error-state" role="alert">
    <h2 v-if="title" class="phy-error-state__title">{{ title }}</h2>
    <p v-if="description" class="phy-error-state__description">
      {{ description }}
    </p>
    <button
      v-if="$slots.retry || retryLabel"
      class="phy-error-state__retry"
      type="button"
      @click="emit('retry')"
    >
      <slot name="retry">{{ retryLabel }}</slot>
    </button>
  </section>
</template>

<script setup lang="ts">
defineProps<{
  title?: string;
  description?: string;
  retryLabel?: string;
}>();

const emit = defineEmits<{
  retry: [];
}>();
</script>

<style scoped>
.phy-error-state {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--phy-space-8, 8px);
  color: var(--phy-color-text);
}

.phy-error-state__title,
.phy-error-state__description {
  max-width: 48rem;
  margin: 0;
}

.phy-error-state__title {
  font-size: 1rem;
  font-weight: 650;
  line-height: 1.35;
}

.phy-error-state__description {
  width: min(100%, var(--phy-layout-reading-max-width));
  color: var(--phy-color-text-secondary);
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.phy-error-state__retry {
  min-height: var(--phy-control-height-default, 40px);
  margin-top: var(--phy-space-8, 8px);
  padding: 8px 14px;
  border: 1px solid var(--phy-color-action-fill);
  border-radius: var(--phy-radius-sm, 8px);
  background: var(--phy-color-action-fill);
  color: var(--phy-color-on-action);
  cursor: pointer;
  font: inherit;
  font-weight: 600;
}

.phy-error-state__retry:hover {
  background: var(--phy-color-action-fill-hover);
  border-color: var(--phy-color-action-fill-hover);
}

.phy-error-state__retry:focus-visible {
  outline: 2px solid var(--phy-color-focus);
  outline-offset: 2px;
}
</style>
