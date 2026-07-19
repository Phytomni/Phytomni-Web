<template>
  <div class="chat-mode-selector">
    <el-radio-group
      :model-value="modelValue"
      @update:model-value="(v) => $emit('update:modelValue', v as 'instant' | 'expert')"
    >
      <el-radio-button value="instant">{{
        $t("chat.mode.instant")
      }}</el-radio-button>
      <el-tooltip
        v-if="!expertEnabled"
        :content="$t('chat.mode.comingSoon')"
        placement="top"
      >
        <el-radio-button value="expert" disabled>{{
          $t("chat.mode.expert")
        }}</el-radio-button>
      </el-tooltip>
      <el-radio-button v-else value="expert">{{
        $t("chat.mode.expert")
      }}</el-radio-button>
    </el-radio-group>
  </div>
</template>

<script setup lang="ts">
defineProps<{ modelValue: "instant" | "expert"; expertEnabled: boolean }>();
defineEmits<{ (e: "update:modelValue", value: "instant" | "expert"): void }>();
</script>

<style scoped>
.chat-mode-selector {
  display: inline-flex;
  max-width: 100%;
}

.chat-mode-selector :deep(.el-radio-group) {
  flex-wrap: nowrap;
  padding: 2px;
  border: 1px solid var(--phy-color-border-subtle);
  border-radius: var(--phy-radius-pill);
  background: var(--phy-color-fill-subtle);
}

.chat-mode-selector :deep(.el-radio-button__inner) {
  min-height: calc(var(--phy-control-height-compact) - 6px);
  padding: var(--phy-space-4) var(--phy-space-12);
  border: 0 !important;
  border-radius: var(--phy-radius-pill) !important;
  background: transparent;
  box-shadow: none !important;
  color: var(--phy-color-text-secondary);
  font-size: 12px;
  line-height: 1.4;
}

.chat-mode-selector
  :deep(.el-radio-button__original-radio:checked + .el-radio-button__inner) {
  background: var(--phy-color-primary-soft);
  color: var(--phy-color-action-text);
  font-weight: 600;
}

.chat-mode-selector
  :deep(.el-radio-button__original-radio:focus-visible
    + .el-radio-button__inner) {
  outline: 2px solid var(--phy-color-focus);
  outline-offset: 1px;
}

@media (max-width: 600px) {
  .chat-mode-selector :deep(.el-radio-button__inner) {
    padding-inline: var(--phy-space-8);
  }
}
</style>
