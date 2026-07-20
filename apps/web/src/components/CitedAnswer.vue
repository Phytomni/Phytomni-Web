<template>
  <div class="cited-answer">
    <MarkdownViewer
      :content="content"
      :instant-message="instantMessage"
      :ns="ns"
      :surface="surface"
      @finish="$emit('finish')"
    />
    <CitationReferenceList
      v-if="referencePresentation === 'inline'"
      :references="references"
      :ns="ns"
    />
  </div>
</template>

<script setup lang="ts">
import MarkdownViewer from "@/components/MarkdownViewer.vue";
import type { MarkdownSurface } from "@/components/MarkdownViewer.vue";
import CitationReferenceList from "@/components/CitationReferenceList.vue";

// Pure presentational renderer for cited-family answers (Knowledge / Review / BriefGene).
// Body -> MarkdownViewer (which linkifies [N] markers); reference list ->
// CitationReferenceList (buildDisplayReferences only). This component never reads
// chatStates / the store — the chat view passes instantMessage + @finish in (parallel-chat invariant).
withDefaults(
  defineProps<{
    content: string;
    references?: readonly unknown[];
    instantMessage?: boolean;
    ns?: string;
    surface?: MarkdownSurface;
    referencePresentation?: "inline" | "external";
  }>(),
  { referencePresentation: "inline" }
);

defineEmits<{ finish: [] }>();
</script>
