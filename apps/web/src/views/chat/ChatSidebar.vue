<template>
  <PhyAdaptiveSidebar
    :collapsed="renderedSidebarCollapsed"
    :drawer-open="drawerOpen"
    :off-canvas="isMobile && !drawerOpen"
    :close-label="$t('common.close')"
    @close="handleDrawerClose"
    @toggle="toggle"
  >
    <template #close>
      <el-icon aria-hidden="true">
        <Close />
      </el-icon>
    </template>
    <div class="sidebar" :class="{ collapsed: renderedSidebarCollapsed }">
      <ChatSidebarNav
        :collapsed="renderedSidebarCollapsed"
        :active-item="activeButton"
        :user-name="UserStore.name || $t('user.unnamedUser')"
        :can-explore-agents="true"
        :can-history="hasPermission('History')"
        :can-profile="hasPermission('Profile management')"
        :can-cloud-storage="hasPermission('Cloud storage')"
        :can-user-management="hasPermission('User management')"
        :can-permission-management="hasPermission('Role permission assignment')"
        :can-system-monitor="hasPermission('System monitor')"
        :can-global-config="hasPermission('Global config')"
        :can-admin-management="hasPermission('Admin management')"
        :can-help="UserStore.permission !== 'guest'"
        :show-agents-list="showAgentsList"
        @new-chat="handleButtonClick('new-chat', startNewChat)"
        @explore-agent="handleButtonClick('explore-agent', exploreAgent)"
        @gene-display="handleButtonClick('knowledge-base', openKnowledgeBase)"
        @favorites="handleButtonClick('favorites', openFavorites)"
        @tutorial="handleButtonClick('tutorial', startTutorial)"
        @help="handleButtonClick('help', openHelp)"
        @show-architecture="handleButtonClick('architecture', showArchitecture)"
        @account-command="handleAccountCommand"
        @toggle-collapse="toggle"
      >
        <template #explore-agents>
          <div class="agent-list">
            <div
              v-for="agent in presetAgents"
              :key="agent.id"
              class="agent-option"
              @click="handleAgentClick(agent)"
            >
              <AgentDisplayName :label="agent.name" />
            </div>
          </div>
        </template>
        <template #history>
          <ChatHistoryList
            :groups="chatHistoryGroups"
            :current-chat-id="currentChatId"
            :expanded-groups="expandedGroups"
            :collapsed="renderedSidebarCollapsed"
            @select="handleChatSelection"
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
import { computed, onMounted, onUnmounted, ref, toRef, watch } from "vue";
import { useRouter } from "vue-router";
import { Close, Warning } from "@element-plus/icons-vue";
import { userStore } from "@/stores";
import type { Chat } from "./types";
import { useChatHistoryGroups } from "./composables/useChatHistoryGroups";
import {
  SIDEBAR_COMPACT_BREAKPOINT,
  SIDEBAR_MOBILE_BREAKPOINT,
  useSidebarResponsive,
} from "./composables/useSidebarResponsive";
import { deriveCaseRouteOptions } from "@/constants/agents";
import { useChatHistoryActions } from "./composables/useChatHistoryActions";
import { useSidebarNavigation } from "./composables/useSidebarNavigation";
import ChatHistoryList, {
  type ChatHistoryGroup,
} from "./components/ChatHistoryList.vue";
import ChatSidebarNav from "./components/ChatSidebarNav.vue";
import AgentDisplayName from "@/components/AgentDisplayName.vue";
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
  effectiveCollapsed: {
    type: Boolean,
    default: undefined,
  },
  drawerOpen: {
    type: Boolean,
    default: false,
  },
});
const router = useRouter();
const UserStore = userStore();
const { todayChats, yesterdayChats, weekChats, olderChats } =
  useChatHistoryGroups(toRef(props, "chatList"));
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
  "drawerOpenChange",
  "chatRenamed",
  "chatDeleted",
  "chatFavorited",
  "startTutorial",
  "showArchitecture",
]);

const { isMobile, sidebarCollapsed, drawerOpen, toggle, closeDrawer } =
  useSidebarResponsive({
    collapsed: () => props.collapsed,
    drawerOpen: () => props.drawerOpen,
    onCollapseChange: (value) => emit("handleSidebarCollapse", value),
    onDrawerOpenChange: (value) => emit("drawerOpenChange", value),
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

const showAgentsList = ref(false);
const compactDisclosureExpanded = ref(false);
const presetAgents = ref(deriveCaseRouteOptions());

const isCompactDisclosureViewport = () =>
  typeof window !== "undefined" &&
  window.innerWidth >= SIDEBAR_MOBILE_BREAKPOINT &&
  window.innerWidth < SIDEBAR_COMPACT_BREAKPOINT;
let wasCompactDisclosureViewport = isCompactDisclosureViewport();

const renderedSidebarCollapsed = computed(() => {
  const base = props.effectiveCollapsed ?? sidebarCollapsed.value;
  const compactRail =
    !isMobile.value && sidebarCollapsed.value && isCompactDisclosureViewport();
  return base && !(compactRail && compactDisclosureExpanded.value);
});

const exploreAgent = () => {
  showAgentsList.value = !showAgentsList.value;
  compactDisclosureExpanded.value =
    showAgentsList.value && isCompactDisclosureViewport();
};

const closeAgentDisclosure = () => {
  showAgentsList.value = false;
  compactDisclosureExpanded.value = false;
};

const handleAgentClick = (agent: { route: string }) => {
  Promise.resolve(router.push(agent.route)).catch(() => undefined);
  closeAgentDisclosure();
};

const {
  handleCommand,
  hasPermission,
  startNewChat,
  openKnowledgeBase,
  openFavorites,
  startTutorial,
  selectChat,
} = useSidebarNavigation({
  router,
  userStore: UserStore,
  onStartNewChat: () => emit("startNewChat"),
  onStartTutorial: () => emit("startTutorial"),
  onSelectChat: (dialogueId) => emit("selectChat", dialogueId),
});

const openHelp = () => router.push("/help");
const showArchitecture = () => emit("showArchitecture");

const handleDrawerClose = () => {
  closeAgentDisclosure();
  closeDrawer();
};

const handleAccountCommand = (command: string) => {
  closeAgentDisclosure();
  handleCommand(command);
};

const handleChatSelection = (dialogueId: string) => {
  closeAgentDisclosure();
  selectChat(dialogueId);
};

// Currently active button
const activeButton = ref("");

// Handle button click
const handleButtonClick = (buttonType: string, action: () => void) => {
  activeButton.value = buttonType;
  if (buttonType !== "explore-agent") {
    closeAgentDisclosure();
  }
  action();
};

const handleDisclosureViewportChange = () => {
  const isCompactViewport = isCompactDisclosureViewport();
  if (isCompactViewport !== wasCompactDisclosureViewport) {
    closeAgentDisclosure();
  }
  wasCompactDisclosureViewport = isCompactViewport;
};

watch(isMobile, closeAgentDisclosure);
watch(drawerOpen, (isOpen) => {
  if (!isOpen) {
    closeAgentDisclosure();
  }
});

onMounted(() => {
  wasCompactDisclosureViewport = isCompactDisclosureViewport();
  window.addEventListener("resize", handleDisclosureViewportChange);
});

onUnmounted(() => {
  window.removeEventListener("resize", handleDisclosureViewportChange);
});

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
    color: var(--el-color-warning);
    margin-bottom: 16px;
  }

  p {
    margin: 8px 0;
    color: var(--phy-color-text-secondary);

    &.chat-title-to-delete {
      font-weight: 500;
      color: var(--phy-color-text);
      background-color: var(--phy-color-fill-subtle);
      padding: 8px 12px;
      border-radius: 4px;
      margin: 12px 0;
    }
  }
}
</style>
