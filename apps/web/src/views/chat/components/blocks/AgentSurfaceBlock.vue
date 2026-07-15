<template>
  <div
    class="agent-surface-block"
    :data-widget="surface?.widget"
  >
    <p v-if="locked" class="a2ui-status">{{ t("chat.a2ui.locked") }}</p>
    <p v-else-if="!surface" class="a2ui-status">{{ t("chat.a2ui.expired") }}</p>
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

const locked = computed(() =>
  Boolean(surface.value && props.block.a2ui?.state.status !== "ready")
);
const canInteract = computed(() =>
  Boolean(
      surface.value &&
      props.block.a2ui?.state.status === "ready"
  )
);

function onAction(intent: A2uiActionIntent) {
  if (!canInteract.value) return;
  emit("action", intent);
}
</script>
