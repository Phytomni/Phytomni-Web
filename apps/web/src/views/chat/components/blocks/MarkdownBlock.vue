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
    @citation-activate="emit('citation-activate', $event)"
  />
</template>

<script setup lang="ts">
import { computed } from "vue";
import ScientificMarkdown from "@/components/ScientificMarkdown.vue";
import type { ScientificCitationActivation } from "@/utils/scientific-markdown/types";
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

const emit = defineEmits<{
  "citation-activate": [activation: ScientificCitationActivation];
}>();

const showPlainStreamingSource = computed(
  () => props.streaming && hasUnclosedDisplayMath(props.block.text ?? "")
);

function hasUnclosedDisplayMath(source: string): boolean {
  let codeFence: { marker: "`" | "~"; length: number } | null = null;
  let inlineCodeLength = 0;
  let fenceCount = 0;
  for (const line of source.split("\n")) {
    const fence = codeFenceDelimiter(line);
    if (fence) {
      if (!codeFence) {
        codeFence = fence;
      } else if (
        fence.marker === codeFence.marker &&
        fence.length >= codeFence.length
      ) {
        codeFence = null;
      }
      continue;
    }
    if (codeFence) continue;

    for (let index = 0; index < line.length; index += 1) {
      if (line[index] === "`") {
        const length = markerLength(line, index, "`");
        if (inlineCodeLength === 0) inlineCodeLength = length;
        else if (length === inlineCodeLength) inlineCodeLength = 0;
        index += length - 1;
        continue;
      }
      if (
        inlineCodeLength === 0 &&
        line[index] === "$" &&
        index + 1 < line.length &&
        line[index + 1] === "$" &&
        !isEscaped(line, index)
      ) {
        fenceCount += 1;
        index += 1;
      }
    }
  }
  return fenceCount % 2 === 1;
}

function codeFenceDelimiter(line: string): {
  marker: "`" | "~";
  length: number;
} | null {
  const match = line.match(/^ {0,3}(`{3,}|~{3,})/);
  if (!match) return null;
  const marker = match[1][0] as "`" | "~";
  return { marker, length: match[1].length };
}

function markerLength(source: string, index: number, marker: string): number {
  let length = 0;
  while (source[index + length] === marker) length += 1;
  return length;
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
