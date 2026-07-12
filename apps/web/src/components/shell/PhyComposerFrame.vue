<template>
  <div class="phy-composer-frame">
    <div v-if="$slots.attachments" class="phy-composer-frame__attachments">
      <slot name="attachments" />
    </div>
    <div class="phy-composer-frame__body">
      <slot />
    </div>
    <div v-if="$slots.actions" class="phy-composer-frame__actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<script setup lang="ts"></script>

<style scoped>
.phy-composer-frame {
  border: 1px solid var(--phy-color-border);
  border-radius: var(--phy-radius-lg);
  background: var(--phy-color-bg-elevated);
  box-shadow: var(--phy-shadow-soft);
  padding: 10px 12px;
  transition: border-color 160ms ease, box-shadow 160ms ease;
}

.phy-composer-frame:focus-within {
  border-color: var(--phy-color-focus);
  box-shadow: var(--phy-shadow-soft),
    0 0 0 2px color-mix(in srgb, var(--phy-color-focus) 16%, transparent);
}

.phy-composer-frame__attachments {
  margin-bottom: 8px;
}
.phy-composer-frame__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}
</style>
