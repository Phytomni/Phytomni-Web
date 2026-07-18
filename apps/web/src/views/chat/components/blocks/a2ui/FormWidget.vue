<template>
  <form class="a2ui-form" @submit.prevent="onSubmit">
    <div class="a2ui-title">{{ title }}</div>
    <div v-for="f in fields" :key="f.name" class="a2ui-field">
      <label :for="fieldId(f.name)">{{ f.label }}</label>
      <el-input
        v-if="f.type === 'text' || !f.type"
        :id="fieldId(f.name)"
        :aria-label="f.label"
        v-model="model[f.name]"
        :disabled="disabled"
      />
      <el-input-number
        v-else-if="f.type === 'number'"
        :id="fieldId(f.name)"
        :aria-label="f.label"
        v-model="model[f.name]"
        :disabled="disabled"
      />
      <el-select
        v-else-if="f.type === 'select'"
        :id="fieldId(f.name)"
        :aria-label="f.label"
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
    <el-button
      type="primary"
      native-type="submit"
      :disabled="disabled"
      :aria-label="t('chat.a2ui.submit')"
    >
      {{ t("chat.a2ui.submit") }}
    </el-button>
    <el-button
      data-test="a2ui-form-cancel"
      type="default"
      native-type="button"
      :disabled="disabled"
      :aria-label="t('chat.a2ui.cancel')"
      @click="onCancel"
    >
      {{ t("chat.a2ui.cancel") }}
    </el-button>
  </form>
</template>

<script setup lang="ts">
import { computed, reactive } from "vue";
import { useI18n } from "vue-i18n";
import type {
  A2uiActionIntent,
  A2uiOpenSurface,
  A2uiScalar,
} from "../../../streaming/a2uiContract";

type FormProps = Extract<A2uiOpenSurface, { widget: "form" }>["props"];

const props = defineProps<{
  surface: FormProps;
  disabled: boolean;
}>();
const emit = defineEmits<{
  action: [intent: Extract<A2uiActionIntent, { widget: "form" }>];
}>();
const { t } = useI18n();
const title = computed(() => props.surface.title);
const fields = computed(() => props.surface.fields);
const model = reactive<Record<string, A2uiScalar>>({});

function onSubmit() {
  if (props.disabled) return;
  for (const f of fields.value) {
    if (f.required && (model[f.name] === undefined || model[f.name] === "")) {
      return;
    }
  }
  const out: Record<string, A2uiScalar> = {};
  for (const f of fields.value) {
    if (model[f.name] !== undefined) out[f.name] = model[f.name];
  }
  emit("action", { widget: "form", payload: { fields: out } });
}

function onCancel() {
  if (props.disabled) return;
  emit("action", { widget: "form", payload: { cancelled: true } });
}

function fieldId(name: string) {
  return `a2ui-field-${name}`;
}
</script>
