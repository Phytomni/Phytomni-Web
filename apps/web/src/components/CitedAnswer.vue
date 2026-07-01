<template>
  <div class="cited-answer">
    <MarkdownViewer
      :content="content"
      :instant-message="instantMessage"
      :ns="ns"
      @finish="$emit('finish')"
    />
    <div v-if="references && references.length > 0" class="doc-list">
      <div class="doc-list-title">{{ $t("chat.relatedDocuments") }}：</div>
      <div
        v-for="ref in displayReferences"
        :key="ref.id"
        :id="ref.id"
        class="doc-list-item"
        v-html="ref.html"
      ></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import MarkdownViewer from "@/components/MarkdownViewer.vue";
import { buildDisplayReferences } from "@/utils/reference-renderer";

// Pure presentational renderer for cited-family answers (Knowledge / Review / BriefGene).
// Body -> MarkdownViewer (which linkifies [N] markers); reference list -> buildDisplayReferences,
// the single XSS-safe renderer (escapeHtml + sanitizeHref). The only v-html sink here is fed
// exclusively by buildDisplayReferences output; never bind a raw href. This component never reads
// chatStates / the store — the chat view passes instantMessage + @finish in (parallel-chat invariant).
const props = defineProps<{
  content: string;
  references?: any[];
  instantMessage?: boolean;
  ns?: string;
}>();

defineEmits<{ finish: [] }>();

const displayReferences = computed(() =>
  buildDisplayReferences(props.references || [], props.ns)
);
</script>

<style lang="scss" scoped>
.cited-answer {
  .doc-list {
    margin-top: 12px;
  }

  .doc-list-title {
    font-weight: 600;
    margin-bottom: 6px;
  }

  .doc-list-item {
    margin: 4px 0;
    line-height: 1.6;
  }

  :deep(.doc-citation) {
    line-height: 1.6;
  }

  :deep(.doc-link-inline) {
    word-break: break-all;
  }

  :deep(.doi-link),
  :deep(.pmid-link) {
    color: var(--el-color-primary);
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }
}
</style>
