<template>
  <div class="a2ui-confirm">
    <div class="a2ui-title">{{ title }}</div>
    <div v-if="body" class="a2ui-body">{{ body }}</div>
    <div class="a2ui-actions">
      <el-button :disabled="disabled" @click="emitSubmit(false)">
        {{ cancelLabel }}
      </el-button>
      <el-button type="primary" :disabled="disabled" @click="emitSubmit(true)">
        {{ confirmLabel }}
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type {
  A2uiActionIntent,
  A2uiOpenSurface,
} from "../../../streaming/a2uiContract";

type ConfirmProps = Extract<A2uiOpenSurface, { widget: "confirm" }>["props"];

const props = defineProps<{
  surface: ConfirmProps;
  disabled: boolean;
}>();
const emit = defineEmits<{
  action: [intent: Extract<A2uiActionIntent, { widget: "confirm" }>];
}>();
const { t } = useI18n();

const title = computed(() => props.surface.title);
const body = computed(() => props.surface.body ?? "");
const confirmLabel = computed(
  () => props.surface.confirm_label?.trim() || t("common.confirm")
);
const cancelLabel = computed(
  () => props.surface.cancel_label?.trim() || t("common.cancel")
);

function emitSubmit(accepted: boolean) {
  if (props.disabled) return;
  emit("action", { widget: "confirm", payload: { accepted } });
}
</script>
