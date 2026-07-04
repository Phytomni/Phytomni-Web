<template>
  <div class="md-block" v-html="rendered"></div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { ContentBlock } from "../../types";
import { renderStreamingMarkdown } from "../../streaming/incrementalMarkdown";

const props = defineProps<{ block: ContentBlock; ns?: string }>();
// renderStreamingMarkdown runs escapeHtml -> processInlineMarkdown (the v-html
// sanitization invariant); repair makes the partial buffer well-formed first.
const rendered = computed(() => renderStreamingMarkdown(props.block.text ?? "", props.ns ?? ""));
</script>
