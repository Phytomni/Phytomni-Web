<template>
  <div
    v-if="references && references.length > 0"
    ref="listRef"
    class="doc-list"
  >
    <div class="doc-list-title">{{ $t("chat.relatedDocuments") }}:</div>
    <div
      v-for="ref in displayReferences"
      :key="ref.id"
      :id="ref.id"
      :class="[
        'doc-list-item',
        { 'is-citation-target': activeReferenceIds.has(ref.id) },
      ]"
      tabindex="-1"
      :aria-current="activeReferenceIds.has(ref.id) ? 'true' : undefined"
      v-html="ref.html"
    ></div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { buildDisplayReferences } from "@/utils/reference-renderer";
import { focusReferenceRows } from "@/utils/scientific-markdown/reference-focus";

// Safe reference-list rows for cited-family and live streaming answers.
// The only v-html sink is fed exclusively by buildDisplayReferences output
// (escapeHtml + sanitizeHref); never bind a raw href or agent HTML.
const props = defineProps<{
  references?: readonly unknown[];
  /** Developer-owned page namespace (e.g. m<index>); never agent text. */
  ns: string;
}>();

const displayReferences = computed(() =>
  buildDisplayReferences(props.references ?? [], props.ns)
);
const listRef = ref<HTMLElement | null>(null);
const activeReferenceIds = ref<ReadonlySet<string>>(new Set());

function focusReferences(indices: readonly number[]): boolean {
  const ids = indices.map((index) => displayReferences.value[index - 1]?.id);
  if (!listRef.value || indices.length === 0 || ids.some((id) => !id)) {
    return false;
  }

  if (
    !focusReferenceRows({
      root: listRef.value,
      namespace: props.ns,
      indices,
    })
  ) {
    return false;
  }

  activeReferenceIds.value = new Set(
    ids.filter((id): id is string => typeof id === "string")
  );
  return true;
}

watch(displayReferences, () => {
  activeReferenceIds.value = new Set();
});

defineExpose({ focusReferences });
</script>

<style lang="scss" scoped>
.doc-list {
  min-width: 0;
  max-width: 100%;
  margin-top: 12px;
  overflow-wrap: anywhere;
}

.doc-list-title {
  font-weight: 600;
  margin-bottom: 6px;
}

.doc-list-item {
  min-width: 0;
  margin: 4px 0;
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.doc-list-item.is-citation-target {
  padding-inline: var(--phy-space-8);
  border-radius: var(--phy-radius-sm);
  background: var(--phy-color-accent-soft);
  box-shadow: inset 3px 0 0 var(--phy-color-accent);
}

.doc-list-item:focus-visible {
  outline: 2px solid var(--phy-color-focus);
  outline-offset: 2px;
}

:deep(.doc-citation) {
  line-height: 1.6;
}

:deep(.doc-link-inline) {
  overflow-wrap: anywhere;
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
</style>
