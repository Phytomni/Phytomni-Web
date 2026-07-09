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

const props = defineProps<{
  props: Record<string, unknown>;
  disabled: boolean;
}>();
const emit = defineEmits<{
  submit: [value: { payload: Record<string, unknown> }];
}>();
const { t } = useI18n();

const title = computed(() => String(props.props.title ?? ""));
const body = computed(() =>
  props.props.body != null ? String(props.props.body) : "",
);
const confirmLabel = computed(() =>
  String(props.props.confirm_label ?? t("chat.a2ui.confirm")),
);
const cancelLabel = computed(() =>
  String(props.props.cancel_label ?? t("chat.a2ui.cancel")),
);

function emitSubmit(accepted: boolean) {
  if (props.disabled) return;
  emit("submit", { payload: { accepted } });
}
</script>
