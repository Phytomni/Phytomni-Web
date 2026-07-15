<template>
  <div
    ref="surfaceRoot"
    class="agent-surface-block"
    :data-widget="surface?.widget"
    tabindex="-1"
    :aria-busy="isSubmitting ? 'true' : undefined"
  >
    <p v-if="statusMessageKey" class="a2ui-status" role="status" aria-live="polite">
      {{ t(statusMessageKey) }}
    </p>
    <p
      v-else-if="!surface"
      class="a2ui-status"
      role="status"
      aria-live="polite"
    >
      {{ t("chat.a2ui.expired") }}
    </p>
    <button
      v-if="canRetry"
      data-test="a2ui-retry"
      class="a2ui-retry"
      type="button"
      :aria-label="t('chat.a2ui.retry')"
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
import { computed, nextTick, onMounted, ref, watch } from "vue";
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
const surfaceRoot = ref<HTMLElement | null>(null);
const focusedRound2Key = ref<string | null>(null);
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
const isSubmitting = computed(
  () => props.block.a2ui?.state.status === "submitting"
);
const canRetry = computed(
  () => props.block.a2ui?.state.status === "temporarily_rejected"
);
const statusMessageKey = computed(() => {
  const state = props.block.a2ui?.state;
  if (!state) return undefined;

  switch (state.status) {
    case "ready":
      return state.lastError === "not_sent" ? "chat.a2ui.notSent" : undefined;
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

async function focusFreshRound2Surface() {
  const runtime = props.block.a2ui;
  if (
    !runtime ||
    runtime.state.status !== "ready" ||
    runtime.state.round !== 2
  ) {
    return;
  }
  const key = `${runtime.surface.surface_id}:round-2`;
  if (focusedRound2Key.value === key) return;
  await nextTick();
  if (focusedRound2Key.value === key || !surfaceRoot.value) return;
  focusedRound2Key.value = key;
  try {
    surfaceRoot.value.focus({ preventScroll: true });
  } catch {
    surfaceRoot.value.focus();
  }
}

onMounted(focusFreshRound2Surface);
watch(
  () => {
    const runtime = props.block.a2ui;
    return runtime
      ? [runtime.surface.surface_id, runtime.state.round, runtime.state.status]
      : [];
  },
  focusFreshRound2Surface
);

</script>

<style scoped>
.agent-surface-block :focus-visible {
  outline: 2px solid var(--phy-color-focus);
  outline-offset: 2px;
}

.agent-surface-block button {
  min-height: var(--phy-control-height-default);
}

@media (hover: none), (pointer: coarse) {
  .agent-surface-block button {
    min-height: calc(var(--phy-control-height-default) + var(--phy-space-4));
  }
}
</style>
