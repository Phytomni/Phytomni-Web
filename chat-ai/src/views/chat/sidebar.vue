<template>
  <div class="sidebar" :class="{ collapsed: sidebarCollapsed }">
    <!-- 顶部标题栏 -->
    <div class="sidebar-header">
      <div class="app-title">
        <!-- <div
          class="logo"
          @click="expandSidebar"
          :class="{ clickable: sidebarCollapsed }"></div> -->
        <img src="../../assets/images/chat/logo.png" class="logo" alt="Logo" @click="expandSidebar"
          :class="{ clickable: sidebarCollapsed }" />
        <span v-if="!sidebarCollapsed">{{ $t('chat.appTitle') }}</span>
      </div>
      <el-button v-if="!sidebarCollapsed" type="text" class="collapse-btn" @click="collapseSidebar">
        <el-icon>
          <Fold />
        </el-icon>
      </el-button>
    </div>
    <!-- 新对话和知识库按钮 -->
    <div class="new-chat-container" :class="{ 
      vertical: sidebarCollapsed,
      'show-tutorial': showTutorial 
    }">
      <el-button class="new-chat-btn" :class="{ active: activeButton === 'new-chat' }" @click="handleButtonClick('new-chat', startNewChat)">
        <el-icon>
          <Document />
        </el-icon>
        <span v-if="!sidebarCollapsed">{{ $t('chat.newChat') }}</span>
      </el-button>
      <el-button class="knowledge-base-btn" :class="{ active: activeButton === 'knowledge-base' }" @click="handleButtonClick('knowledge-base', openKnowledgeBase)">
        <el-icon>
          <Search />
        </el-icon>
        <!-- <span v-if="!sidebarCollapsed">{{ $t('chat.knowledgeBase') }}</span> -->
        <span v-if="!sidebarCollapsed">{{ $t('chat.geneDetail') }}</span>
      </el-button>
      <el-button class="favorites-btn" :class="{ active: activeButton === 'favorites' }" @click="handleButtonClick('favorites', openFavorites)">
        <el-icon>
          <Star />
        </el-icon>
        <span v-if="!sidebarCollapsed">{{ $t('chat.favorites') }}</span>
      </el-button>
      <el-button class="tutorial-btn" :class="{ active: activeButton === 'tutorial' }" @click="handleButtonClick('tutorial', startTutorial)">
        <el-icon>
          <QuestionFilled />
        </el-icon>
        <span v-if="!sidebarCollapsed">{{ $t('tutorial.startTutorial') }}</span>
      </el-button>
    </div>

    <!-- 对话历史列表，按时间分组 -->
    <div class="chat-history" :class="{ 'show-tutorial': showTutorial }">
      <template v-if="!sidebarCollapsed">
        <!-- 今天 -->
        <div class="time-group" v-if="todayChats.length">
          <div class="time-label">
            <span>{{ $t('chat.timeGroup.today') }}</span>
            <el-icon class="expand-icon">
              <ArrowUp />
            </el-icon>
          </div>
          <div class="chat-items">
            <el-tooltip v-for="chat in todayChats" :key="chat.id" :content="chat.title" placement="right"
              :show-after="1000" popper-class="chat-tooltip">
              <div class="chat-item" :class="{ active: currentChatId === chat.dialogue_id }"
                @click="selectChat(chat.dialogue_id)">
                <span class="chat-title">{{ chat.title }}</span>
                <!-- 操作图标 -->
                <div class="chat-actions" @click.stop>
                  <el-dropdown trigger="click" @command="(command) => handleChatAction(command, chat)">
                    <el-icon class="action-icon">
                      <MoreFilled />
                    </el-icon>
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item command="rename" :icon="Edit">
                          {{ $t('chat.actions.rename') }}
                        </el-dropdown-item>
                        <el-dropdown-item command="favorite" :icon="Star">
                          {{ chat.isFavorite ? $t('chat.actions.unfavorite') : $t('chat.actions.favorite') }}
                        </el-dropdown-item>
                        <el-dropdown-item command="delete" :icon="Delete" divided>
                          <span style="color: #f56c6c">{{ $t('chat.actions.delete') }}</span>
                        </el-dropdown-item>
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                </div>
              </div>
            </el-tooltip>
          </div>
        </div>

        <!-- 昨天 -->
        <div class="time-group" v-if="yesterdayChats.length">
          <div class="time-label">
            <span>{{ $t('chat.timeGroup.yesterday') }}</span>
            <el-icon class="expand-icon">
              <ArrowDown />
            </el-icon>
          </div>
          <div class="chat-items">
            <el-tooltip v-for="chat in yesterdayChats" :key="chat.id" :content="chat.title" placement="right"
              :show-after="1000" popper-class="chat-tooltip">
              <div class="chat-item" :class="{ active: currentChatId === chat.dialogue_id }"
                @click="selectChat(chat.dialogue_id)">
                <span class="chat-title">{{ chat.title }}</span>
                <!-- 操作图标 -->
                <div class="chat-actions" @click.stop>
                  <el-dropdown trigger="click" @command="(command) => handleChatAction(command, chat)">
                    <el-icon class="action-icon">
                      <MoreFilled />
                    </el-icon>
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item command="rename" :icon="Edit">
                          {{ $t('chat.actions.rename') }}
                        </el-dropdown-item>
                        <el-dropdown-item command="favorite" :icon="Star">
                          {{ chat.isFavorite ? $t('chat.actions.unfavorite') : $t('chat.actions.favorite') }}
                        </el-dropdown-item>
                        <el-dropdown-item command="delete" :icon="Delete" divided>
                          <span style="color: #f56c6c">{{ $t('chat.actions.delete') }}</span>
                        </el-dropdown-item>
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                </div>
              </div>
            </el-tooltip>
          </div>
        </div>

        <!-- 7天内 -->
        <div class="time-group" v-if="weekChats.length">
          <div class="time-label">
            <span>{{ $t('chat.timeGroup.week') }}</span>
            <el-icon class="expand-icon">
              <ArrowDown />
            </el-icon>
          </div>
          <div class="chat-items">
            <el-tooltip v-for="chat in weekChats" :key="chat.id" :content="chat.title" placement="right"
              :show-after="1000" popper-class="chat-tooltip">
              <div class="chat-item" :class="{ active: currentChatId === chat.dialogue_id }"
                @click="selectChat(chat.dialogue_id)">
                <span class="chat-title">{{ chat.title }}</span>
                <!-- 操作图标 -->
                <div class="chat-actions" @click.stop>
                  <el-dropdown trigger="click" @command="(command) => handleChatAction(command, chat)">
                    <el-icon class="action-icon">
                      <MoreFilled />
                    </el-icon>
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item command="rename" :icon="Edit">
                          {{ $t('chat.actions.rename') }}
                        </el-dropdown-item>
                        <el-dropdown-item command="favorite" :icon="Star">
                          {{ chat.isFavorite ? $t('chat.actions.unfavorite') : $t('chat.actions.favorite') }}
                        </el-dropdown-item>
                        <el-dropdown-item command="delete" :icon="Delete" divided>
                          <span style="color: #f56c6c">{{ $t('chat.actions.delete') }}</span>
                        </el-dropdown-item>
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                </div>
              </div>
            </el-tooltip>
          </div>
        </div>

        <!-- 一周前 -->
        <div class="time-group" v-if="olderChats.length">
          <div class="time-label">
            <span>{{ $t('chat.timeGroup.older') }}</span>
            <el-icon class="expand-icon">
              <ArrowDown />
            </el-icon>
          </div>
          <div class="chat-items">
            <el-tooltip v-for="chat in olderChats" :key="chat.id" :content="chat.title" placement="right"
              :show-after="1000" popper-class="chat-tooltip">
              <div class="chat-item" :class="{ active: currentChatId === chat.dialogue_id }"
                @click="selectChat(chat.dialogue_id)">
                <span class="chat-title">{{ chat.title }}</span>
                <!-- 操作图标 -->
                <div class="chat-actions" @click.stop>
                  <el-dropdown trigger="click" @command="(command) => handleChatAction(command, chat)">
                    <el-icon class="action-icon">
                      <MoreFilled />
                    </el-icon>
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item command="rename" :icon="Edit">
                          {{ $t('chat.actions.rename') }}
                        </el-dropdown-item>
                        <el-dropdown-item command="favorite" :icon="Star">
                          {{ chat.isFavorite ? $t('chat.actions.unfavorite') : $t('chat.actions.favorite') }}
                        </el-dropdown-item>
                        <el-dropdown-item command="delete" :icon="Delete" divided>
                          <span style="color: #f56c6c">{{ $t('chat.actions.delete') }}</span>
                        </el-dropdown-item>
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                </div>
              </div>
            </el-tooltip>
          </div>
        </div>
      </template>
    </div>


    <!-- 用户信息 -->
    <div class="user-info">
      <el-dropdown trigger="hover" @command="handleCommand">
        <div class="user-avatar-container">
          <el-avatar :size="32" src="https://cube.elemecdn.com/0/88/03b0d39583f48206768a7534e55bcpng.png" />
          <span v-if="!sidebarCollapsed" class="username">
            {{ UserStore.name || '未设置用户名' }}
          </span>
          <el-icon v-if="!sidebarCollapsed">
            <ArrowDown />
          </el-icon>
        </div>
        <template #dropdown>
          <el-dropdown-menu>
            <!-- 历史记录 -->
            <el-dropdown-item v-if="hasPermission('历史记录')" command="history" :icon="Document">
              {{ $t('user.history') }}
            </el-dropdown-item>
            <!-- 个人资料管理 -->
            <el-dropdown-item v-if="hasPermission('个人资料管理')" command="profile" :icon="User">
              {{ $t('user.profile') }}
            </el-dropdown-item>
            <!-- 网盘空间 -->
            <el-dropdown-item v-if="hasPermission('网盘空间')" command="cloudStorage" :icon="Folder">
              {{ $t('user.cloudStorage') }}
            </el-dropdown-item>
            <!-- 用户管理 -->
            <el-dropdown-item v-if="hasPermission('用户管理')" command="userManagement" :icon="User">
              {{ $t('user.list') }}
            </el-dropdown-item>
            <!-- 角色权限分配 -->
            <el-dropdown-item v-if="hasPermission('角色权限分配')" command="permissionManagement" :icon="Lock">
              {{ $t('permission.title') }}
            </el-dropdown-item>
            <!-- 系统监控 -->
            <el-dropdown-item v-if="hasPermission('系统监控')" command="systemMonitor" :icon="Monitor">
              {{ $t('user.systemMonitor') }}
            </el-dropdown-item>
            <!-- 全局策略配置 -->
            <el-dropdown-item v-if="hasPermission('全局策略配置')" command="globalConfig" :icon="Setting">
              {{ $t('user.globalConfig') }}
            </el-dropdown-item>
            <!-- 管理员管理 -->
            <el-dropdown-item v-if="hasPermission('管理员管理')" command="adminManagement" :icon="User">
              {{ $t('user.adminManagement') }}
            </el-dropdown-item>
            <!-- 用户反馈 -->
            <el-dropdown-item command="feedback" :icon="ChatDotRound">
              {{ $t('user.feedback') }}
            </el-dropdown-item>
            <!-- 修改密码 -->
            <el-dropdown-item command="changePassword" :icon="Lock">
              {{ $t('user.changePassword') }}
            </el-dropdown-item>
            <!-- 登出 -->
            <el-dropdown-item command="logout" :icon="SwitchButton" divided>
              <span style="color: #f56c6c">{{ $t('user.logout') }}</span>
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

    <!-- 重命名对话框 -->
    <el-dialog v-model="renameDialogVisible" :title="$t('chat.actions.rename')" width="400px"
      :close-on-click-modal="false" :close-on-press-escape="false" @close="handleRenameDialogClose">
      <el-form :model="renameForm" ref="renameFormRef" :rules="renameRules">
        <el-form-item prop="title" :label="$t('chat.title')">
          <el-input v-model="renameForm.title" :placeholder="$t('chat.actions.enterNewTitle')" maxlength="100"
            show-word-limit @keyup.enter="handleRenameConfirm" />
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
    <el-dialog v-model="deleteDialogVisible" :title="$t('chat.actions.deleteConfirm')" width="400px"
      :close-on-click-modal="false" :close-on-press-escape="false">
      <div class="delete-confirm-content">
        <el-icon class="warning-icon">
          <Warning />
        </el-icon>
        <p>{{ $t('chat.actions.deleteWarning') }}</p>
        <p class="chat-title-to-delete">{{ chatToDelete?.title }}</p>
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
import { computed, ref, watch, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import {
  User,
  Document,
  Lock,
  SwitchButton,
  Fold,
  Folder,
  Search,
  MoreFilled,
  Edit,
  Star,
  Delete,
  Warning,
  ArrowUp,
  ArrowDown,
  ChatDotRound,
  QuestionFilled,
  Monitor,
  Setting,
} from '@element-plus/icons-vue';
import { userStore } from '@/stores';
import { collectHistory, renameHistory, deleteHistory } from '@/api/chat';
import { ElMessage } from 'element-plus';

// 定义Chat接口
interface Chat {
  id: number;
  dialogue_id: string;
  title: string;
  date: string; // 与index.vue保持一致，用date代替created_at
  isFavorite: boolean; // 新增收藏状态
}

// 定义接收的属性
const props = defineProps({
  chatList: {
    type: Array as () => Chat[],
    required: true,
  },
  currentChatId: {
    type: String,
    default: '',
  },
  collapsed: {
    type: Boolean,
    default: false,
  },
  showTutorial: {
    type: Boolean,
    default: false,
  },
});
const router = useRouter();
const UserStore = userStore();
// 定义向父组件发送的事件
const emit = defineEmits([
  'selectChat',
  'startNewChat',
  'openKnowledgeBase',
  'handleSidebarCollapse',
  'chatRenamed',
  'chatDeleted',
  'chatFavorited',
  'startTutorial',
]);

// 侧边栏折叠状态
const sidebarCollapsed = ref(props.collapsed);

// 当前激活的按钮
const activeButton = ref('');

// 处理按钮点击
const handleButtonClick = (buttonType: string, action: () => void) => {
  activeButton.value = buttonType;
  action();
};

// 响应式断点（小于此宽度时自动收起侧边栏）
const RESPONSIVE_BREAKPOINT = 1200;

// 防抖定时器
let resizeTimer: ReturnType<typeof setTimeout> | null = null;

// 用户偏好设置 - 是否启用自动展开功能
const autoExpandEnabled = ref(true);

// 重命名对话框相关
const renameDialogVisible = ref(false);
const renameForm = ref({
  title: '',
});
const renameFormRef = ref();
const renameRules = {
  title: [{ required: true, message: '请输入标题', trigger: 'blur' }],
};
const chatToRename = ref<Chat | null>(null);

// 删除确认对话框相关
const deleteDialogVisible = ref(false);
const chatToDelete = ref<Chat | null>(null);

// 检查窗口大小并自动调整侧边栏状态
const checkWindowSize = () => {
  const windowWidth = window.innerWidth;
  if (windowWidth < RESPONSIVE_BREAKPOINT && !sidebarCollapsed.value) {
    sidebarCollapsed.value = true;
  } else if (windowWidth >= RESPONSIVE_BREAKPOINT && sidebarCollapsed.value && autoExpandEnabled.value) {
    sidebarCollapsed.value = false;
  }
};

// 监听窗口大小变化（带防抖）
const handleResize = () => {
  if (resizeTimer) {
    clearTimeout(resizeTimer);
  }
  resizeTimer = setTimeout(() => {
    checkWindowSize();
  }, 100); // 100ms 防抖延迟
};

// 监听外部传入的状态变化
watch(
  () => props.collapsed,
  newVal => {
    sidebarCollapsed.value = newVal;
  }
);

// 监听内部状态变化，通知父组件
watch(sidebarCollapsed, newVal => {
  emit('handleSidebarCollapse', newVal);
});

// 监听自动展开设置变化，保存到localStorage
watch(autoExpandEnabled, newVal => {
  localStorage.setItem('sidebarAutoExpand', JSON.stringify(newVal));
});

// 展开侧边栏 - 只有当侧边栏是折叠状态时才能展开
const expandSidebar = () => {
  if (sidebarCollapsed.value) {
    sidebarCollapsed.value = false;
    // 用户手动展开时，暂时禁用自动展开功能
    autoExpandEnabled.value = false;
    // 3秒后重新启用自动展开功能
    setTimeout(() => {
      autoExpandEnabled.value = true;
    }, 3000);
  }
};

// 折叠侧边栏
const collapseSidebar = () => {
  sidebarCollapsed.value = true;
  // 用户手动收起时，暂时禁用自动展开功能
  autoExpandEnabled.value = false;
  // 3秒后重新启用自动展开功能
  setTimeout(() => {
    autoExpandEnabled.value = true;
  }, 3000);
};

// 用户菜单相关
const handleCommand = (command: string) => {
  switch (command) {
    case 'userManagement':
      if (hasPermission('用户管理')) handleUserManagement();
      break;
    case 'systemMonitor':
      if (hasPermission('系统监控')) handleSystemMonitor();
      break;
    case 'permissionManagement':
      if (hasPermission('角色权限分配')) handlePermissionManagement();
      break;
    case 'globalConfig':
      if (hasPermission('全局策略配置')) handleGlobalConfig();
      break;
    case 'adminManagement':
      if (hasPermission('管理员管理')) handleAdminManagement();
      break;
    case 'history':
      if (hasPermission('历史记录')) handleHistory();
      break;
    case 'profile':
      if (hasPermission('个人资料管理')) handleProfile();
      break;
    case 'cloudStorage':
      if (hasPermission('网盘空间')) handleCloudStorage();
      break;
    case 'feedback':
      handleFeedback();
      break;
    case 'changePassword':
      handleChangePassword();
      break;
    case 'logout':
      handleLogout();
      break;
  }
};

// 处理聊天历史项操作
const handleChatAction = (command: string, chat: Chat) => {
  switch (command) {
    case 'rename':
      renameForm.value.title = chat.title;
      chatToRename.value = chat;
      renameDialogVisible.value = true;
      break;
    case 'favorite':
      toggleFavorite(chat);
      break;
    case 'delete':
      chatToDelete.value = chat;
      deleteDialogVisible.value = true;
      break;
  }
};

// 重命名确认
const handleRenameConfirm = async () => {
  if (!renameFormRef.value || !chatToRename.value) return;

  try {
    const valid = await renameFormRef.value.validate();
    if (valid) {
      const formData = new FormData();
      formData.append('id', chatToRename.value.id.toString());
      formData.append('rename', renameForm.value.title);

      const response = await renameHistory(formData);
      if (response.code === 200) {
        const updatedChat = { ...chatToRename.value, title: renameForm.value.title };
        // 更新本地数据
        const index = props.chatList.findIndex(c => c.dialogue_id === updatedChat.dialogue_id);
        if (index !== -1) {
          props.chatList[index] = updatedChat;
        }
        renameDialogVisible.value = false;
        chatToRename.value = null;
        // 通知父组件聊天已重命名
        emit('chatRenamed', updatedChat);
        // 显示成功提示
        ElMessage.success('重命名成功');
      } else {
        ElMessage.error(response.msg || '重命名失败');
      }
    }
  } catch (error) {
    console.error('重命名失败:', error);
    ElMessage.error('重命名失败，请重试');
  }
};

// 删除确认
const handleDeleteConfirm = async () => {
  if (!chatToDelete.value) return;

  try {
    const formData = new FormData();
    formData.append('id', chatToDelete.value.id.toString());
    formData.append('reaction_type', '0'); // 0表示删除

    const response = await deleteHistory(formData);
    if (response.code === 200) {
      // 从本地列表中移除
      const index = props.chatList.findIndex(c => c.dialogue_id === chatToDelete.value!.dialogue_id);
      if (index !== -1) {
        const deletedChat = props.chatList[index];
        props.chatList.splice(index, 1);
        // 通知父组件聊天已删除
        emit('chatDeleted', deletedChat);
      }
      deleteDialogVisible.value = false;
      // 刷新当前聊天
      if (props.currentChatId === chatToDelete.value!.dialogue_id) {
        emit('selectChat', '');
      }
      chatToDelete.value = null;
      // 显示成功提示
      ElMessage.success('删除成功');
    } else {
      ElMessage.error(response.msg || '删除失败');
    }
  } catch (error) {
    console.error('删除失败:', error);
    ElMessage.error('删除失败，请重试');
  }
};

// 切换收藏状态
const toggleFavorite = async (chat: Chat) => {
  try {
    const formData = new FormData();
    formData.append('id', chat.id.toString());
    formData.append('collect_type', chat.isFavorite ? '0' : '1'); // 0取消收藏，1收藏

    const response = await collectHistory(formData);
    if (response.code === 200) {
      const updatedChat = { ...chat, isFavorite: !chat.isFavorite };
      // 更新本地数据
      const index = props.chatList.findIndex(c => c.dialogue_id === updatedChat.dialogue_id);
      if (index !== -1) {
        props.chatList[index] = updatedChat;
      }
      // 通知父组件收藏状态已更改
      emit('chatFavorited', updatedChat);
      // 显示成功提示
      ElMessage.success(updatedChat.isFavorite ? '已收藏' : '已取消收藏');
    } else {
      ElMessage.error(response.msg || '操作失败');
    }
  } catch (error) {
    console.error('收藏操作失败:', error);
    ElMessage.error('操作失败，请重试');
  }
};

// 处理重命名对话框关闭
const handleRenameDialogClose = () => {
  chatToRename.value = null;
  renameForm.value.title = '';
  if (renameFormRef.value) {
    renameFormRef.value.resetFields();
  }
};

// 用户管理
const handleUserManagement = () => router.push('/user-list');

// 系统监控
const handleSystemMonitor = () => router.push('/log-list');

// 权限管理
const handlePermissionManagement = () => router.push('/permi-manage');

// 全局策略配置
const handleGlobalConfig = () => router.push('/global-config');

// 管理员管理
const handleAdminManagement = () => router.push('/admin-management');

// 用户反馈
const handleFeedback = () => router.push('/feedback');

// 修改密码
const handleChangePassword = () => router.push('/change-password');

// 登出
const handleLogout = () => {
  UserStore.FedLogOut().then(() => router.replace('/login'));
};

// 处理新对话点击事件
const startNewChat = () => emit('startNewChat');

// 处理知识库点击事件
const openKnowledgeBase = () => {
  router.push('/gene-display');
};

// 处理收藏页点击事件
const openFavorites = () => {
  router.push('/favorites');
};

// 处理历史记录点击事件
const handleHistory = () => {
  router.push('/history');
};

// 处理个人资料点击事件
const handleProfile = () => {
  router.push('/profile');
};

// 处理网盘空间点击事件
const handleCloudStorage = () => {
  router.push('/cloud-storage');
};

// 处理开始教学点击事件
const startTutorial = () => {
  emit('startTutorial');
};

// 处理选择对话事件
const selectChat = (dialogueId: string) => emit('selectChat', dialogueId);

// 权限检查方法
const hasPermission = (permission: string) => {
  return UserStore.permission_list.includes(permission);
};

// 按日期分组
const todayChats = computed(() => {
  const today = new Date();
  today.setHours(0, 0, 0, 0); // 设置为今天的开始时间

  return props.chatList.filter((chat: Chat) => {
    const chatDate = new Date(chat.date);
    return chatDate >= today;
  });
});

const yesterdayChats = computed(() => {
  const today = new Date();
  today.setHours(0, 0, 0, 0); // 今天的开始时间

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1); // 昨天的开始时间

  return props.chatList.filter((chat: Chat) => {
    const chatDate = new Date(chat.date);
    return chatDate >= yesterday && chatDate < today;
  });
});

const weekChats = computed(() => {
  const today = new Date();
  today.setHours(0, 0, 0, 0); // 今天的开始时间

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1); // 昨天的开始时间

  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7); // 7天前的开始时间

  return props.chatList.filter((chat: Chat) => {
    const chatDate = new Date(chat.date);
    return chatDate >= weekAgo && chatDate < yesterday;
  });
});

// 添加一周前的聊天记录
const olderChats = computed(() => {
  const weekAgo = new Date();
  weekAgo.setHours(0, 0, 0, 0); // 今天的开始时间
  weekAgo.setDate(weekAgo.getDate() - 7); // 7天前的开始时间

  return props.chatList.filter((chat: Chat) => {
    const chatDate = new Date(chat.date);
    return chatDate < weekAgo;
  });
});

// 组件挂载时检查窗口大小并添加监听器
onMounted(() => {
  checkWindowSize();
  window.addEventListener('resize', handleResize);

  // 从localStorage读取用户偏好设置
  const savedAutoExpand = localStorage.getItem('sidebarAutoExpand');
  if (savedAutoExpand !== null) {
    autoExpandEnabled.value = JSON.parse(savedAutoExpand);
  }
});

// 组件卸载时移除监听器和清理定时器
onUnmounted(() => {
  window.removeEventListener('resize', handleResize);
  if (resizeTimer) {
    clearTimeout(resizeTimer);
  }
});
</script>

<style lang="scss" scoped>
// 侧边栏样式
.sidebar {
  width: 250px;
  background-color: #f9fbff;
  display: flex;
  flex-direction: column;
  border-right: 1px solid #e6e6e6;
  transition: width 0.3s ease;

  &.collapsed {
    width: 60px;

    .new-chat-container {
      width: 40px;
      margin: 0 auto;
    }
  }
}

// 响应式样式
@media (max-width: 1200px) {
  .sidebar {
    position: fixed;
    top: 0;
    left: 0;
    height: 100vh;
    z-index: 1000;
    box-shadow: 2px 0 8px 0 rgba(29, 35, 41, 0.15);
  }
}

@media (min-width: 1201px) {
  .sidebar {
    position: relative;
    box-shadow: none;

    // 在大屏幕上确保侧边栏正常显示
    &.collapsed {
      width: 60px;
    }
  }
}

@media (max-width: 768px) {
  .sidebar {
    &.collapsed {
      width: 50px;

      .new-chat-container {
        width: 30px;
        padding: 12px 5px;

        .new-chat-btn,
        .knowledge-base-btn,
        .favorites-btn,
        .tutorial-btn {
          width: 30px;
          height: 30px;

          .el-icon {
            font-size: 16px;
          }
        }
      }
    }
  }
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  border-bottom: 1px solid #e6e6e6;
  height: 62px;

  .app-title {
    display: flex;
    align-items: center;
    font-size: 24px;
    font-weight: 700;
    color: #333;

    .logo {
      width: 24px;
      height: 24px;
      margin-right: 8px;

      &.clickable {
        cursor: pointer;
        transition: transform 0.2s;

        &:hover {
          transform: scale(1.1);
        }
      }
    }
  }

  .collapse-btn {
    padding: 4px;
  }

  .auto-expand-indicator {
    display: flex;
    align-items: center;
    margin-left: 8px;

    .indicator-icon {
      font-size: 12px;
      color: #67c23a;
      transition: color 0.3s ease;
    }

    &.disabled {
      .indicator-icon {
        color: #909399;
      }
    }
  }
}

.new-chat-container {
  padding: 16px 8px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  
  &.show-tutorial {
    z-index: 1000 !important;
    background: var(--color-background) !important;
    
    .new-chat-btn,
    .knowledge-base-btn,
    .favorites-btn,
    .tutorial-btn {
      background-color: var(--sidebar-btn-active-bg) !important;
      color: var(--sidebar-btn-active-color) !important;
      border-color: var(--sidebar-btn-active-bg) !important;
    }
  }

  &.vertical {
    flex-direction: column;
    align-items: center;
    padding-left: 0;
    padding-right: 0;

    .new-chat-btn,
    .knowledge-base-btn,
    .favorites-btn,
    .tutorial-btn {
      width: 40px;
      height: 40px;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      margin-bottom: 8px;
      flex: none;
      margin-left: 0;
      background-color: var(--sidebar-btn-bg);
      color: var(--sidebar-btn-color);
      border: 1px solid var(--sidebar-btn-border);
      transition: all 0.3s ease;
      box-shadow: var(--sidebar-btn-shadow);

      &:hover {
        background-color: var(--sidebar-btn-bg-hover);
        transform: scale(1.05);
        box-shadow: var(--sidebar-btn-shadow-hover);
      }
      
      &.active {
        background-color: var(--sidebar-btn-active-bg);
        color: var(--sidebar-btn-active-color);
        border-color: var(--sidebar-btn-active-bg);
        box-shadow: var(--sidebar-btn-shadow-hover);
        transform: scale(1.05);
      }

      .el-icon {
        font-size: 18px;
        margin: 0;
      }
    }
  }

      .new-chat-btn,
    .knowledge-base-btn,
    .favorites-btn,
    .tutorial-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 8px;
    background-color: var(--sidebar-btn-bg);
    color: var(--sidebar-btn-color);
    border: 1px solid var(--sidebar-btn-border);
    border-radius: 20px;
    padding: 10px 20px;
    font-weight: 500;
    font-size: 14px;
    transition: all 0.3s ease;
    box-shadow: var(--sidebar-btn-shadow);

    &:hover {
      background-color: var(--sidebar-btn-bg-hover);
      transform: translateY(-1px);
      box-shadow: var(--sidebar-btn-shadow-hover);
    }
    
    &.active {
      background-color: var(--sidebar-btn-active-bg);
      color: var(--sidebar-btn-active-color);
      border-color: var(--sidebar-btn-active-bg);
      box-shadow: var(--sidebar-btn-shadow-hover);
      transform: translateY(-1px);
    }
  }
}


.chat-history {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  height: 100%;
  min-height: 400px;
  
  &.show-tutorial {
    z-index: 1000 !important;
    background: var(--color-background) !important;
  }

  .time-group {
    margin-bottom: 16px;

    .time-label {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 16px;
      color: #666;
      font-size: 14px;
    }

    .chat-items {
      padding: 0 8px;

      .chat-item {
        padding: 10px 16px;
        margin: 4px 0;
        border-radius: 8px;
        cursor: pointer;
        font-size: 14px;
        color: #333;
        display: flex;
        align-items: center;
        justify-content: space-between;

        .chat-title {
          display: block;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          width: 100%;
        }

        .chat-actions {
          margin-left: 10px;
          flex-shrink: 0;
          opacity: 0;
          transition: opacity 0.2s ease;
          display: flex;

          .action-icon {
            font-size: 18px;
            color: #909399;
            cursor: pointer;
            padding: 4px;
            border-radius: 4px;

            &:hover {
              background-color: #dadada;
              color: #606266;
            }
          }
        }

        &:hover .chat-actions {
          opacity: 1;
        }

        &:hover {
          background-color: #f0f2f5;
        }

        &.active {
          background-color: #f0f2f5;
          font-weight: 500;
        }
      }
    }
  }
}

.user-info {
  display: flex;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid #e6e6e6;
  gap: 8px;

  .user-avatar-container {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    cursor: pointer;

    .el-icon {
      font-size: 12px;
      color: #666;
      margin-left: 4px;
    }
  }

  :deep(.el-dropdown) {
    outline: none !important;
  }
}
</style>

<style lang="scss">
/* 全局样式，不使用scoped，确保能影响tooltip */
.chat-tooltip {
  max-width: 600px !important;
  white-space: normal !important;
  word-break: break-word;
  line-height: 1.5;
}

/* 移除dropdown的焦点样式 */
.el-dropdown:focus-visible {
  outline: none !important;
}

.el-dropdown {
  outline: none !important;
}

.el-tooltip__trigger:focus-visible {
  outline: unset !important;
}

.el-tooltip__trigger:first-child:focus-visible {
  outline: unset !important;
}

.el-button+.el-button {
  margin-left: 0 !important;
}

/* 对话框样式 */
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
    color: #e6a23c;
    margin-bottom: 16px;
  }

  p {
    margin: 8px 0;
    color: #606266;

    &.chat-title-to-delete {
      font-weight: 500;
      color: #333;
      background-color: #f5f7fa;
      padding: 8px 12px;
      border-radius: 4px;
      margin: 12px 0;
    }
  }
}
</style>
