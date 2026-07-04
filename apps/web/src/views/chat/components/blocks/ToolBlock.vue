<template>
  <div class="tool-block">
    <span class="tool-label">{{ label }}</span>
    <span v-if="block.count != null" class="tool-count">{{ countLabel }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { ContentBlock } from "../../types";

const props = defineProps<{ block: ContentBlock }>();
const { t } = useI18n();
// Web owns the copy: map the structured toolName to a localized label, with a
// generic fallback so an unknown tool still renders sensibly.
const label = computed(() =>
  t(`chat.tools.${props.block.toolName}`, props.block.toolName ?? t("chat.tools.generic"))
);
const countLabel = computed(() => t("chat.toolHits", { count: props.block.count }));
</script>
