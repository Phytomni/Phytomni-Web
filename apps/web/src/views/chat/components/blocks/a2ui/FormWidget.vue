<template>
  <form class="a2ui-form" @submit.prevent="onSubmit">
    <div class="a2ui-title">{{ title }}</div>
    <div v-for="f in fields" :key="f.name" class="a2ui-field">
      <label>{{ f.label }}</label>
      <el-input
        v-if="f.type === 'text' || !f.type"
        v-model="model[f.name]"
        :disabled="disabled"
      />
      <el-input-number
        v-else-if="f.type === 'number'"
        v-model="model[f.name]"
        :disabled="disabled"
      />
      <el-select
        v-else-if="f.type === 'select'"
        v-model="model[f.name]"
        :disabled="disabled"
      >
        <el-option
          v-for="opt in f.options ?? []"
          :key="String(opt)"
          :label="String(opt)"
          :value="opt"
        />
      </el-select>
    </div>
    <el-button type="primary" native-type="submit" :disabled="disabled">
      {{ t("chat.a2ui.submit") }}
    </el-button>
  </form>
</template>

<script setup lang="ts">
import { computed, reactive } from "vue";
import { useI18n } from "vue-i18n";

type Field = {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  options?: Array<string | number>;
};

const props = defineProps<{
  props: Record<string, unknown>;
  disabled: boolean;
}>();
const emit = defineEmits<{
  submit: [value: { payload: Record<string, unknown> }];
}>();
const { t } = useI18n();
const title = computed(() => String(props.props.title ?? ""));
const fields = computed<Field[]>(() => {
  const raw = props.props.fields;
  return Array.isArray(raw) ? (raw as Field[]) : [];
});
const model = reactive<Record<string, string | number | boolean>>({});

function onSubmit() {
  if (props.disabled) return;
  for (const f of fields.value) {
    if (f.required && (model[f.name] === undefined || model[f.name] === "")) {
      return;
    }
  }
  const out: Record<string, string | number | boolean> = {};
  for (const f of fields.value) {
    if (model[f.name] !== undefined) out[f.name] = model[f.name];
  }
  emit("submit", { payload: { fields: out } });
}
</script>
