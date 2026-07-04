<template>
  <div class="step-block">{{ label }}</div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { ContentBlock } from "../../types";

const props = defineProps<{ block: ContentBlock }>();
const { t } = useI18n();
const label = computed(() =>
  t(`chat.steps.${props.block.label}`, props.block.label ?? "")
);
</script>
