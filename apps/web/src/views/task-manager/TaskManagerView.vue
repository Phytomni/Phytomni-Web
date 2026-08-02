<template>
  <PhyWorkspaceShell class="task-manager-workspace">
    <template #header>
      <PhyPageHeader :title="$t('menu.taskManager')" />
    </template>

    <PhyAsyncState :state="asyncState">
      <template #loading>
        <PhySkeleton shape="table-row" :count="6" />
      </template>

      <template #empty>
        <PhyEmptyState :title="$t('common.noData')" />
      </template>

      <template #error>
        <PhyErrorState
          :title="$t('taskManager.getFailed')"
          :retry-label="$t('common.retry')"
          @retry="fetchData"
        />
      </template>

      <template #ready>
        <PhyDataToolbar class="task-manager-toolbar" />

        <PhyTableFrame>
          <el-table
            :data="tableData"
            class="task-manager-table"
            table-layout="fixed"
          >
            <el-table-column
              prop="query"
              :label="$t('taskManager.question')"
              min-width="320"
            >
              <template #default="{ row }">
                <div class="task-query">{{ row.query }}</div>
              </template>
            </el-table-column>

            <el-table-column
              prop="status"
              :label="$t('taskManager.status')"
              width="120"
            >
              <template #default="{ row }">
                <el-tag
                  class="task-status-badge"
                  :type="statusTagType(effectiveStatus(row))"
                  effect="plain"
                >
                  {{ showStatus(row) }}
                </el-tag>
              </template>
            </el-table-column>

            <el-table-column
              prop="updated_at"
              :label="$t('taskManager.updated_at')"
              width="160"
            >
              <template #default="{ row }">
                <span class="task-updated-at">
                  {{ formatDisplayDate(d, row.updated_at, "date") }}
                </span>
              </template>
            </el-table-column>

            <el-table-column :label="$t('taskManager.operate')" min-width="240">
              <template #default="{ row }">
                <el-space
                  class="task-manager-actions"
                  wrap
                  alignment="start"
                  :size="10"
                >
                  <el-button
                    v-if="row.status === 'SUCCEEDED' && row.download_path"
                    class="task-download-action"
                    type="primary"
                    @click="handleDownClick(row)"
                  >
                    <el-icon><Download /></el-icon>
                    {{ $t("taskManager.downloadURL") }}
                  </el-button>
                  <el-button
                    class="task-dialogue-action"
                    type="primary"
                    @click="handleTaskClick(row)"
                  >
                    <el-icon><Link /></el-icon>
                    {{ $t("taskManager.dialogue_link") }}
                  </el-button>
                </el-space>
              </template>
            </el-table-column>
          </el-table>

          <template #pagination>
            <el-pagination
              v-model:current-page="currentPage"
              v-model:page-size="pageSize"
              :page-sizes="[10, 20, 30, 50]"
              layout="total, sizes, prev, pager, next, jumper"
              :total="total"
              @size-change="handleSizeChange"
              @current-change="handleCurrentChange"
            />
          </template>
        </PhyTableFrame>
      </template>
    </PhyAsyncState>
  </PhyWorkspaceShell>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { Download, Link } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import { useI18n } from "vue-i18n";
import {
  PhyDataToolbar,
  PhyEmptyState,
  PhyPageHeader,
  PhyTableFrame,
  PhyWorkspaceShell,
} from "@/components/shell";
import { PhyAsyncState, PhyErrorState, PhySkeleton } from "@/components/state";
import { getTaskList } from "@/api/task";
import { getChatdownloadURL } from "@/api/chat";
import type { AsyncTaskRecord } from "@/api/types";
import { formatDisplayDate } from "@/locales/format-display-date";
import { useAgentRunLifecycle } from "@/views/chat/composables/useAgentRunLifecycle";

type AsyncState = "loading" | "empty" | "error" | "ready";

const { t, d } = useI18n();
const loading = ref(false);
const requestFailed = ref(false);
const currentPage = ref(1);
const pageSize = ref(10);
const total = ref(0);
const tableData = ref<AsyncTaskRecord[]>([]);
const watchedRowIds = new Set<string>();
const backgroundTools = new Set([
  "AnalystAgent",
  "InSilicoResearchAgent",
  "GeneNetworkAgent",
  "DigitalDesignAgent",
]);
const terminalStatuses = new Set(["SUCCEEDED", "FAILED", "CANCELLED"]);
let activeFetch: Promise<void> | null = null;
let lifecycleRefreshQueued = false;
let viewGeneration = 0;
let isDisposed = false;

const lifecycle = useAgentRunLifecycle({
  scope: "task-manager",
  maxConcurrent: 3,
  onSnapshot: () => {
    if (isDisposed) return;
    if (activeFetch) {
      lifecycleRefreshQueued = true;
      return;
    }
    fetchData().catch(() => undefined);
  },
});

const asyncState = computed<AsyncState>(() => {
  if (loading.value) return "loading";
  if (requestFailed.value) return "error";
  if (tableData.value.length === 0) return "empty";
  return "ready";
});

const isWatchableRow = (
  row: AsyncTaskRecord
): row is AsyncTaskRecord & {
  id: number;
} =>
  typeof row.id === "number" &&
  Number.isInteger(row.id) &&
  row.id > 0 &&
  typeof row.tool_name === "string" &&
  backgroundTools.has(row.tool_name) &&
  !terminalStatuses.has(row.status?.toUpperCase() ?? "");

const replaceWatchedRows = (rows: AsyncTaskRecord[]) => {
  const nextIds = new Set(
    rows.filter(isWatchableRow).map((row) => String(row.id))
  );
  for (const rowId of watchedRowIds) {
    if (!nextIds.has(rowId)) {
      lifecycle.unwatchRow(rowId);
      watchedRowIds.delete(rowId);
    }
  }
  for (const rowId of nextIds) {
    if (!watchedRowIds.has(rowId)) {
      lifecycle.watchRow(rowId);
      watchedRowIds.add(rowId);
    }
  }
};

const clearWatchedRows = () => replaceWatchedRows([]);

const performFetch = async (
  generation: number,
  requestedPage: number,
  requestedSize: number
) => {
  loading.value = true;
  requestFailed.value = false;

  try {
    const res = await getTaskList({
      current: requestedPage,
      size: requestedSize,
    });
    if (isDisposed || generation !== viewGeneration) return;
    if (res.code === 200 && res.data) {
      tableData.value = res.data.gene_list || [];
      total.value = res.data.total || 0;
      replaceWatchedRows(tableData.value);
    } else {
      tableData.value = [];
      total.value = 0;
      clearWatchedRows();
      requestFailed.value = true;
      ElMessage.error(t("taskManager.getFailed"));
    }
  } catch {
    if (isDisposed || generation !== viewGeneration) return;
    tableData.value = [];
    total.value = 0;
    clearWatchedRows();
    requestFailed.value = true;
    ElMessage.error(t("taskManager.getFailed"));
  } finally {
    if (!isDisposed && generation === viewGeneration) {
      loading.value = false;
    }
  }
};

const fetchData = (): Promise<void> => {
  if (activeFetch) {
    lifecycleRefreshQueued = true;
    return activeFetch;
  }
  const request = performFetch(
    viewGeneration,
    currentPage.value,
    pageSize.value
  );
  activeFetch = request;
  request
    .finally(() => {
      if (activeFetch !== request) return;
      activeFetch = null;
      if (!isDisposed && lifecycleRefreshQueued) {
        lifecycleRefreshQueued = false;
        fetchData().catch(() => undefined);
      }
    })
    .catch(() => undefined);
  return request;
};

const effectiveStatus = (data: AsyncTaskRecord) =>
  data.id && data.id > 0
    ? lifecycle.snapshots.value[String(data.id)]?.phase || data.status
    : data.status;

const showStatus = (data: AsyncTaskRecord) => {
  switch (effectiveStatus(data)) {
    case "SUCCEEDED":
      return t("common.finished");
    case "FAILED":
      return t("common.failed");
    case "RUNNING":
      return t("common.running");
    case "PREPARING":
      return t("chat.lifecycle.preparing");
    case "CANCELLED":
      return t("chat.lifecycle.cancelled");
    default:
      return "";
  }
};

const statusTagType = (status?: string) => {
  switch (status) {
    case "SUCCEEDED":
      return "success";
    case "FAILED":
      return "danger";
    case "RUNNING":
    case "PREPARING":
      return "warning";
    default:
      return "info";
  }
};

const handleDownClick = async (data: AsyncTaskRecord) => {
  if (!data.download_path) return;

  const res = await getChatdownloadURL({ obs_path: data.download_path });
  if (res.code === 200) {
    window.open(res.data, "_blank", "noopener,noreferrer");
  }
};

const handleTaskClick = (data: AsyncTaskRecord) => {
  const url = `/chat?dialogue_id=${data.f_dialogue_id || data.dialogue_id}`;
  window.open(url, "_blank");
};

const handleSizeChange = async (size: number) => {
  viewGeneration += 1;
  clearWatchedRows();
  pageSize.value = size;
  await fetchData();
};

const handleCurrentChange = async (page: number) => {
  viewGeneration += 1;
  clearWatchedRows();
  currentPage.value = page;
  await fetchData();
};

onMounted(() => {
  fetchData().catch(() => undefined);
});

onUnmounted(() => {
  isDisposed = true;
  viewGeneration += 1;
  lifecycleRefreshQueued = false;
  clearWatchedRows();
  lifecycle.dispose();
});
</script>

<style lang="scss" scoped>
.task-manager-table {
  min-width: 840px;
}

.task-query {
  overflow-wrap: anywhere;
}

.task-manager-workspace {
  :deep(.phy-table-frame__scroll) {
    overflow-x: auto;
  }
}

@container (max-width: 720px) {
  .task-manager-workspace {
    :deep(.task-manager-actions) {
      flex-basis: 100%;
      min-width: 0;
    }

    :deep(.phy-table-frame__pagination) {
      justify-content: flex-start;
    }

    :deep(.el-pagination) {
      flex-wrap: wrap;
    }

    :deep(.el-pagination__jump) {
      display: none;
    }
  }
}
</style>
