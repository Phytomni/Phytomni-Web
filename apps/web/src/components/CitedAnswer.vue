<template>
  <div class="cited-answer">
    <ScientificMarkdownTypewriter
      v-if="instantMessage"
      :source="content"
      :citation-namespace="ns"
      :reference-count="references?.length ?? 0"
      :surface="surface"
      @finish="$emit('finish')"
    />
    <ScientificMarkdown
      v-else
      :source="content"
      :citation-namespace="ns"
      :reference-count="references?.length ?? 0"
      :surface="surface"
    />
    <CitationReferenceList
      v-if="referencePresentation === 'inline'"
      :references="references"
      :ns="ns"
    />
  </div>
</template>

<script setup lang="ts">
import ScientificMarkdown from "@/components/ScientificMarkdown.vue";
import ScientificMarkdownTypewriter from "@/components/ScientificMarkdownTypewriter.vue";
import CitationReferenceList from "@/components/CitationReferenceList.vue";
import type { MarkdownSurface } from "@/utils/scientific-markdown/types";

// Pure presentational renderer for cited-family answers (Knowledge / Review / BriefGene).
// Body -> the shared scientific renderer; reference list -> CitationReferenceList.
// This component never reads chatStates / the store — the chat view passes the
// typing state and finish callback in (parallel-chat invariant).
withDefaults(
  defineProps<{
    content: string;
    references?: readonly unknown[];
    instantMessage?: boolean;
    ns: string;
    surface?: MarkdownSurface;
    referencePresentation?: "inline" | "external";
  }>(),
  { instantMessage: false, surface: "reading", referencePresentation: "inline" }
);

defineEmits<{ finish: [] }>();
</script>

<style scoped>
.cited-answer {
  min-width: 0;
  max-width: 100%;
  overflow-wrap: anywhere;
}
</style>
