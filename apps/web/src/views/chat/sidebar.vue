<template>
  <PhyAdaptiveSidebar :collapsed="sidebarCollapsed">
    <div class="sidebar" :class="{ collapsed: sidebarCollapsed }">
      <ChatSidebarNav
        :collapsed="sidebarCollapsed"
        :active-item="activeButton"
        :user-name="UserStore.name || $t('user.unnamedUser')"
        :can-explore-agents="UserStore.permission !== 'guest'"
        :can-history="hasPermission('History')"
        :can-profile="hasPermission('Profile management')"
        :can-cloud-storage="hasPermission('Cloud storage')"
        :can-user-management="hasPermission('User management')"
        :can-permission-management="hasPermission('Role permission assignment')"
        :can-system-monitor="hasPermission('System monitor')"
        :can-global-config="hasPermission('Global config')"
        :can-admin-management="hasPermission('Admin management')"
        :show-agents-list="showAgentsList"
        @new-chat="handleButtonClick('new-chat', startNewChat)"
        @explore-agent="handleButtonClick('explore-agent', exploreAgent)"
        @gene-display="handleButtonClick('knowledge-base', openKnowledgeBase)"
        @favorites="handleButtonClick('favorites', openFavorites)"
        @tutorial="handleButtonClick('tutorial', startTutorial)"
        @account-command="handleCommand"
        @toggle-collapse="toggleCollapse"
      >
        <template #explore-agents>
          <div class="agent-list">
            <div
              v-for="agent in presetAgents"
              :key="agent.id"
              class="input-container-bottom-item"
              @click="handleAgentClick(agent)"
            >
              <span>{{ agent.name }}</span>
            </div>
          </div>
        </template>
        <template #history>
          <ChatHistoryList
            :groups="chatHistoryGroups"
            :current-chat-id="currentChatId"
            :expanded-groups="expandedGroups"
            :collapsed="sidebarCollapsed"
            @select="selectChat"
            @toggle-group="toggleExpand"
            @action="handleChatAction"
          />
        </template>
      </ChatSidebarNav>

    <!-- Rename dialog -->
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
            {{ $t("common.cancel") }}
          </el-button>
          <el-button type="primary" @click="handleRenameConfirm">
            {{ $t("common.confirm") }}
          </el-button>
        </span>
      </template>
    </el-dialog>

    <!-- Delete confirmation dialog -->
    <el-dialog
      v-model="deleteDialogVisible"
      :title="$t('chat.actions.deleteConfirm')"
      width="400px"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
    >
      <div class="delete-confirm-content">
        <el-icon class="warning-icon">
          <Warning />
        </el-icon>
        <p>{{ $t("chat.actions.deleteWarning") }}</p>
        <p class="chat-title-to-delete">{{ chatToDelete?.title }}</p>
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
    </div>
  </PhyAdaptiveSidebar>
</template>

<script setup lang="ts">
import { computed, ref, toRef } from "vue";
import { useRouter } from "vue-router";
import { Warning } from "@element-plus/icons-vue";
import { userStore } from "@/stores";
import type { Chat } from "./types";
import { useChatHistoryGroups } from "./composables/useChatHistoryGroups";
import { useSidebarResponsive } from "./composables/useSidebarResponsive";
import { useSidebarAgents } from "./composables/useSidebarAgents";
import { useChatHistoryActions } from "./composables/useChatHistoryActions";
import { useSidebarNavigation } from "./composables/useSidebarNavigation";
import ChatHistoryList, {
  type ChatHistoryGroup,
} from "./components/ChatHistoryList.vue";
import ChatSidebarNav from "./components/ChatSidebarNav.vue";
import { PhyAdaptiveSidebar } from "@/components/shell";

// Define the received props
const props = defineProps({
  chatList: {
    type: Array as () => Chat[],
    required: true,
  },
  currentChatId: {
    type: String,
    default: "",
  },
  collapsed: {
    type: Boolean,
    default: false,
  },
});
const router = useRouter();
const UserStore = userStore();
const { todayChats, yesterdayChats, weekChats, olderChats } = useChatHistoryGroups(toRef(props, "chatList"));
const chatHistoryGroups = computed<ChatHistoryGroup[]>(() => [
  {
    key: "today",
    labelKey: "chat.timeGroup.today",
    items: todayChats.value,
  },
  {
    key: "yesterday",
    labelKey: "chat.timeGroup.yesterday",
    items: yesterdayChats.value,
  },
  {
    key: "week",
    labelKey: "chat.timeGroup.week",
    items: weekChats.value,
  },
  {
    key: "older",
    labelKey: "chat.timeGroup.older",
    items: olderChats.value,
  },
]);
// Define the events emitted to the parent component
const emit = defineEmits([
  "selectChat",
  "startNewChat",
  "openKnowledgeBase",
  "handleSidebarCollapse",
  "chatRenamed",
  "chatDeleted",
  "chatFavorited",
  "startTutorial",
]);

const { sidebarCollapsed, expandSidebar, collapseSidebar } = useSidebarResponsive({
  collapsed: () => props.collapsed,
  onCollapseChange: (value) => emit("handleSidebarCollapse", value),
});

const toggleCollapse = () => {
  if (sidebarCollapsed.value) {
    expandSidebar();
  } else {
    collapseSidebar();
  }
};

const {
  renameDialogVisible,
  renameForm,
  renameFormRef,
  renameRules,
  deleteDialogVisible,
  chatToDelete,
  handleChatAction,
  handleRenameConfirm,
  handleDeleteConfirm,
  handleRenameDialogClose,
} = useChatHistoryActions({
  chatList: () => props.chatList,
  currentChatId: () => props.currentChatId,
  onChatRenamed: (chat) => emit("chatRenamed", chat),
  onChatDeleted: (chat) => emit("chatDeleted", chat),
  onChatFavorited: (chat) => emit("chatFavorited", chat),
  onSelectChat: (id) => emit("selectChat", id),
});

const { showAgentsList, exploreAgent, presetAgents, handleAgentClick } = useSidebarAgents(router);

const { handleCommand, hasPermission, startNewChat, openKnowledgeBase, openFavorites, startTutorial, selectChat } = useSidebarNavigation({
  router,
  userStore: UserStore,
  onStartNewChat: () => emit("startNewChat"),
  onStartTutorial: () => emit("startTutorial"),
  onSelectChat: (dialogueId) => emit("selectChat", dialogueId),
});

// Currently active button
const activeButton = ref("");

// Handle button click
const handleButtonClick = (buttonType: string, action: () => void) => {
  activeButton.value = buttonType;
  if (buttonType !== "explore-agent") {
    showAgentsList.value = false;
  }
  action();
};

// Expand/collapse state for the 4 time groups
const expandedGroups = ref({
  today: true,
  yesterday: true,
  week: true,
  older: true,
});

// Toggle group expand/collapse
const toggleExpand = (group: keyof typeof expandedGroups.value) => {
  expandedGroups.value[group] = !expandedGroups.value[group];
};

</script>

<style lang="scss" scoped>
// Sidebar styles
.sidebar {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
</style>

<style lang="scss">
/* Global styles, not scoped, to make sure they can affect the tooltip */
.chat-tooltip {
  max-width: 600px !important;
  white-space: normal !important;
  word-break: break-word;
  line-height: 1.5;
}

/* Remove the dropdown focus styles */
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

.el-button + .el-button {
  margin-left: 0 !important;
}

/* Dialog styles */
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
