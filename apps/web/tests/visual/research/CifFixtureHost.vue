<template>
  <PhyAdaptiveShell
    v-if="nested"
    :artifact-open="true"
    :artifact-fullscreen="fullscreen"
    :sidebar-collapsed="true"
  >
    <template #main>Test-only nested artifact host</template>
    <template #artifact><slot /></template>
  </PhyAdaptiveShell>
  <slot v-else />
</template>

<script setup lang="ts">
import PhyAdaptiveShell from "@/components/shell/PhyAdaptiveShell.vue";

defineProps<{ nested: boolean; fullscreen: boolean }>();
</script>
