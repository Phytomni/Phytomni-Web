<template>
  <div class="transfer-progress" data-test="transfer-progress">
    <div class="transfer-progress__meta">
      <span data-test="transfer-size">
        {{
          snapshot.indeterminate
            ? formatBytes(snapshot.loaded)
            : `${formatBytes(snapshot.loaded)} / ${formatBytes(snapshot.total)}`
        }}
      </span>
      <span
        v-if="formatEta(snapshot.etaSec) != null"
        data-test="transfer-eta"
        class="transfer-progress__eta"
      >
        {{ $t("chat.transferEta", { seconds: formatEta(snapshot.etaSec) }) }}
      </span>
      <button
        type="button"
        class="transfer-progress__cancel"
        data-test="transfer-cancel"
        @click="$emit('cancel', snapshot.requestId)"
      >
        {{ $t("chat.transferCancel") }}
      </button>
    </div>
    <el-progress
      :percentage="snapshot.percent"
      :indeterminate="snapshot.indeterminate"
      :stroke-width="8"
    />
  </div>
</template>

<script setup lang="ts">
import {
  formatBytes,
  formatEta,
  type TransferSnapshot,
} from "@/utils/transfer-progress";

defineProps<{ snapshot: TransferSnapshot }>();
defineEmits<{ cancel: [requestId: string] }>();
</script>

<style scoped>
.transfer-progress {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
}
.transfer-progress__meta {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  color: var(--el-text-color-secondary, #909399);
}
.transfer-progress__cancel {
  margin-left: auto;
  background: none;
  border: none;
  color: var(--el-color-primary);
  cursor: pointer;
  padding: 0;
  font-size: 12px;
}
</style>
