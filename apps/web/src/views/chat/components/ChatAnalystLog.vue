<template>
  <div class="chat-analyst-log" data-testid="chat-analyst-log">
    <div v-if="!rowId" class="log-unavailable" data-testid="analyst-log-unavailable">
      {{ t("chat.log.unavailable") }}
    </div>
    <template v-else>
      <div class="log-actions">
        <el-button
          type="primary"
          size="small"
          data-testid="analyst-log-update"
          :loading="updating"
          :disabled="!taskId || updating"
          @click="emit('update')"
        >
          <el-icon>
            <Refresh />
          </el-icon>
          {{
            taskId ? t("chat.log.updateLog") : t("chat.log.updateUnavailable")
          }}
        </el-button>
      </div>

      <div
        v-if="errorKind"
        class="log-error"
        data-testid="analyst-log-error"
      >
        <span>{{
          errorKind === "fetch"
            ? t("chat.log.fetchError")
            : t("chat.log.updateError")
        }}</span>
        <el-button
          size="small"
          data-testid="analyst-log-retry"
          @click="emit('retry')"
        >
          {{ t("chat.log.retry") }}
        </el-button>
      </div>
      <div v-else-if="loading" class="log-loading">
        <el-icon class="is-loading">
          <Loading />
        </el-icon>
        {{ t("chat.log.loading") }}
      </div>
      <div v-else-if="logData != null && logData !== ''" class="log-content">
        <div
          v-if="typeof logData === 'string'"
          class="log-text-content"
        >
          <pre
            class="log-pre"
            v-html="formatLogContentWithColors(logData)"
          ></pre>
        </div>
        <el-table
          v-else-if="Array.isArray(logData)"
          :data="logData"
          border
          style="width: 100%"
        >
          <el-table-column
            prop="content"
            :label="t('chat.log.contentColumn')"
            align="left"
          />
        </el-table>
      </div>
      <div v-else class="log-empty">
        {{ t("chat.log.noData") }}
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { Loading, Refresh } from "@element-plus/icons-vue";
import { formatLogContentWithColors } from "../utils/agent-log";
import type { LogErrorKind } from "../composables/useLogView";

defineProps<{
  rowId?: string;
  taskId?: string;
  logData?: unknown;
  loading?: boolean;
  updating?: boolean;
  errorKind?: LogErrorKind;
}>();

const emit = defineEmits<{
  update: [];
  retry: [];
}>();

const { t } = useI18n();
</script>

<style scoped lang="scss">
.chat-analyst-log {
  min-width: 0;
}

.log-actions {
  margin-bottom: 12px;
  display: flex;
  justify-content: flex-end;

  .el-button .el-icon {
    margin-right: 4px;
  }
}

.log-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #909399;
  font-size: 14px;

  .el-icon {
    font-size: 16px;
  }
}

.log-content {
  max-height: 400px;
  overflow-y: auto;
  border: 1px solid #e6e6e6;
  border-radius: 4px;
  padding: 12px;
  background-color: #fff;

  .log-text-content {
    .log-pre {
      margin: 0;
      padding: 0;
      font-family: "Courier New", monospace;
      font-size: 12px;
      line-height: 1.4;
      color: #333;
      white-space: pre-wrap;
      word-break: break-word;
      background-color: #1e1e1e;
      color: #d4d4d4;
      padding: 12px;
      border-radius: 4px;
      overflow-x: auto;
    }
  }
}

.log-error {
  display: flex;
  align-items: center;
  gap: 12px;
  color: #f56c6c;
  font-size: 14px;
  margin-bottom: 8px;
}

.log-unavailable,
.log-empty {
  color: #909399;
  font-size: 14px;
}
</style>
