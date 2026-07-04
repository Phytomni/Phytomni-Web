<template>
  <div class="stream-message">
    <template v-for="(block, i) in blocks" :key="i">
      <component :is="renderer(block.type)" v-if="renderer(block.type)" :block="block" :ns="ns" />
    </template>
  </div>
</template>

<script setup lang="ts">
import type { ContentBlock } from "../types";
import { resolveBlockRenderer } from "../streaming/blockRegistry";

defineProps<{ blocks: ContentBlock[]; ns?: string }>();
const renderer = (type: string) => resolveBlockRenderer(type);
</script>
