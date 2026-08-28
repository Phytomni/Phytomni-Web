<template>
  <div class="chat-demo-ask" data-testid="chat-demo-ask">
    <el-button
      type="primary"
      class="phy-btn-primary"
      data-testid="chat-demo-ask-button"
      @click="emit('ask')"
    >
      {{ t("chat.cases.askThisAgent") }}
    </el-button>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";

const emit = defineEmits<{
  ask: [];
}>();

const { t } = useI18n();
</script>

<style scoped>
.chat-demo-ask {
  display: flex;
  justify-content: center;
  width: min(100%, var(--phy-layout-transcript-max-width));
  margin: 0 auto;
  box-sizing: border-box;
  padding: var(--phy-space-16);
}

.phy-btn-primary {
  --el-button-bg-color: var(--phy-color-primary);
  --el-button-border-color: var(--phy-color-primary);
  --el-button-hover-bg-color: var(--phy-color-primary-hover);
  --el-button-hover-border-color: var(--phy-color-primary-hover);
  --el-button-text-color: #fff;
}
</style>
