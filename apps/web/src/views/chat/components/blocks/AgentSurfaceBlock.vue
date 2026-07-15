<template>
  <div
    class="agent-surface-block"
    :data-widget="surface?.widget"
  >
    <p v-if="statusMessageKey" class="a2ui-status">
      {{ t(statusMessageKey) }}
    </p>
    <p v-else-if="!surface" class="a2ui-status">{{ t("chat.a2ui.expired") }}</p>
    <button
      v-if="canRetry"
      data-test="a2ui-retry"
      class="a2ui-retry"
      type="button"
      @click="onRetry"
    >
      {{ t("chat.a2ui.retry") }}
    </button>
    <ConfirmWidget
      v-if="confirmSurface"
      :surface="confirmSurface.props"
      :disabled="!canInteract"
      @action="onAction"
    />
    <FormWidget
      v-else-if="formSurface"
      :surface="formSurface.props"
      :disabled="!canInteract"
      @action="onAction"
    />
    <ChoiceWidget
      v-else-if="choiceSurface"
      :surface="choiceSurface.props"
      :disabled="!canInteract"
      @action="onAction"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { ContentBlock } from "../../types";
import type {
  A2uiActionIntent,
  A2uiOpenSurface,
} from "../../streaming/a2uiContract";
import ConfirmWidget from "./a2ui/ConfirmWidget.vue";
import FormWidget from "./a2ui/FormWidget.vue";
import ChoiceWidget from "./a2ui/ChoiceWidget.vue";

const props = defineProps<{
  block: ContentBlock;
}>();
const emit = defineEmits<{
  action: [intent: A2uiActionIntent];
  retry: [];
}>();

const { t } = useI18n();
const surface = computed(() => props.block.a2ui?.surface);
const confirmSurface = computed<
  Extract<A2uiOpenSurface, { widget: "confirm" }> | undefined
>(() => (surface.value?.widget === "confirm" ? surface.value : undefined));
const formSurface = computed<
  Extract<A2uiOpenSurface, { widget: "form" }> | undefined
>(() => (surface.value?.widget === "form" ? surface.value : undefined));
const choiceSurface = computed<
  Extract<A2uiOpenSurface, { widget: "choice" }> | undefined
>(() => (surface.value?.widget === "choice" ? surface.value : undefined));

const canInteract = computed(
  () => props.block.a2ui?.state.status === "ready"
);
const canRetry = computed(
  () => props.block.a2ui?.state.status === "temporarily_rejected"
);
const statusMessageKey = computed(() => {
  const state = props.block.a2ui?.state;
  if (!state) return undefined;

  switch (state.status) {
    case "submitting":
      return "chat.a2ui.submitting";
    case "resolved":
      return `chat.a2ui.${state.resolution}`;
    case "rejected":
      return "chat.a2ui.rejected";
    case "temporarily_rejected":
      return "chat.a2ui.temporarilyRejected";
    case "expired":
      return "chat.a2ui.expired";
    case "unknown":
      return "chat.a2ui.unknown";
    case "protocol_error":
      return "chat.a2ui.protocolError";
    default:
      return undefined;
  }
});

function onAction(intent: A2uiActionIntent) {
  if (!canInteract.value) return;
  emit("action", intent);
}

function onRetry() {
  if (!canRetry.value) return;
  emit("retry");
}

</script>
