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
  padding: 8px 10px;
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
