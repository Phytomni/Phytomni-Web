<template>
  <div class="favorites-container">

    <!-- 收藏列表 -->
    <div class="favorites-content">
      <div v-if="loading" class="loading-container">
        <el-icon class="is-loading"><Loading /></el-icon>
        <span>{{ $t('common.loading') }}</span>
      </div>

      <div v-else-if="favoritesList.length === 0" class="empty-container">
        <el-icon class="empty-icon"><Star /></el-icon>
        <h3>{{ $t('chat.noFavorites') }}</h3>
        <p>{{ $t('chat.noFavoritesDescription') }}</p>
        <el-button @click="goToChat" type="primary">
          {{ $t('chat.startChat') }}
        </el-button>
      </div>

      <div v-else class="favorites-list">
        <div class="list-header">
          <h3>{{ $t('chat.favoritesCount', { count: favoritesList.length }) }}</h3>
          <el-button @click="refreshFavorites" :loading="refreshing" size="small">
            <el-icon><Refresh /></el-icon>
            {{ $t('common.refresh') }}
          </el-button>
        </div>

        <div class="favorites-grid">
          <div 
            v-for="favorite in favoritesList" 
            :key="favorite.id" 
            class="favorite-item"
            @click="openChat(favorite)"
          >
            <div class="favorite-header">
              <div class="favorite-title">
                <el-icon class="star-icon"><Star /></el-icon>
                <span class="title-text">{{ favorite.title }}</span>
              </div>
              <div class="favorite-actions" @click.stop>
                <el-dropdown trigger="click" @command="(command) => handleFavoriteAction(command, favorite)">
                  <el-icon class="action-icon">
                    <MoreFilled />
                  </el-icon>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item command="rename" :icon="Edit">
                        {{ $t('chat.actions.rename') }}
                      </el-dropdown-item>
                      <el-dropdown-item command="unfavorite" :icon="Star">
                        {{ $t('chat.actions.unfavorite') }}
                      </el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
              </div>
            </div>
            
            <div class="favorite-content">
              <div class="favorite-meta">
                <span class="favorite-date">{{ formatDate(favorite.date) }}</span>
                <span class="favorite-id">ID: {{ favorite.id }}</span>
              </div>
              <div class="favorite-preview">
                {{ favorite.title }}
              </div>
            </div>

            <div class="favorite-footer">
              <el-button size="small" @click.stop="openChat(favorite)" type="primary">
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


  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  ArrowLeft,
  Star,
  Edit,
  MoreFilled,
  Loading,
  Refresh,
} from '@element-plus/icons-vue';
import { getCollectHistory, renameHistory, collectHistory } from '@/api/chat';

const router = useRouter();

// 定义收藏项接口
interface FavoriteItem {
  id: number;
  dialogue_id: string;
  title: string;
  date: string;
  isFavorite: boolean;
}

// 响应式数据
const loading = ref(false);
const refreshing = ref(false);
const favoritesList = ref<FavoriteItem[]>([]);

// 重命名对话框相关
const renameDialogVisible = ref(false);
const renameForm = ref({
  title: '',
});
const renameFormRef = ref();
const renameRules = {
  title: [{ required: true, message: '请输入标题', trigger: 'blur' }],
};
const favoriteToRename = ref<FavoriteItem | null>(null);



// 获取收藏列表
const fetchFavorites = async () => {
  loading.value = true;
  try {
    const response = await getCollectHistory({ id: '' }); // 获取所有收藏
    if (response.code === 200 && response.data) {
      favoritesList.value = response.data.map((item: any) => ({
        id: item.id,
        dialogue_id: item.dialogue_id,
        title: item.title_query || item.title || item.query, // 优先使用 title_query
        date: item.created_at || item.date,
        isFavorite: true,
      }));
    } else {
      ElMessage.error(response.msg || '获取收藏列表失败');
    }
  } catch (error) {
    console.error('获取收藏列表失败:', error);
    ElMessage.error('获取收藏列表失败');
  } finally {
    loading.value = false;
  }
};

// 刷新收藏列表
const refreshFavorites = async () => {
  refreshing.value = true;
  await fetchFavorites();
  refreshing.value = false;
};

// 处理收藏项操作
const handleFavoriteAction = (command: string, favorite: FavoriteItem) => {
  switch (command) {
    case 'rename':
      renameForm.value.title = favorite.title;
      favoriteToRename.value = favorite;
      renameDialogVisible.value = true;
      break;
    case 'unfavorite':
      handleUnfavorite(favorite);
      break;
  }
};

// 取消收藏
const handleUnfavorite = async (favorite: FavoriteItem) => {
  console.log(favorite,'favorite');
  try {
    const formData = new FormData();
    formData.append('id', favorite.id.toString());
    formData.append('collect_type', '0'); // 0表示取消收藏
    
    const response = await collectHistory(formData);
    if (response.code === 200) {
      ElMessage.success('已取消收藏');
      // 从列表中移除
      const index = favoritesList.value.findIndex(item => item.id === favorite.id);
      if (index !== -1) {
        favoritesList.value.splice(index, 1);
      }
    } else {
      ElMessage.error(response.msg || '取消收藏失败');
    }
  } catch (error) {
    console.error('取消收藏失败:', error);
    ElMessage.error('取消收藏失败');
  }
};

// 重命名确认
const handleRenameConfirm = async () => {
  if (!renameFormRef.value || !favoriteToRename.value) return;
  
  try {
    const valid = await renameFormRef.value.validate();
    if (valid) {
      const formData = new FormData();
      formData.append('id', favoriteToRename.value.id.toString());
      formData.append('rename', renameForm.value.title);
      
      const response = await renameHistory(formData);
      if (response.code === 200) {
        ElMessage.success('重命名成功');
        // 更新本地数据
        const index = favoritesList.value.findIndex(item => item.id === favoriteToRename.value!.id);
        if (index !== -1) {
          favoritesList.value[index].title = renameForm.value.title;
        }
        renameDialogVisible.value = false;
        favoriteToRename.value = null;
      } else {
        ElMessage.error(response.msg || '重命名失败');
      }
    }
  } catch (error) {
    console.error('重命名失败:', error);
    ElMessage.error('重命名失败');
  }
};



// 处理重命名对话框关闭
const handleRenameDialogClose = () => {
  favoriteToRename.value = null;
  renameForm.value.title = '';
  if (renameFormRef.value) {
    renameFormRef.value.resetFields();
  }
};

// 打开聊天
const openChat = (favorite: FavoriteItem) => {
  router.push(`/chat?dialogue_id=${favorite.dialogue_id}`);
};

// 返回聊天页面
const goBack = () => {
  router.push('/chat');
};

// 跳转到聊天页面
const goToChat = () => {
  router.push('/chat');
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

// 组件挂载时获取收藏列表
onMounted(() => {
  fetchFavorites();
});
</script>

<style lang="scss" scoped>
.favorites-container {
  min-height: 100vh;
  background-color: var(--color-background-soft);
  padding: 20px;
}

  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 30px;
    padding: 24px;
    background: var(--page-card-bg);
    border-radius: 12px;
    box-shadow: var(--page-card-shadow);

  .header-content {
    h1 {
      margin: 0 0 8px 0;
      font-size: 28px;
      font-weight: 600;
      color: #1a1a1a;
    }

    p {
      margin: 0;
      color: #666;
      font-size: 16px;
    }
  }
}

.favorites-content {
  .loading-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 60px 20px;
    background: var(--page-card-bg);
    border-radius: 12px;
    box-shadow: var(--page-card-shadow);

    .el-icon {
      font-size: 32px;
      color: var(--sidebar-btn-active-bg);
      margin-bottom: 16px;
    }

    span {
      color: var(--color-text);
      font-size: 16px;
    }
  }

  .empty-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 80px 20px;
    background: var(--page-card-bg);
    border-radius: 12px;
    box-shadow: var(--page-card-shadow);
    text-align: center;

    .el-icon {
      font-size: 64px;
      color: var(--sidebar-btn-active-bg);
      margin-bottom: 24px;
    }

    h3 {
      margin: 0 0 16px 0;
      font-size: 24px;
      color: var(--color-heading);
    }

    p {
      margin: 0 0 24px 0;
      color: var(--color-text);
      font-size: 16px;
      max-width: 400px;
    }
  }

  .favorites-list {
    background: var(--page-card-bg);
    border-radius: 12px;
    box-shadow: var(--page-card-shadow);
    overflow: hidden;

    .list-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 20px 24px;
      border-bottom: 1px solid var(--color-border);

      h3 {
        margin: 0;
        font-size: 18px;
        color: var(--color-heading);
      }
    }

    .favorites-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
      gap: 20px;
      padding: 24px;

      .favorite-item {
        border: 1px solid var(--page-card-border);
        border-radius: 8px;
        padding: 20px;
        cursor: pointer;
        transition: all 0.3s ease;
        background: var(--page-card-bg);

        &:hover {
          border-color: var(--sidebar-btn-active-bg);
          box-shadow: var(--sidebar-btn-shadow-hover);
          transform: translateY(-2px);
        }

        .favorite-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 16px;

          .favorite-title {
            display: flex;
            align-items: center;
            gap: 8px;
            flex: 1;
            min-width: 0;

            .star-icon {
              color: var(--sidebar-btn-active-bg);
              font-size: 18px;
              flex-shrink: 0;
            }

            .title-text {
              font-size: 16px;
              font-weight: 500;
              color: var(--color-heading);
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
            }
          }

          .favorite-actions {
            .action-icon {
              font-size: 18px;
              color: #909399;
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

        .favorite-content {
          margin-bottom: 20px;

          .favorite-meta {
            display: flex;
            justify-content: space-between;
            margin-bottom: 12px;
            font-size: 12px;
            color: var(--page-text-secondary);

            .favorite-date {
              flex: 1;
            }

            .favorite-id {
              flex-shrink: 0;
            }
          }

          .favorite-preview {
            color: var(--color-text);
            font-size: 14px;
            line-height: 1.5;
            overflow: hidden;
            text-overflow: ellipsis;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
          }
        }

        .favorite-footer {
          display: flex;
          justify-content: flex-end;
        }
      }
    }
  }
}

// 对话框样式
.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}



// 响应式设计
@media (max-width: 768px) {
  .favorites-container {
    padding: 16px;
  }

  .page-header {
    flex-direction: column;
    gap: 16px;
    align-items: stretch;

    .header-content {
      text-align: center;
    }
  }

  .favorites-grid {
    grid-template-columns: 1fr !important;
    gap: 16px !important;
    padding: 16px !important;
  }
}
</style> 