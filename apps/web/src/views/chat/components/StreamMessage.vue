<template>
  <div class="stream-message">
    <template v-for="(block, i) in blocks" :key="i">
      <component
        :is="renderer(block.type)"
        v-if="renderer(block.type)"
        :block="block"
        :ns="citationNs"
      />
    </template>
    <!--
      Live-session only: phyto.references → message.doc_list is wired for the
      current stream so [N] can target #m<index>-ref-N rows. The Go accumulator
      does not persist a dedicated streaming-reference field, so after history
      reload these safe links are unavailable unless a separate L2 server/API
      design lands — do not invent persisted rows here.
    -->
    <CitationReferenceList
      v-if="references && references.length > 0"
      :references="references"
      :ns="citationNs"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, provide } from "vue";
import CitationReferenceList from "@/components/CitationReferenceList.vue";
import type { ContentBlock } from "../types";
import type { A2uiActionTransport } from "../streaming/a2uiAction";
import { resolveBlockRenderer } from "../streaming/blockRegistry";

const props = defineProps<{
  blocks: ContentBlock[];
  /** Page-unique citation namespace (m<index>); empty/absent → literal [N]. */
  ns?: string;
  /** Live phyto.references rows (message.doc_list); render only when nonempty. */
  references?: unknown[];
  runId?: string;
  transport?: A2uiActionTransport | null;
}>();

// Defense in depth: never pass a non-empty ns to markdown/reasoning (or the
// reference list) unless real reference rows exist — avoids dead #mN-ref-K
// anchors when a caller supplies ns without references.
const citationNs = computed(() =>
  props.references && props.references.length ? props.ns ?? "" : ""
);

provide(
  "a2uiRunId",
  computed(() => props.runId ?? "")
);
provide(
  "a2uiTransport",
  computed(() => props.transport ?? null)
);
const renderer = (type: string) => resolveBlockRenderer(type);
</script>
