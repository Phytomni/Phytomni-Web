<template>
  <p
    v-if="pendingLabel"
    class="execution-pending"
    role="status"
    aria-live="polite"
  >
    {{ pendingLabel }}
  </p>
  <ChatActivity
    :state-key="`execution:${run.executionId}`"
    :expanded="expanded"
    :label="t('chat.execution.activity')"
    :hide-count="true"
    :streaming="
      executionActivityIsStreaming(
        run,
        lifecycle?.terminal === true,
        messageStatus
      )
    "
    :lifecycle="lifecycle ?? undefined"
    @update:expanded="emit('update:expanded', $event)"
  >
    <ExecutionTimeline
      :run="run"
      @open-target="(target, title) => emit('open-target', target, title)"
      @open-diagnostics="emit('open-diagnostics')"
    />
  </ChatActivity>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { AgentTaskLifecycle } from "@/api/types";
import ChatActivity from "./ChatActivity.vue";
import ExecutionTimeline from "./ExecutionTimeline.vue";
import { executionActivityIsStreaming } from "../executionActivityPresentation";
import type {
  ExecutionRunState,
  ExecutionTarget,
} from "../streaming/executionEvents";

const props = defineProps<{
  run: ExecutionRunState;
  expanded: boolean;
  lifecycle?: AgentTaskLifecycle | null;
  messageStatus?: string | null;
}>();

const emit = defineEmits<{
  "update:expanded": [open: boolean];
  "open-target": [target: ExecutionTarget, title: string];
  "open-diagnostics": [];
}>();

const { t } = useI18n();
const pendingLabel = computed(() => {
  const key = props.run.executionStage?.pendingStatusKey;
  if (!key || props.run.outputText || props.run.terminal) return null;
  const chatKey = `chat.${key}`;
  return t(chatKey);
});
</script>

<style scoped>
.execution-pending {
  margin: 0 0 6px;
  color: var(--phy-color-text-muted);
  font-size: 12px;
  line-height: 1.5;
}
</style>
