<template>
  <ScientificMarkdown
    :source="visibleSource"
    :surface="surface"
    :citation-namespace="citationNamespace"
    :reference-count="referenceCount"
    :resources="resources"
    streaming
    @citation-activate="$emit('citation-activate', $event)"
    @resource-activate="$emit('resource-activate', $event)"
  />
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import ScientificMarkdown from "@/components/ScientificMarkdown.vue";
import type {
  AuthorizedScientificResource,
  MarkdownSurface,
  ScientificCitationActivation,
  ScientificResourceActivation,
} from "@/utils/scientific-markdown/types";

const props = withDefaults(
  defineProps<{
    source: string;
    surface?: MarkdownSurface;
    citationNamespace: string;
    referenceCount?: number;
    resources?: readonly AuthorizedScientificResource[];
  }>(),
  {
    surface: "reading",
    referenceCount: 0,
    resources: () => [],
  }
);

const emit = defineEmits<{
  finish: [];
  "citation-activate": [activation: ScientificCitationActivation];
  "resource-activate": [activation: ScientificResourceActivation];
}>();

const visibleSource = ref("");
let timer: ReturnType<typeof setTimeout> | null = null;
let cursor = 0;
let finishedSource: string | null = null;
let previousSource: string | null = null;

function clearTimer(): void {
  if (timer === null) return;
  clearTimeout(timer);
  timer = null;
}

function codePoints(source: string): string[] {
  return Array.from(source);
}

function isStrictAppend(source: string): boolean {
  return (
    previousSource !== null &&
    source.startsWith(previousSource) &&
    codePoints(source).length > codePoints(previousSource).length
  );
}

function scheduleTick(): void {
  clearTimer();
  if (cursor >= codePoints(props.source).length) return;
  timer = setTimeout(tick, 20);
}

function tick(): void {
  timer = null;
  const source = codePoints(props.source);
  cursor = Math.min(cursor + 10, source.length);
  visibleSource.value = source.slice(0, cursor).join("");

  if (cursor === source.length) {
    if (finishedSource !== props.source) {
      finishedSource = props.source;
      emit("finish");
    }
    return;
  }
  timer = setTimeout(tick, 20);
}

function syncSource(source: string): void {
  if (!isStrictAppend(source)) {
    clearTimer();
    cursor = 0;
    visibleSource.value = "";
    finishedSource = null;
  }
  previousSource = source;
  scheduleTick();
}

watch(() => props.source, syncSource, { immediate: true });
onBeforeUnmount(clearTimer);
</script>
