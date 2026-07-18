<template>
  <svg
    class="phy-brand-mark"
    :width="size"
    :height="size"
    viewBox="0 0 32 32"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    :aria-label="label || undefined"
    :aria-hidden="label ? undefined : 'true'"
    focusable="false"
  >
    <title v-if="label">{{ label }}</title>
    <path
      class="phy-brand-mark__leaf"
      d="M25.7 4.7C17.4 5.2 10.2 8.7 7 14.7c-2.2 4.1-1.2 8.5 2.2 10.3 3.4 1.8 7.8-.1 10.4-3.8 2.9-4.1 3.8-9.5 6.1-16.5Z"
      fill="currentColor"
    />
    <path
      class="phy-brand-mark__vein"
      d="M6.8 27.4c4-7.5 9.9-12.3 17.4-16.8"
      stroke="currentColor"
      stroke-linecap="round"
      stroke-width="2"
    />
    <path
      class="phy-brand-mark__data-line"
      d="M14.1 20.7 16.2 18l2.3 1.5 2.8-4"
      stroke="currentColor"
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width="1.25"
    />
  </svg>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    label?: string;
    size?: number | string;
  }>(),
  {
    size: 24,
  }
);
</script>

<style scoped>
.phy-brand-mark {
  display: block;
  flex: 0 0 auto;
  color: var(--phy-color-accent, currentColor);
}
</style>
