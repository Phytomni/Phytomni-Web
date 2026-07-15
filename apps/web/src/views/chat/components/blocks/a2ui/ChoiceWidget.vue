<template>
  <div class="a2ui-choice">
    <div class="a2ui-title">{{ title }}</div>
    <el-checkbox-group
      v-if="multiple"
      v-model="selectedMulti"
      :disabled="disabled"
    >
      <el-checkbox v-for="o in options" :key="o.id" :value="o.id">
        {{ o.label }}
      </el-checkbox>
    </el-checkbox-group>
    <el-radio-group v-else v-model="selectedOne" :disabled="disabled">
      <el-radio v-for="o in options" :key="o.id" :value="o.id">
        {{ o.label }}
      </el-radio>
    </el-radio-group>
    <el-button
      data-test="a2ui-choice-submit"
      type="primary"
      :disabled="disabled || !hasSelection"
      @click="onSubmit"
    >
      {{ t("chat.a2ui.submit") }}
    </el-button>
    <el-button
      data-test="a2ui-choice-cancel"
      type="default"
      :disabled="disabled"
      @click="onCancel"
    >
      {{ t("chat.a2ui.cancel") }}
    </el-button>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import type {
  A2uiActionIntent,
  A2uiOpenSurface,
} from "../../../streaming/a2uiContract";

type ChoiceProps = Extract<A2uiOpenSurface, { widget: "choice" }>["props"];

const props = defineProps<{
  surface: ChoiceProps;
  disabled: boolean;
}>();
const emit = defineEmits<{
  action: [intent: Extract<A2uiActionIntent, { widget: "choice" }>];
}>();
const { t } = useI18n();
const title = computed(() => props.surface.title);
const multiple = computed(() => props.surface.multiple);
const options = computed(() => props.surface.options);
const selectedOne = ref<string>("");
const selectedMulti = ref<string[]>([]);
const hasSelection = computed(() =>
  multiple.value ? selectedMulti.value.length > 0 : !!selectedOne.value
);

function onSubmit() {
  if (props.disabled || !hasSelection.value) return;
  emit("action", {
    widget: "choice",
    payload: {
      selected: multiple.value ? [...selectedMulti.value] : selectedOne.value,
    },
  });
}

function onCancel() {
  if (props.disabled) return;
  emit("action", { widget: "choice", payload: { cancelled: true } });
}
</script>
