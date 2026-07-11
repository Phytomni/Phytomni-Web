<template>
  <section
    class="phy-async-state"
    :class="`phy-async-state--${state}`"
    :aria-busy="state === 'loading' ? 'true' : 'false'"
  >
    <div v-if="state === 'loading'" class="phy-async-state__loading" role="status" aria-live="polite">
      <slot name="loading" />
    </div>

    <div v-else-if="state === 'empty'" class="phy-async-state__empty" role="status" aria-live="polite">
      <slot name="empty" />
    </div>

    <div v-else-if="state === 'error'" class="phy-async-state__error" role="alert">
      <slot name="error" />
    </div>

    <div v-else class="phy-async-state__ready">
      <div class="phy-async-state__content">
        <slot name="ready"><slot /></slot>
      </div>
      <div v-if="$slots.actions" class="phy-async-state__actions">
        <slot name="actions" />
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
type AsyncState = "loading" | "empty" | "error" | "ready";

defineProps<{
  state: AsyncState;
}>();
</script>

<style scoped>
.phy-async-state {
  display: block;
  min-width: 0;
  color: var(--phy-color-text);
}

.phy-async-state__loading,
.phy-async-state__empty,
.phy-async-state__error {
  min-width: 0;
}

.phy-async-state__ready {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--phy-space-16, 16px);
}

.phy-async-state__content,
.phy-async-state__actions {
  min-width: 0;
}

.phy-async-state__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--phy-space-8, 8px);
}
</style>
