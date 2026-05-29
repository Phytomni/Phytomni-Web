<template>
  <div class="history-container">
    <!-- 历史记录列表 -->
    <div class="history-content">
      <div v-if="loading" class="loading-container">
        <el-icon class="is-loading"><Loading /></el-icon>
        <span>{{ $t('common.loading') }}</span>
      </div>

      <div v-else-if="historyList.length === 0" class="empty-container">
        <el-icon><Document /></el-icon>
        <h3>{{ $t('history.noHistory') }}</h3>
        <p>{{ $t('history.noHistoryDescription') }}</p>
        <el-button @click="goToChat" type="primary">
          {{ $t('chat.startChat') }}
        </el-button>
      </div>

      <div v-else class="history-list">
        <div class="list-header">
          <h3>{{ $t('history.historyCount', { count: historyList.length }) }}</h3>
          <el-button class="refresh-btn" @click="refreshHistory" :loading="refreshing" size="small">
            <el-icon><Refresh /></el-icon>
            {{ $t('common.refresh') }}
          </el-button>
        </div>

        <div class="history-grid">
          <div 
            v-for="history in historyList" 
            :key="history.id" 
            class="history-item"
            @click="openChat(history)"
          >
            <div class="history-header">
              <div class="history-title">
                <el-icon class="history-icon"><Document /></el-icon>
                <span class="title-text">{{ history.title_query }}</span>
              </div>
              <div class="history-actions" @click.stop>
                <el-dropdown trigger="click" @command="(command) => handleHistoryAction(command, history)">
                  <el-icon class="action-icon">
                    <MoreFilled />
                  </el-icon>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item command="rename" :icon="Edit">
                        {{ $t('chat.actions.rename') }}
                      </el-dropdown-item>
                      <el-dropdown-item command="delete" :icon="Delete" divided>
                        <span style="color: #f56c6c">{{ $t('chat.actions.delete') }}</span>
                      </el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
              </div>
            </div>
            
            <div class="history-content">
              <div class="history-meta">
                <span class="history-date">{{ formatDate(history.created_at) }}</span>
                <span class="history-id">ID: {{ history.id }}</span>
              </div>
              <div class="history-preview">
                {{ history.title_query }}
              </div>
            </div>

            <div class="history-footer">
              <el-button size="small" @click.stop="openChat(history)" type="primary">
                {{ $t('chat.openChat') }}
              </el-button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 重命名对话框 -->
    <el-dialog
      v-model="renameDialogVisible"
      :title="$t('chat.actions.rename')"
      width="400px"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
      @close="handleRenameDialogClose"
    >
      <el-form :model="renameForm" ref="renameFormRef" :rules="renameRules">
        <el-form-item prop="title" :label="$t('chat.title')">
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
            {{ $t('common.cancel') }}
          </el-button>
          <el-button type="primary" @click="handleRenameConfirm">
            {{ $t('common.confirm') }}
          </el-button>
        </span>
      </template>
    </el-dialog>

    <!-- 删除确认对话框 -->
    <el-dialog
      v-model="deleteDialogVisible"
      :title="$t('chat.actions.deleteConfirm')"
      width="400px"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
    >
      <div class="delete-confirm-content">
        <el-icon class="warning-icon"><Warning /></el-icon>
        <p>{{ $t('chat.actions.deleteWarning') }}</p>
        <p class="history-title-to-delete">{{ historyToDelete?.title_query }}</p>
      </div>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="deleteDialogVisible = false">
            {{ $t('common.cancel') }}
          </el-button>
          <el-button type="danger" @click="handleDeleteConfirm">
            {{ $t('common.confirm') }}
          </el-button>
        </span>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import {
  Document,
  Loading,
  Refresh,
  MoreFilled,
  Edit,
  Delete,
  Warning,
} from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { getHistoryQuestionList, deleteHistory, renameHistory } from '@/api/chat';

// 定义History接口 - 匹配API返回的数据结构
interface History {
  id: number;
  dialogue_id: string;
  title_query: string;
  created_at: string;
}

const { t } = useI18n();
const router = useRouter();

// 响应式数据
const loading = ref(false);
const refreshing = ref(false);
const historyList = ref<History[]>([]);

// 重命名对话框相关
const renameDialogVisible = ref(false);
const renameForm = ref({
  title: '',
});
const renameFormRef = ref();
const renameRules = {
  title: [{ required: true, message: '请输入标题', trigger: 'blur' }],
};
const historyToRename = ref<History | null>(null);

// 删除确认对话框相关
const deleteDialogVisible = ref(false);
const historyToDelete = ref<History | null>(null);

// 获取历史记录数据
const fetchHistoryData = async () => {
  loading.value = true;
  try {
    const res = await getHistoryQuestionList();
    if (res.code === 200 && res.data) {
      historyList.value = res.data;
    } else {
      ElMessage.error(res.msg || '获取历史记录失败');
      historyList.value = [];
    }
  } catch (error) {
    console.error('获取历史记录失败:', error);
    ElMessage.error('获取历史记录失败');
    historyList.value = [];
  } finally {
    loading.value = false;
  }
};

// 刷新历史记录
const refreshHistory = async () => {
  refreshing.value = true;
  try {
    await fetchHistoryData();
    ElMessage.success('刷新成功');
  } catch (error) {
    console.error('刷新失败:', error);
    ElMessage.error('刷新失败');
  } finally {
    refreshing.value = false;
  }
};

// 打开对话
const openChat = (history: History) => {
  router.push(`/chat?dialogue_id=${history.dialogue_id}`);
};

// 跳转到聊天页面
const goToChat = () => {
  router.push('/chat');
};

// 处理历史记录操作
const handleHistoryAction = (command: string, history: History) => {
  switch (command) {
    case 'rename':
      renameForm.value.title = history.title_query;
      historyToRename.value = history;
      renameDialogVisible.value = true;
      break;
    case 'delete':
      historyToDelete.value = history;
      deleteDialogVisible.value = true;
      break;
  }
};

// 重命名确认
const handleRenameConfirm = async () => {
  if (!renameFormRef.value || !historyToRename.value) return;

  try {
    const valid = await renameFormRef.value.validate();
    if (valid) {
      // 调用重命名 API
      const formData = new FormData();
      formData.append('id', historyToRename.value.id.toString());
      formData.append('rename', renameForm.value.title);

      const res = await renameHistory(formData);
      if (res.code === 200) {
        // 更新本地数据
        const index = historyList.value.findIndex(h => h.id === historyToRename.value!.id);
        if (index !== -1) {
          historyList.value[index].title_query = renameForm.value.title;
        }
        renameDialogVisible.value = false;
        historyToRename.value = null;
        ElMessage.success('重命名成功');
      } else {
        ElMessage.error(res.msg || '重命名失败');
      }
    }
  } catch (error) {
    console.error('重命名失败:', error);
    ElMessage.error('重命名失败，请重试');
  }
};

// 删除确认
const handleDeleteConfirm = async () => {
  if (!historyToDelete.value) return;

  try {
    // 调用删除 API
    const formData = new FormData();
    formData.append('id', historyToDelete.value.id.toString());

    const res = await deleteHistory(formData);
    if (res.code === 200) {
      // 从本地列表中移除
      const index = historyList.value.findIndex(h => h.id === historyToDelete.value!.id);
      if (index !== -1) {
        historyList.value.splice(index, 1);
      }
      deleteDialogVisible.value = false;
      historyToDelete.value = null;
      ElMessage.success('删除成功');
    } else {
      ElMessage.error(res.msg || '删除失败');
    }
  } catch (error) {
    console.error('删除失败:', error);
    ElMessage.error('删除失败，请重试');
  }
};

// 处理重命名对话框关闭
const handleRenameDialogClose = () => {
  historyToRename.value = null;
  renameForm.value.title = '';
  if (renameFormRef.value) {
    renameFormRef.value.resetFields();
  }
};

// 格式化日期
const formatDate = (dateString: string) => {
  const date = new Date(dateString);
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
};

// 组件挂载时获取数据
onMounted(() => {
  fetchHistoryData();
});
</script>

<style lang="scss" scoped>
.history-container {
  padding: 24px;
  background-color: #f5f7fa;
  min-height: 100vh;
}

.history-content {
  max-width: 1200px;
  margin: 0 auto;
  background-color: #fff;
  border-radius: 8px;
  box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.1);
  overflow: hidden;
}

.loading-container {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  gap: 12px;
  color: #909399;
  font-size: 16px;
}

.empty-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 20px;
  text-align: center;

  .el-icon {
    font-size: 64px;
    color: var(--el-text-color-placeholder);
    margin-bottom: 24px;
  }

  h3 {
    margin: 0 0 16px 0;
    font-size: 20px;
    color: var(--el-text-color-primary);
    font-weight: 500;
  }

  p {
    margin: 0 0 24px 0;
    color: var(--el-text-color-secondary);
    font-size: 14px;
    line-height: 1.6;
  }
}

.list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 24px 24px 16px;
  border-bottom: 1px solid var(--el-border-color);

  h3 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    color: var(--el-text-color-primary);
  }
}

.history-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
  gap: 20px;
  padding: 24px;
}

.history-item {
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  padding: 20px;
  cursor: pointer;
  transition: all 0.3s ease;
  background-color: var(--color-background-card);

  &:hover {
    border-color: var(--el-color-primary);
    box-shadow: 0 4px 12px rgba(var(--el-color-primary-rgb), 0.15);
    transform: translateY(-2px);
  }

  .history-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 16px;

    .history-title {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 1;
      min-width: 0;

      .history-icon {
        font-size: 20px;
        color: var(--el-color-primary);
        flex-shrink: 0;
      }

      .title-text {
        font-size: 16px;
        font-weight: 500;
        color: var(--el-text-color-primary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    }

    .history-actions {
      flex-shrink: 0;
      margin-left: 12px;

      .action-icon {
        font-size: 18px;
        color: var(--el-text-color-secondary);
        cursor: pointer;
        padding: 4px;
        border-radius: 4px;
        transition: all 0.2s ease;

        &:hover {
          background-color: var(--el-fill-color-light);
          color: var(--el-text-color-primary);
        }
      }
    }
  }

  .history-content {
    margin-bottom: 20px;

    .history-meta {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
      font-size: 12px;
      color: var(--el-text-color-secondary);

      .history-date {
        color: var(--el-color-success);
      }

      .history-id {
        color: var(--el-text-color-secondary);
      }
    }

    .history-preview {
      color: var(--el-text-color-primary);
      font-size: 14px;
      line-height: 1.5;
      overflow: hidden;
      text-overflow: ellipsis;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }
  }

  .history-footer {
    display: flex;
    justify-content: flex-end;
  }
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.delete-confirm-content {
  text-align: center;
  padding: 20px 0;

  .warning-icon {
    font-size: 48px;
    color: var(--el-color-warning);
    margin-bottom: 16px;
  }

  p {
    margin: 8px 0;
    color: var(--el-text-color-primary);

    &.history-title-to-delete {
      font-weight: 500;
      color: var(--el-text-color-primary);
      background-color: var(--color-background-hover);
      padding: 8px 12px;
      border-radius: 4px;
      margin: 12px 0;
    }
  }
}

// 响应式设计
@media (max-width: 768px) {
  .history-container {
    padding: 16px;
  }

  .history-grid {
    grid-template-columns: 1fr;
    gap: 16px;
    padding: 16px;
  }

  .list-header {
    padding: 16px 16px 12px;
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;

    h3 {
      font-size: 16px;
    }
  }
}

// 深色模式适配
.theme-dark .history-container {
  background-color: var(--color-background);
}

.theme-dark .history-content {
  background-color: var(--color-background-card);
  box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.3);
}

.theme-dark .loading-container {
  color: var(--el-text-color-secondary);
}

.theme-dark .empty-container {
  .el-icon {
    color: var(--el-text-color-placeholder);
  }

  h3 {
    color: var(--el-text-color-primary);
  }

  p {
    color: var(--el-text-color-secondary);
  }
}

.theme-dark .list-header {
  border-bottom-color: var(--color-border);

  h3 {
    color: var(--el-text-color-primary);
  }
}

.theme-dark .history-item {
  background-color: var(--color-background-card);
  border-color: var(--color-border);

  &:hover {
    border-color: var(--el-color-primary);
    box-shadow: 0 4px 12px rgba(var(--el-color-primary-rgb), 0.25);
    background-color: var(--color-background);
  }

  .history-title {
    .title-text {
      color: var(--el-text-color-primary);
    }
  }

  .history-actions {
    .action-icon {
      color: var(--el-text-color-secondary);

      &:hover {
        background-color: var(--el-fill-color-darker);
        color: var(--el-text-color-primary);
      }
    }
  }

  .history-content {
    .history-meta {
      color: var(--el-text-color-secondary);

      .history-date {
        color: var(--el-color-success);
      }

      .history-id {
        color: var(--el-text-color-secondary);
      }
    }

    .history-preview {
      color: var(--el-text-color-primary);
    }
  }
}

.theme-dark .delete-confirm-content {
  .warning-icon {
    color: var(--el-color-warning);
  }

  p {
    color: var(--el-text-color-primary);

    &.history-title-to-delete {
      color: var(--el-text-color-primary);
      background-color: var(--color-background-hover);
    }
  }
}

// 深色模式下对话框样式适配
.theme-dark :deep(.el-dialog) {
  background-color: var(--color-background-card);
  border: 1px solid var(--color-border);
}

.theme-dark :deep(.el-dialog__title) {
  color: var(--el-text-color-primary);
}

.theme-dark :deep(.el-dialog__body) {
  color: var(--el-text-color-primary);
}

.theme-dark :deep(.el-input__wrapper) {
  background-color: var(--color-background);
  border-color: var(--color-border);
}

.theme-dark :deep(.el-form-item__label) {
  color: var(--el-text-color-primary);
}

// 下拉菜单深色模式适配
.theme-dark :deep(.el-dropdown-menu) {
  background-color: var(--color-background-card);
  border-color: var(--color-border);
}

.theme-dark :deep(.el-dropdown-menu__item) {
  color: var(--el-text-color-primary);

  &:hover {
    background-color: var(--color-background-hover);
  }
}

.theme-dark .refresh-btn {
  color: #333;

  &:hover {
    color: #409eff;
  }
}
</style>
