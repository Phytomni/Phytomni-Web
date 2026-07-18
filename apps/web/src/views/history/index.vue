<template>
  <PhyWorkspaceShell class="history-workspace">
    <template #header>
      <PhyPageHeader :title="$t('user.history')" />
    </template>

    <PhyAsyncState :state="asyncState">
      <template #loading>
        <PhySkeleton shape="table-row" :count="6" />
      </template>

      <template #empty>
        <PhyEmptyState
          :title="$t('history.noHistory')"
          :subtitle="$t('history.noHistoryDescription')"
        >
          <el-button type="primary" @click="goToChat">
            {{ $t("chat.startChat") }}
          </el-button>
        </PhyEmptyState>
      </template>

      <template #error>
        <PhyErrorState
          :title="$t('history.loadFailed')"
          :retry-label="$t('common.retry')"
          @retry="fetchHistoryData"
        />
      </template>

      <template #ready>
        <PhyDataToolbar class="history-toolbar">
          <template #filters>
            <p class="history-count">
              {{ $t("history.historyCount", { count: historyList.length }) }}
            </p>
          </template>
          <template #actions>
            <el-button
              class="history-refresh"
              :loading="refreshing"
              @click="refreshHistory"
            >
              <el-icon><Refresh /></el-icon>
              {{ $t("chat.refresh") }}
            </el-button>
          </template>
        </PhyDataToolbar>

        <section class="history-list" :aria-label="$t('user.history')">
          <article
            v-for="history in historyList"
            :key="history.id"
            class="history-row"
            role="link"
            tabindex="0"
            @click="openChat(history)"
            @keydown.enter="openChat(history)"
            @keydown.space.prevent="openChat(history)"
          >
            <div class="history-row__content">
              <h2 class="history-title">
                <el-icon class="history-title__icon"><Document /></el-icon>
                <span class="history-title__text">{{
                  history.title_query
                }}</span>
              </h2>
              <div class="history-meta">
                <time class="history-date" :datetime="history.created_at">
                  {{ formatDate(history.created_at) }}
                </time>
                <span class="history-id">ID: {{ history.id }}</span>
              </div>
            </div>

            <div class="history-action-menu" @click.stop @keydown.stop>
              <el-dropdown
                trigger="click"
                @command="(command) => handleHistoryAction(command, history)"
              >
                <el-button
                  class="history-menu-trigger"
                  text
                  :aria-label="$t('chat.more')"
                  @click.stop
                >
                  <el-icon><MoreFilled /></el-icon>
                </el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="rename" :icon="Edit">
                      {{ $t("chat.actions.rename") }}
                    </el-dropdown-item>
                    <el-dropdown-item command="delete" :icon="Delete" divided>
                      {{ $t("chat.actions.delete") }}
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </article>
        </section>
      </template>
    </PhyAsyncState>
  </PhyWorkspaceShell>

  <el-backtop target=".history-workspace" :right="40" :bottom="40" />

  <el-dialog
    v-model="renameDialogVisible"
    :title="$t('chat.actions.rename')"
    width="400px"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    @close="handleRenameDialogClose"
  >
    <el-form ref="renameFormRef" :model="renameForm" :rules="renameRules">
      <el-form-item prop="title" :label="$t('chat.conversationTitle')">
        <el-input
          v-model="renameForm.title"
          :placeholder="$t('chat.actions.enterNewTitle')"
          maxlength="100"
          show-word-limit
          @keyup.enter="handleRenameConfirm"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <span class="dialog-footer">
        <el-button @click="renameDialogVisible = false">
          {{ $t("common.cancel") }}
        </el-button>
        <el-button type="primary" @click="handleRenameConfirm">
          {{ $t("common.confirm") }}
        </el-button>
      </span>
    </template>
  </el-dialog>

  <el-dialog
    v-model="deleteDialogVisible"
    :title="$t('chat.actions.deleteConfirm')"
    width="400px"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
  >
    <div class="delete-confirm-content">
      <el-icon class="warning-icon"><Warning /></el-icon>
      <p>{{ $t("chat.actions.deleteWarning") }}</p>
      <p class="history-title-to-delete">{{ historyToDelete?.title_query }}</p>
    </div>
    <template #footer>
      <span class="dialog-footer">
        <el-button @click="deleteDialogVisible = false">
          {{ $t("common.cancel") }}
        </el-button>
        <el-button type="danger" @click="handleDeleteConfirm">
          {{ $t("common.confirm") }}
        </el-button>
      </span>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import {
  Delete,
  Document,
  Edit,
  MoreFilled,
  Refresh,
  Warning,
} from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import {
  PhyDataToolbar,
  PhyEmptyState,
  PhyPageHeader,
  PhyWorkspaceShell,
} from "@/components/shell";
import { PhyAsyncState, PhyErrorState, PhySkeleton } from "@/components/state";
import {
  deleteHistory,
  getHistoryQuestionList,
  renameHistory,
} from "@/api/chat";
import { formatDisplayDate } from "@/locales/format-display-date";

type AsyncState = "loading" | "empty" | "error" | "ready";

interface History {
  id: number;
  dialogue_id: string;
  title_query: string;
  created_at: string;
}

const { t, d } = useI18n();
const router = useRouter();
const loading = ref(false);
const refreshing = ref(false);
const requestFailed = ref(false);
const historyList = ref<History[]>([]);

const renameDialogVisible = ref(false);
const renameForm = ref({ title: "" });
const renameFormRef = ref<{
  validate: () => Promise<boolean>;
  resetFields: () => void;
}>();
const renameRules = {
  title: [{ required: true, message: "Please enter a title", trigger: "blur" }],
};
const historyToRename = ref<History | null>(null);

const deleteDialogVisible = ref(false);
const historyToDelete = ref<History | null>(null);

const asyncState = computed<AsyncState>(() => {
  if (loading.value) return "loading";
  if (requestFailed.value) return "error";
  if (historyList.value.length === 0) return "empty";
  return "ready";
});

const fetchHistoryData = async (): Promise<boolean> => {
  loading.value = true;
  requestFailed.value = false;

  try {
    const res = await getHistoryQuestionList();
    if (res.code === 200 && Array.isArray(res.data)) {
      historyList.value = res.data;
      return true;
    }

    historyList.value = [];
    requestFailed.value = true;
    ElMessage.error(res.message || t("history.loadFailed"));
    return false;
  } catch {
    historyList.value = [];
    requestFailed.value = true;
    ElMessage.error(t("history.loadFailed"));
    return false;
  } finally {
    loading.value = false;
  }
};

const refreshHistory = async () => {
  refreshing.value = true;
  try {
    if (await fetchHistoryData()) {
      ElMessage.success(t("common.refreshedSuccess"));
    }
  } finally {
    refreshing.value = false;
  }
};

const openChat = (history: History) => {
  router.push(`/chat?dialogue_id=${history.dialogue_id}`);
};

const goToChat = () => {
  router.push("/chat");
};

const handleHistoryAction = (command: string, history: History) => {
  if (command === "rename") {
    renameForm.value.title = history.title_query;
    historyToRename.value = history;
    renameDialogVisible.value = true;
  }

  if (command === "delete") {
    historyToDelete.value = history;
    deleteDialogVisible.value = true;
  }
};

const handleRenameConfirm = async () => {
  if (!renameFormRef.value || !historyToRename.value) return;

  try {
    if (await renameFormRef.value.validate()) {
      const formData = new FormData();
      formData.append("id", historyToRename.value.id.toString());
      formData.append("rename", renameForm.value.title);

      const res = await renameHistory(formData);
      if (res.code === 200) {
        const history = historyList.value.find(
          (item) => item.id === historyToRename.value?.id
        );
        if (history) history.title_query = renameForm.value.title;
        renameDialogVisible.value = false;
        historyToRename.value = null;
        ElMessage.success(t("common.renamedSuccess"));
      } else {
        ElMessage.error(res.message || t("common.renameFailedRetry"));
      }
    }
  } catch {
    ElMessage.error(t("common.renameFailedRetry"));
  }
};

const handleDeleteConfirm = async () => {
  if (!historyToDelete.value) return;

  try {
    const formData = new FormData();
    formData.append("id", historyToDelete.value.id.toString());

    const res = await deleteHistory(formData);
    if (res.code === 200) {
      const index = historyList.value.findIndex(
        (history) => history.id === historyToDelete.value?.id
      );
      if (index !== -1) historyList.value.splice(index, 1);
      deleteDialogVisible.value = false;
      historyToDelete.value = null;
      ElMessage.success(t("common.deletedSuccess"));
    } else {
      ElMessage.error(res.message || t("common.deleteFailedRetry"));
    }
  } catch {
    ElMessage.error(t("common.deleteFailedRetry"));
  }
};

const handleRenameDialogClose = () => {
  historyToRename.value = null;
  renameForm.value.title = "";
  renameFormRef.value?.resetFields();
};

const formatDate = (dateString: string) =>
  formatDisplayDate(d, dateString, "datetime");

onMounted(() => {
  void fetchHistoryData();
});
</script>

<style lang="scss" scoped>
.history-count {
  margin: 0;
  color: var(--phy-color-text);
  font-size: 1rem;
  font-weight: 600;
}

.history-list {
  display: grid;
  gap: var(--phy-space-12);
}

.history-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--phy-space-16);
  padding: var(--phy-space-16);
  border: 1px solid var(--phy-color-border);
  border-radius: var(--phy-radius-md);
  background: var(--phy-color-bg-elevated);
  cursor: pointer;
}

.history-row:hover {
  border-color: var(--phy-color-border-control);
}

.history-row:focus-visible {
  outline: 2px solid var(--phy-color-focus);
  outline-offset: 2px;
}

.history-row__content {
  min-width: 0;
}

.history-title {
  display: flex;
  gap: var(--phy-space-8);
  margin: 0;
  color: var(--phy-color-text);
  font-size: 1rem;
  line-height: 1.5;
}

.history-title__icon {
  flex: 0 0 auto;
  margin-top: 0.125rem;
  color: var(--phy-color-action-text);
}

.history-title__text {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow-wrap: anywhere;
}

.history-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--phy-space-8) var(--phy-space-12);
  margin-top: var(--phy-space-8);
  color: var(--phy-color-text-secondary);
  font-size: 0.8125rem;
  line-height: 1.4;
}

.history-action-menu {
  align-self: start;
}

.history-menu-trigger {
  min-width: auto;
  color: var(--phy-color-text-secondary);
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--phy-space-12);
}

.delete-confirm-content {
  text-align: center;
}

.warning-icon {
  color: var(--el-color-warning);
  font-size: 2rem;
}

.history-title-to-delete {
  overflow-wrap: anywhere;
  color: var(--phy-color-text);
  font-weight: 600;
}

@media (max-width: 599px) {
  .history-row {
    gap: var(--phy-space-12);
    padding: var(--phy-space-12);
  }
}
</style>
