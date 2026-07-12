<template>
  <div class="reasoning-block">
    <template v-if="withinActivity">
      <div class="reasoning-body" v-html="rendered"></div>
    </template>
    <template v-else>
      <div class="reasoning-toggle" @click="open = !open">
        {{ open ? t("chat.reasoning.hide") : t("chat.reasoning.show") }}
      </div>
      <div v-if="open" class="reasoning-body" v-html="rendered"></div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { ContentBlock } from "../../types";
import { renderStreamingMarkdown } from "../../streaming/incrementalMarkdown";

const props = withDefaults(
  defineProps<{
    block: ContentBlock;
    ns?: string;
    /** When true, ChatActivity owns disclosure — render body only. */
    withinActivity?: boolean;
  }>(),
  {
    withinActivity: false,
  }
);
const { t } = useI18n();
const open = ref(false);
const rendered = computed(() =>
  renderStreamingMarkdown(props.block.text ?? "", props.ns ?? "")
);
</script>
