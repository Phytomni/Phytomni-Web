<template>
  <div class="sidebar" :class="{ collapsed: sidebarCollapsed }">
    <!-- Top title bar -->
    <div class="sidebar-header">
      <div class="app-title">
        <img
          src="../../assets/images/chat/logo.png"
          class="logo"
          alt="Logo"
          @click="expandSidebar"
          :class="{ clickable: sidebarCollapsed }"
        />
        <span v-if="!sidebarCollapsed">{{ $t("chat.appTitle") }}</span>
      </div>
      <el-button
        v-if="!sidebarCollapsed"
        type="text"
        class="collapse-btn"
        @click="collapseSidebar"
      >
        <el-icon>
          <Fold />
        </el-icon>
      </el-button>
    </div>
    <!-- New chat and knowledge base buttons -->
    <div
      class="new-chat-container"
      :class="{
        vertical: sidebarCollapsed,
        'show-tutorial': showTutorial,
      }"
    >
      <el-button
        class="new-chat-btn"
        :class="{ active: activeButton === 'new-chat' }"
        @click="handleButtonClick('new-chat', startNewChat)"
      >
        <el-icon>
          <Document />
        </el-icon>
        <span v-if="!sidebarCollapsed">{{ $t("chat.newChat") }}</span>
      </el-button>
      <el-button
        class="explore-agent-btn"
        v-if="UserStore.permission !== 'guest'"
        :class="{ active: activeButton === 'exploreAgent' }"
        @click="handleButtonClick('explore-agent', exploreAgent)"
      >
        <el-icon>
          <Opportunity />
        </el-icon>
        <span v-if="!sidebarCollapsed">{{ $t("chat.exploreAgent") }}</span>
      </el-button>
      <!-- Agents quick-access dropdown -->
      <div v-if="showAgentsList" class="agents-dropdown">
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
      </div>
      <el-button
        class="knowledge-base-btn"
        :class="{ active: activeButton === 'knowledge-base' }"
        @click="handleButtonClick('knowledge-base', openKnowledgeBase)"
      >
        <el-icon>
          <Search />
        </el-icon>
        <span v-if="!sidebarCollapsed">{{ $t("chat.geneDetail") }}</span>
      </el-button>
      <el-button
        class="favorites-btn"
        :class="{ active: activeButton === 'favorites' }"
        @click="handleButtonClick('favorites', openFavorites)"
      >
        <el-icon>
          <Star />
        </el-icon>
        <span v-if="!sidebarCollapsed">{{ $t("chat.favorites") }}</span>
      </el-button>
      <el-button
        class="tutorial-btn"
        :class="{ active: activeButton === 'tutorial' }"
        @click="handleButtonClick('tutorial', startTutorial)"
      >
        <el-icon>
          <QuestionFilled />
        </el-icon>
        <span v-if="!sidebarCollapsed">{{ $t("tutorial.startTutorial") }}</span>
      </el-button>
    </div>

    <!-- Chat history list, grouped by time -->
    <div class="chat-history" :class="{ 'show-tutorial': showTutorial }">
      <template v-if="!sidebarCollapsed">
        <!-- Today -->
        <div class="time-group" v-if="todayChats.length">
          <div class="time-label" @click="toggleExpand('today')">
            <span>{{ $t("chat.timeGroup.today") }}</span>
            <el-icon
              class="expand-icon"
              :class="{ expanded: expandedGroups.today }"
            >
              <ArrowDown />
            </el-icon>
          </div>
          <div class="chat-items" v-show="expandedGroups.today">
            <el-tooltip
              v-for="chat in todayChats"
              :key="chat.id"
              :content="chat.title"
              placement="right"
              :show-after="1000"
              popper-class="chat-tooltip"
            >
              <div
                class="chat-item"
                :class="{ active: currentChatId === chat.dialogue_id }"
                @click="selectChat(chat.dialogue_id)"
              >
                <span class="chat-title">{{ chat.title }}</span>
                <!-- Action icons -->
                <div class="chat-actions" @click.stop>
                  <el-dropdown
                    trigger="click"
                    @command="(command) => handleChatAction(command, chat)"
                  >
                    <el-icon class="action-icon">
                      <MoreFilled />
                    </el-icon>
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item command="rename" :icon="Edit">
                          {{ $t("chat.actions.rename") }}
                        </el-dropdown-item>
                        <el-dropdown-item command="favorite" :icon="Star">
                          {{
                            chat.isFavorite
                              ? $t("chat.actions.unfavorite")
                              : $t("chat.actions.favorite")
                          }}
                        </el-dropdown-item>
                        <el-dropdown-item
                          command="delete"
                          :icon="Delete"
                          divided
                        >
                          <span style="color: #f56c6c">{{
                            $t("chat.actions.delete")
                          }}</span>
                        </el-dropdown-item>
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                </div>
              </div>
            </el-tooltip>
          </div>
        </div>

        <!-- Yesterday -->
        <div class="time-group" v-if="yesterdayChats.length">
          <div class="time-label" @click="toggleExpand('yesterday')">
            <span>{{ $t("chat.timeGroup.yesterday") }}</span>
            <el-icon
              class="expand-icon"
              :class="{ expanded: expandedGroups.yesterday }"
            >
              <ArrowDown />
            </el-icon>
          </div>
          <div class="chat-items" v-show="expandedGroups.yesterday">
            <el-tooltip
              v-for="chat in yesterdayChats"
              :key="chat.id"
              :content="chat.title"
              placement="right"
              :show-after="1000"
              popper-class="chat-tooltip"
            >
              <div
                class="chat-item"
                :class="{ active: currentChatId === chat.dialogue_id }"
                @click="selectChat(chat.dialogue_id)"
              >
                <span class="chat-title">{{ chat.title }}</span>
                <!-- Action icons -->
                <div class="chat-actions" @click.stop>
                  <el-dropdown
                    trigger="click"
                    @command="(command) => handleChatAction(command, chat)"
                  >
                    <el-icon class="action-icon">
                      <MoreFilled />
                    </el-icon>
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item command="rename" :icon="Edit">
                          {{ $t("chat.actions.rename") }}
                        </el-dropdown-item>
                        <el-dropdown-item command="favorite" :icon="Star">
                          {{
                            chat.isFavorite
                              ? $t("chat.actions.unfavorite")
                              : $t("chat.actions.favorite")
                          }}
                        </el-dropdown-item>
                        <el-dropdown-item
                          command="delete"
                          :icon="Delete"
                          divided
                        >
                          <span style="color: #f56c6c">{{
                            $t("chat.actions.delete")
                          }}</span>
                        </el-dropdown-item>
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                </div>
              </div>
            </el-tooltip>
          </div>
        </div>

        <!-- Within 7 days -->
        <div class="time-group" v-if="weekChats.length">
          <div class="time-label" @click="toggleExpand('week')">
            <span>{{ $t("chat.timeGroup.week") }}</span>
            <el-icon
              class="expand-icon"
              :class="{ expanded: expandedGroups.week }"
            >
              <ArrowDown />
            </el-icon>
          </div>
          <div class="chat-items" v-show="expandedGroups.week">
            <el-tooltip
              v-for="chat in weekChats"
              :key="chat.id"
              :content="chat.title"
              placement="right"
              :show-after="1000"
              popper-class="chat-tooltip"
            >
              <div
                class="chat-item"
                :class="{ active: currentChatId === chat.dialogue_id }"
                @click="selectChat(chat.dialogue_id)"
              >
                <span class="chat-title">{{ chat.title }}</span>
                <!-- Action icons -->
                <div class="chat-actions" @click.stop>
                  <el-dropdown
                    trigger="click"
                    @command="(command) => handleChatAction(command, chat)"
                  >
                    <el-icon class="action-icon">
                      <MoreFilled />
                    </el-icon>
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item command="rename" :icon="Edit">
                          {{ $t("chat.actions.rename") }}
                        </el-dropdown-item>
                        <el-dropdown-item command="favorite" :icon="Star">
                          {{
                            chat.isFavorite
                              ? $t("chat.actions.unfavorite")
                              : $t("chat.actions.favorite")
                          }}
                        </el-dropdown-item>
                        <el-dropdown-item
                          command="delete"
                          :icon="Delete"
                          divided
                        >
                          <span style="color: #f56c6c">{{
                            $t("chat.actions.delete")
                          }}</span>
                        </el-dropdown-item>
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                </div>
              </div>
            </el-tooltip>
          </div>
        </div>

        <!-- More than a week ago -->
        <div class="time-group" v-if="olderChats.length">
          <div class="time-label" @click="toggleExpand('older')">
            <span>{{ $t("chat.timeGroup.older") }}</span>
            <el-icon
              class="expand-icon"
              :class="{ expanded: expandedGroups.older }"
            >
              <ArrowDown />
            </el-icon>
          </div>
          <div class="chat-items" v-show="expandedGroups.older">
            <el-tooltip
              v-for="chat in olderChats"
              :key="chat.id"
              :content="chat.title"
              placement="right"
              :show-after="1000"
              popper-class="chat-tooltip"
            >
              <div
                class="chat-item"
                :class="{ active: currentChatId === chat.dialogue_id }"
                @click="selectChat(chat.dialogue_id)"
              >
                <span class="chat-title">{{ chat.title }}</span>
                <!-- Action icons -->
                <div class="chat-actions" @click.stop>
                  <el-dropdown
                    trigger="click"
                    @command="(command) => handleChatAction(command, chat)"
                  >
                    <el-icon class="action-icon">
                      <MoreFilled />
                    </el-icon>
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item command="rename" :icon="Edit">
                          {{ $t("chat.actions.rename") }}
                        </el-dropdown-item>
                        <el-dropdown-item command="favorite" :icon="Star">
                          {{
                            chat.isFavorite
                              ? $t("chat.actions.unfavorite")
                              : $t("chat.actions.favorite")
                          }}
                        </el-dropdown-item>
                        <el-dropdown-item
                          command="delete"
                          :icon="Delete"
                          divided
                        >
                          <span style="color: #f56c6c">{{
                            $t("chat.actions.delete")
                          }}</span>
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

    <!-- User info -->
    <div class="user-info">
      <el-dropdown trigger="hover" @command="handleCommand">
        <div class="user-avatar-container">
          <el-avatar
            :size="32"
            src="/avatars/user.svg"
          />
          <span v-if="!sidebarCollapsed" class="username">
            {{ UserStore.name || $t("user.unnamedUser") }}
          </span>
          <el-icon v-if="!sidebarCollapsed">
            <ArrowDown />
          </el-icon>
        </div>
        <template #dropdown>
          <el-dropdown-menu>
            <!-- History -->
            <el-dropdown-item
              v-if="hasPermission('History')"
              command="history"
              :icon="Document"
            >
              {{ $t("user.history") }}
            </el-dropdown-item>
            <!-- Profile management -->
            <el-dropdown-item
              v-if="hasPermission('Profile management')"
              command="profile"
              :icon="User"
            >
              {{ $t("user.profile") }}
            </el-dropdown-item>
            <!-- Cloud storage -->
            <el-dropdown-item
              v-if="hasPermission('Cloud storage')"
              command="cloudStorage"
              :icon="Folder"
            >
              {{ $t("user.cloudStorage") }}
            </el-dropdown-item>
            <!-- User management -->
            <el-dropdown-item
              v-if="hasPermission('User management')"
              command="userManagement"
              :icon="User"
            >
              {{ $t("user.list") }}
            </el-dropdown-item>
            <!-- Role permission assignment -->
            <el-dropdown-item
              v-if="hasPermission('Role permission assignment')"
              command="permissionManagement"
              :icon="Lock"
            >
              {{ $t("permission.title") }}
            </el-dropdown-item>
            <!-- System monitoring -->
            <el-dropdown-item
              v-if="hasPermission('System monitor')"
              command="systemMonitor"
              :icon="Monitor"
            >
              {{ $t("user.systemMonitor") }}
            </el-dropdown-item>
            <!-- Global policy configuration -->
            <el-dropdown-item
              v-if="hasPermission('Global config')"
              command="globalConfig"
              :icon="Setting"
            >
              {{ $t("user.globalConfig") }}
            </el-dropdown-item>
            <!-- Admin management -->
            <el-dropdown-item
              v-if="hasPermission('Admin management')"
              command="adminManagement"
              :icon="User"
            >
              {{ $t("user.adminManagement") }}
            </el-dropdown-item>
            <!-- User feedback -->
            <el-dropdown-item command="feedback" :icon="ChatDotRound">
              {{ $t("user.feedback") }}
            </el-dropdown-item>
            <!-- Change password -->
            <el-dropdown-item command="changePassword" :icon="Lock">
              {{ $t("user.changePassword") }}
            </el-dropdown-item>
            <!-- Logout -->
            <el-dropdown-item command="logout" :icon="SwitchButton" divided>
              <span style="color: #f56c6c">{{ $t("user.logout") }}</span>
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

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
</template>

<script setup lang="ts">
import { ref, toRef } from "vue";
import { useRouter } from "vue-router";
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
  Opportunity,
} from "@element-plus/icons-vue";
import { userStore } from "@/stores";
import type { Chat } from "./types";
import { useChatHistoryGroups } from "./composables/useChatHistoryGroups";
import { useSidebarResponsive } from "./composables/useSidebarResponsive";
import { useSidebarAgents } from "./composables/useSidebarAgents";
import { useChatHistoryActions } from "./composables/useChatHistoryActions";
import { useSidebarNavigation } from "./composables/useSidebarNavigation";

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
  showTutorial: {
    type: Boolean,
    default: false,
  },
});
const router = useRouter();
const UserStore = userStore();
const { todayChats, yesterdayChats, weekChats, olderChats } = useChatHistoryGroups(toRef(props, "chatList"));
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

// Responsive styles
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

    // Ensure the sidebar displays correctly on large screens
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
        .tutorial-btn,
        .explore-agent-btn {
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
    .tutorial-btn,
    .explore-agent-btn {
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
    .tutorial-btn,
    .explore-agent-btn {
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
  .tutorial-btn,
  .explore-agent-btn {
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

  /* Agents quick-access dropdown styles */
  .agents-dropdown {
    margin-left: 8px;
    background: transparent;
    border-radius: 8px;
    padding: 0 0 0 12px;
    box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.1);
    z-index: 1000;
    max-height: 400px;
    overflow-y: hidden;
  }

  .agent-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .input-container-bottom-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    border-radius: 20px;
    cursor: pointer;
    transition: all 0.3s ease;
    background-color: var(--sidebar-btn-bg);
    color: var(--sidebar-btn-color);

    &:hover {
      background-color: var(--sidebar-btn-bg-hover);
      border-color: var(--sidebar-btn-bg-hover);
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
      cursor: pointer;
      user-select: none;

      .expand-icon {
        transition: transform 0.2s ease;

        &.expanded {
          transform: rotate(180deg);
        }
      }
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
