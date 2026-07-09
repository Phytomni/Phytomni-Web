<template>
  <aside
    class="phy-sidebar-frame"
    :class="{ 'is-collapsed': collapsed }"
  >
    <slot />
  </aside>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    collapsed?: boolean;
  }>(),
  { collapsed: false },
);
</script>

<style scoped>
.phy-sidebar-frame {
  height: 100%;
  background: var(--phy-color-bg-sidebar);
  border-right: 1px solid var(--phy-color-border);
  color: var(--phy-color-text);
  font-family: var(--phy-font-shell);
}
.phy-sidebar-frame.is-collapsed {
  /* Width still owned by consumer; frame only marks state for chrome. */
}
</style>
