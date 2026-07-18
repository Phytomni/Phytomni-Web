<template>
  <div
    v-if="downloadTransferList.length"
    class="transfer-progress-list"
    data-test="transfer-progress-list"
    role="region"
    :aria-label="t('chat.transferProgress')"
  >
    <TransferProgress
      v-for="snap in downloadTransferList"
      :key="snap.requestId"
      :snapshot="snap"
      @cancel="onCancel"
    />
  </div>
</template>

<script setup lang="ts">
import TransferProgress from "@/components/TransferProgress.vue";
import { downloadTransferList } from "@/utils/download-transfers";
import { abortRequest } from "@/utils/request";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

function onCancel(requestId: string) {
  abortRequest(requestId);
}
</script>

<style scoped>
.transfer-progress-list {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 4000;
  width: min(360px, calc(100vw - 48px));
  padding: 12px;
  background: var(--el-bg-color, #fff);
  box-shadow: var(--el-box-shadow-light);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
</style>
