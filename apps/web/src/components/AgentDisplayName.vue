<template>
  <span class="agent-display-name">
    <template v-if="parts">
      <span v-if="parts.before">{{ parts.before }}</span>
      <em class="agent-display-name__scientific">{{ parts.phrase }}</em>
      <span v-if="parts.after">{{ parts.after }}</span>
    </template>
    <template v-else>{{ label }}</template>
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{ label: string }>();

const parts = computed(() => {
  const match = /\bin silico\b/i.exec(props.label);
  if (!match || match.index === undefined) return null;
  const start = match.index;
  const end = start + match[0].length;
  return {
    before: props.label.slice(0, start),
    phrase: props.label.slice(start, end),
    after: props.label.slice(end),
  };
});
</script>

<style scoped>
.agent-display-name {
  min-width: 0;
}

.agent-display-name__scientific {
  font-style: italic;
}
</style>
