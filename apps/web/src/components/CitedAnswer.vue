<template>
  <div class="cited-answer">
    <MarkdownViewer
      :content="content"
      :instant-message="instantMessage"
      :ns="ns"
      @finish="$emit('finish')"
    />
    <CitationReferenceList :references="references" :ns="ns" />
  </div>
</template>

<script setup lang="ts">
import MarkdownViewer from "@/components/MarkdownViewer.vue";
import CitationReferenceList from "@/components/CitationReferenceList.vue";

// Pure presentational renderer for cited-family answers (Knowledge / Review / BriefGene).
// Body -> MarkdownViewer (which linkifies [N] markers); reference list ->
// CitationReferenceList (buildDisplayReferences only). This component never reads
// chatStates / the store — the chat view passes instantMessage + @finish in (parallel-chat invariant).
defineProps<{
  content: string;
  references?: any[];
  instantMessage?: boolean;
  ns?: string;
}>();

defineEmits<{ finish: [] }>();
</script>
