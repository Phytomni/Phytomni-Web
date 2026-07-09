<template>
  <div class="agent-surface-block" :data-widget="block.widget">
    <p v-if="block.failed" class="a2ui-status">{{ t("chat.a2ui.failed") }}</p>
    <p v-else-if="locked" class="a2ui-status">{{ t("chat.a2ui.locked") }}</p>
    <p v-else-if="!canSend" class="a2ui-status">{{ t("chat.a2ui.expired") }}</p>
    <ConfirmWidget
      v-if="block.widget === 'confirm'"
      :props="block.props ?? {}"
      :disabled="!canInteract"
      @submit="onSubmit"
    />
    <FormWidget
      v-else-if="block.widget === 'form'"
      :props="block.props ?? {}"
      :disabled="!canInteract"
      @submit="onSubmit"
    />
    <ChoiceWidget
      v-else-if="block.widget === 'choice'"
      :props="block.props ?? {}"
      :disabled="!canInteract"
      @submit="onSubmit"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { ContentBlock } from "../../types";
import type { A2uiActionTransport } from "../../streaming/a2uiAction";
import {
  buildA2uiActionId,
  sendA2uiAction,
} from "../../streaming/a2uiAction";
import ConfirmWidget from "./a2ui/ConfirmWidget.vue";
import FormWidget from "./a2ui/FormWidget.vue";
import ChoiceWidget from "./a2ui/ChoiceWidget.vue";

const props = defineProps<{
  block: ContentBlock;
  runId: string;
  transport: A2uiActionTransport | null;
}>();

const { t } = useI18n();
const locked = ref(false);

const canSend = computed(
  () => !!props.transport && !!props.runId && !!props.block.surfaceId,
);
const canInteract = computed(
  () => canSend.value && !locked.value && !props.block.failed,
);

async function onSubmit(value: { payload: Record<string, unknown> }) {
  if (!canInteract.value || !props.transport) return;
  locked.value = true;
  const envelope = {
    surface_id: props.block.surfaceId as string,
    widget: String(props.block.widget ?? ""),
    action_id: buildA2uiActionId(),
    run_id: props.runId,
    payload: value.payload,
  };
  try {
    await sendA2uiAction(envelope, props.transport);
  } catch {
    // Keep locked — failed-not-unlocked. Parent may also stamp block.failed.
  }
}
</script>
