<template>
  <div class="a2ui-choice">
    <div class="a2ui-title">{{ title }}</div>
    <el-checkbox-group v-if="multiple" v-model="selectedMulti" :disabled="disabled">
      <el-checkbox v-for="o in options" :key="o.id" :label="o.id">
        {{ o.label }}
      </el-checkbox>
    </el-checkbox-group>
    <el-radio-group v-else v-model="selectedOne" :disabled="disabled">
      <el-radio v-for="o in options" :key="o.id" :label="o.id">
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
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";

type Opt = { id: string; label: string };

const props = defineProps<{
  props: Record<string, unknown>;
  disabled: boolean;
}>();
const emit = defineEmits<{
  submit: [value: { payload: Record<string, unknown> }];
}>();
const { t } = useI18n();
const title = computed(() => String(props.props.title ?? ""));
const multiple = computed(() => Boolean(props.props.multiple));
const options = computed<Opt[]>(() => {
  const raw = props.props.options;
  if (!Array.isArray(raw)) return [];
  return raw.map((o: any) => ({
    id: String(o.id),
    label: String(o.label ?? o.id),
  }));
});
const selectedOne = ref<string>("");
const selectedMulti = ref<string[]>([]);
const hasSelection = computed(() =>
  multiple.value ? selectedMulti.value.length > 0 : !!selectedOne.value,
);

function onSubmit() {
  if (props.disabled || !hasSelection.value) return;
  emit("submit", {
    payload: {
      selected: multiple.value ? [...selectedMulti.value] : selectedOne.value,
    },
  });
}
</script>
