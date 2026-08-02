<template>
  <el-radio-group
    class="attachment-purpose-selector"
    :model-value="modelValue"
    :disabled="disabled"
    @change="selectChange"
  >
    <el-radio-button
      v-for="option in purposeOptions"
      :key="option.value"
      :label="option.value"
      :disabled="disabled || !allowedPurposes.includes(option.value)"
      :data-testid="`attachment-purpose-${option.value}`"
    >
      <el-icon><component :is="option.icon" /></el-icon>
      {{ t(`attachmentPurpose.${option.value}`) }}
    </el-radio-button>
  </el-radio-group>
</template>

<script setup lang="ts">
import { DataAnalysis, Document } from "@element-plus/icons-vue";
import { useI18n } from "vue-i18n";
import type { UploadPurpose } from "../upload/types";

const props = defineProps<{
  modelValue: UploadPurpose;
  allowedPurposes: readonly UploadPurpose[];
  disabled?: boolean;
}>();
const emit = defineEmits<{
  "update:modelValue": [value: UploadPurpose];
}>();

const { t } = useI18n();
const purposeOptions = [
  { value: "document" as const, icon: Document },
  { value: "dataset" as const, icon: DataAnalysis },
];

function select(value: UploadPurpose): void {
  if (!props.disabled && props.allowedPurposes.includes(value)) {
    emit("update:modelValue", value);
  }
}

function selectChange(value: string | number | boolean | undefined): void {
  if (value === "dataset" || value === "document") select(value);
}
</script>

<style scoped>
.attachment-purpose-selector {
  max-width: 100%;
}

.attachment-purpose-selector :deep(.el-radio-button__inner) {
  display: inline-flex;
  align-items: center;
  gap: var(--phy-space-4);
}
</style>
