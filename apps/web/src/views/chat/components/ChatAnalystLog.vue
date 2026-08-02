<template>
  <div class="chat-analyst-log" data-testid="chat-analyst-log">
    <div
      v-if="!rowId"
      class="log-unavailable"
      data-testid="analyst-log-unavailable"
    >
      {{ t("chat.log.unavailable") }}
    </div>
    <template v-else>
      <div v-if="canRequestLegacyRefresh" class="log-actions">
        <el-button
          text
          size="small"
          data-testid="analyst-log-update"
          :loading="updating"
          :disabled="updating"
          @click="emit('update')"
        >
          <el-icon>
            <Refresh />
          </el-icon>
          {{ t("chat.log.historicalRefresh") }}
        </el-button>
      </div>

      <div v-if="errorKind" class="log-error" data-testid="analyst-log-error">
        <span>{{
          errorKind === "fetch"
            ? t("chat.log.fetchError")
            : t("chat.log.updateError")
        }}</span>
        <el-button
          text
          size="small"
          data-testid="analyst-log-retry"
          @click="emit('retry')"
        >
          {{ t("chat.log.retry") }}
        </el-button>
      </div>
      <div v-if="loading" class="log-loading">
        <el-icon class="is-loading">
          <Loading />
        </el-icon>
        {{ t("chat.log.loading") }}
      </div>
      <div v-else-if="logData?.text" class="log-content">
        <div class="log-text-content">
          <pre
            class="log-pre"
            v-html="formatLogContentWithColors(logData.text)"
          ></pre>
        </div>
      </div>
      <div
        v-if="logData?.state === 'DEGRADED'"
        class="log-hint"
        data-testid="analyst-log-reconnecting"
      >
        {{ t("chat.log.reconnecting") }}
      </div>
      <div
        v-if="logData?.truncated"
        class="log-hint"
        data-testid="analyst-log-truncated"
      >
        {{ t("chat.log.truncated") }}
      </div>
      <div v-if="!loading && !logData?.text" class="log-empty">
        {{ emptyLabel }}
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { Loading, Refresh } from "@element-plus/icons-vue";
import { formatLogContentWithColors } from "../utils/agent-log";
import type { LogErrorKind } from "../composables/useLogView";
import type { AnalystAgentLog } from "@/api/types";
import { computed } from "vue";

const props = defineProps<{
  rowId?: string;
  taskId?: string;
  logData?: AnalystAgentLog;
  loading?: boolean;
  updating?: boolean;
  errorKind?: LogErrorKind;
}>();

const emit = defineEmits<{
  update: [];
  retry: [];
}>();

const { t } = useI18n();
const canRequestLegacyRefresh = computed(
  () =>
    props.logData?.source === "LEGACY_TASK" &&
    props.logData.can_request_legacy_refresh === true &&
    !!props.taskId
);
const emptyLabel = computed(() => {
  if (props.logData?.state === "PENDING") return t("chat.log.pending");
  if (props.logData?.state === "TERMINAL_EMPTY") {
    return t("chat.log.terminalEmpty");
  }
  if (props.logData?.state === "DEGRADED") return t("chat.log.reconnecting");
  return t("chat.log.noData");
});
</script>

<style scoped lang="scss">
.chat-analyst-log {
  min-width: 0;
}

.log-actions {
  margin-bottom: 6px;
  display: flex;
  justify-content: flex-start;

  :deep(.el-button) {
    min-height: 24px;
    padding: 2px 0;
    color: var(--phy-color-action-text);
    font-size: 12px;
  }

  :deep(.el-button .el-icon) {
    margin-right: 4px;
  }
}

.log-loading {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--phy-color-text-muted);
  font-size: 13px;

  .el-icon {
    color: var(--phy-color-accent-text);
    font-size: 14px;
  }
}

.log-content {
  max-height: 280px;
  overflow-y: auto;
  min-width: 0;
  scrollbar-gutter: stable;

  .log-text-content {
    min-width: 0;

    .log-pre {
      margin: 0;
      padding: 10px 12px;
      border: 1px solid var(--phy-color-border-subtle);
      border-radius: var(--phy-radius-sm);
      background: color-mix(
        in srgb,
        var(--phy-color-bg-elevated) 72%,
        transparent
      );
      color: var(--phy-color-text-secondary);
      font-family: var(--phy-font-mono);
      font-size: 12px;
      line-height: 1.55;
      white-space: pre-wrap;
      word-break: break-word;
      overflow-x: auto;
    }
  }

  :deep(.el-table) {
    --el-table-bg-color: transparent;
    --el-table-border-color: var(--phy-color-border-subtle);
    --el-table-header-bg-color: transparent;
    --el-table-header-text-color: var(--phy-color-text-muted);
    --el-table-row-hover-bg-color: var(--phy-color-fill-subtle);
    --el-table-text-color: var(--phy-color-text-secondary);

    background: transparent;
    font-size: 12px;
  }
}

.log-error {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 4px;
  color: var(--el-color-danger);
  font-size: 13px;

  :deep(.el-button) {
    min-height: 24px;
    padding: 2px 4px;
    font-size: 12px;
  }
}

.log-unavailable,
.log-empty {
  color: var(--phy-color-text-muted);
  font-size: 13px;
}
</style>
