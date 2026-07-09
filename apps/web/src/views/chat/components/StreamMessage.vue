<template>
  <div class="stream-message">
    <template v-for="(block, i) in blocks" :key="i">
      <component
        :is="renderer(block.type)"
        v-if="renderer(block.type)"
        :block="block"
        :ns="ns"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, provide } from "vue";
import type { ContentBlock } from "../types";
import type { A2uiActionTransport } from "../streaming/a2uiAction";
import { resolveBlockRenderer } from "../streaming/blockRegistry";

const props = defineProps<{
  blocks: ContentBlock[];
  ns?: string;
  runId?: string;
  transport?: A2uiActionTransport | null;
}>();
provide(
  "a2uiRunId",
  computed(() => props.runId ?? ""),
);
provide(
  "a2uiTransport",
  computed(() => props.transport ?? null),
);
const renderer = (type: string) => resolveBlockRenderer(type);
</script>
