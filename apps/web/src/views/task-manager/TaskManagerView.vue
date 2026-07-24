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
                  :type="statusTagType(row.status)"
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
import { computed, onMounted, ref } from "vue";
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
import { formatDisplayDate } from "@/locales/format-display-date";

type AsyncState = "loading" | "empty" | "error" | "ready";

interface TaskData {
  query?: string;
  status?: string;
  upload_path?: string;
  updated_at?: string;
  dialogue_id?: string;
  f_dialogue_id?: string;
  download_path?: string;
}

const { t, d } = useI18n();
const loading = ref(false);
const requestFailed = ref(false);
const currentPage = ref(1);
const pageSize = ref(10);
const total = ref(0);
const tableData = ref<TaskData[]>([]);

const asyncState = computed<AsyncState>(() => {
  if (loading.value) return "loading";
  if (requestFailed.value) return "error";
  if (tableData.value.length === 0) return "empty";
  return "ready";
});

const fetchData = async () => {
  loading.value = true;
  requestFailed.value = false;

  try {
    const res = await getTaskList({
      current: currentPage.value,
      size: pageSize.value,
    });
    if (res.code === 200 && res.data) {
      tableData.value = res.data.gene_list || [];
      total.value = res.data.total || 0;
    } else {
      tableData.value = [];
      total.value = 0;
      requestFailed.value = true;
      ElMessage.error(t("taskManager.getFailed"));
    }
  } catch {
    tableData.value = [];
    total.value = 0;
    requestFailed.value = true;
    ElMessage.error(t("taskManager.getFailed"));
  } finally {
    loading.value = false;
  }
};

const showStatus = (data: TaskData) => {
  switch (data.status) {
    case "SUCCEEDED":
      return t("common.finished");
    case "FAILED":
      return t("common.failed");
    case "RUNNING":
      return t("common.running");
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
      return "warning";
    default:
      return "info";
  }
};

const handleDownClick = async (data: TaskData) => {
  if (!data.download_path) return;

  const res = await getChatdownloadURL({ obs_path: data.download_path });
  if (res.code === 200) {
    window.open(res.data, "_blank", "noopener,noreferrer");
  }
};

const handleTaskClick = (data: TaskData) => {
  const url = `/chat?dialogue_id=${data.f_dialogue_id || data.dialogue_id}`;
  window.open(url, "_blank");
};

const handleSizeChange = async (size: number) => {
  pageSize.value = size;
  await fetchData();
};

const handleCurrentChange = async (page: number) => {
  currentPage.value = page;
  await fetchData();
};

onMounted(() => {
  fetchData().catch(() => undefined);
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
  }
}
</style>
