<template>
  <pre
    v-if="showPlainStreamingSource"
    class="md-block phy-markdown phy-markdown--chat scientific-markdown__stream-fallback"
    >{{ block.text ?? "" }}</pre>
  <ScientificMarkdown
    v-else
    class="md-block"
    :source="block.text ?? ''"
    surface="chat"
    :citation-namespace="ns"
    :reference-count="referenceCount"
    :streaming="streaming"
  />
</template>

<script setup lang="ts">
import { computed } from "vue";
import ScientificMarkdown from "@/components/ScientificMarkdown.vue";
import type { ContentBlock } from "../../types";

const props = withDefaults(
  defineProps<{
    block: ContentBlock;
    ns?: string;
    referenceCount?: number;
    streaming?: boolean;
  }>(),
  {
    ns: "",
    referenceCount: 0,
    streaming: false,
  }
);

const showPlainStreamingSource = computed(
  () => props.streaming && hasUnclosedDisplayMath(props.block.text ?? "")
);

function hasUnclosedDisplayMath(source: string): boolean {
  let fenceCount = 0;
  for (let index = 0; index < source.length - 1; index += 1) {
    if (
      source[index] === "$" &&
      source[index + 1] === "$" &&
      !isEscaped(source, index)
    ) {
      fenceCount += 1;
      index += 1;
    }
  }
  return fenceCount % 2 === 1;
}

function isEscaped(source: string, index: number): boolean {
  let slashCount = 0;
  for (
    let cursor = index - 1;
    cursor >= 0 && source[cursor] === "\\";
    cursor -= 1
  ) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}
</script>
