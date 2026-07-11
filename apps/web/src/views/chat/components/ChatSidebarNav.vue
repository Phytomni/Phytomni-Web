<template>
  <div class="sidebar-nav" :class="{ collapsed }">
    <div class="sidebar-nav-top">
      <div class="sidebar-header">
        <div class="app-title">
          <img
            src="../../../assets/images/chat/logo.png"
            class="logo"
            :class="{ clickable: collapsed }"
            alt="Logo"
            @click="collapsed && emit('toggle-collapse')"
          />
          <span v-if="!collapsed">{{ $t("chat.appTitle") }}</span>
        </div>
        <el-button
          v-if="!collapsed"
          data-test="sidebar-nav-collapse"
          type="text"
          class="collapse-btn"
          @click="emit('toggle-collapse')"
        >
          <el-icon>
            <Fold />
          </el-icon>
        </el-button>
      </div>

      <div class="new-chat-container" :class="{ vertical: collapsed }">
        <el-button
          data-test="sidebar-nav-new-chat"
          class="new-chat-btn"
          :class="{ active: activeItem === 'new-chat' }"
          @click="emit('new-chat')"
        >
          <el-icon>
            <Document />
          </el-icon>
          <span v-if="!collapsed">{{ $t("chat.newChat") }}</span>
        </el-button>

        <el-button
          v-if="canExploreAgents"
          data-test="sidebar-nav-explore-agent"
          class="explore-agent-btn"
          :class="{ active: activeItem === 'explore-agent' }"
          @click="emit('explore-agent')"
        >
          <el-icon>
            <Opportunity />
          </el-icon>
          <span v-if="!collapsed">{{ $t("chat.exploreAgent") }}</span>
        </el-button>
        <div v-if="showAgentsList" class="agents-dropdown">
          <slot name="explore-agents" />
        </div>

        <el-button
          data-test="sidebar-nav-gene-display"
          class="knowledge-base-btn"
          :class="{ active: activeItem === 'knowledge-base' }"
          @click="emit('gene-display')"
        >
          <el-icon>
            <Search />
          </el-icon>
          <span v-if="!collapsed">{{ $t("chat.deepGenome") }}</span>
        </el-button>

        <el-button
          data-test="sidebar-nav-favorites"
          class="favorites-btn"
          :class="{ active: activeItem === 'favorites' }"
          @click="emit('favorites')"
        >
          <el-icon>
            <Star />
          </el-icon>
          <span v-if="!collapsed">{{ $t("chat.favorites") }}</span>
        </el-button>

        <el-button
          data-test="sidebar-nav-tutorial"
          class="tutorial-btn"
          :class="{ active: activeItem === 'tutorial' }"
          @click="emit('tutorial')"
        >
          <el-icon>
            <QuestionFilled />
          </el-icon>
          <span v-if="!collapsed">{{ $t("tutorial.startTutorial") }}</span>
        </el-button>
      </div>
    </div>

    <div class="sidebar-nav-history">
      <slot name="history" />
    </div>

    <div class="user-info">
      <el-dropdown trigger="hover" @command="emit('account-command', $event)">
        <div class="user-avatar-container">
          <el-avatar :size="32" src="/avatars/user.svg" />
          <span v-if="!collapsed" class="username">
            {{ userName }}
          </span>
          <el-icon v-if="!collapsed">
            <ArrowDown />
          </el-icon>
        </div>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item
              v-if="canHistory"
              command="history"
              :icon="Document"
            >
              {{ $t("user.history") }}
            </el-dropdown-item>
            <el-dropdown-item v-if="canProfile" command="profile" :icon="User">
              {{ $t("user.profile") }}
            </el-dropdown-item>
            <el-dropdown-item
              v-if="canCloudStorage"
              command="cloudStorage"
              :icon="Folder"
            >
              {{ $t("user.cloudStorage") }}
            </el-dropdown-item>
            <el-dropdown-item
              v-if="canUserManagement"
              command="userManagement"
              :icon="User"
            >
              {{ $t("user.list") }}
            </el-dropdown-item>
            <el-dropdown-item
              v-if="canPermissionManagement"
              command="permissionManagement"
              :icon="Lock"
            >
              {{ $t("permission.title") }}
            </el-dropdown-item>
            <el-dropdown-item
              v-if="canSystemMonitor"
              command="systemMonitor"
              :icon="Monitor"
            >
              {{ $t("user.systemMonitor") }}
            </el-dropdown-item>
            <el-dropdown-item
              v-if="canGlobalConfig"
              command="globalConfig"
              :icon="Setting"
            >
              {{ $t("user.globalConfig") }}
            </el-dropdown-item>
            <el-dropdown-item
              v-if="canAdminManagement"
              command="adminManagement"
              :icon="User"
            >
              {{ $t("user.adminManagement") }}
            </el-dropdown-item>
            <el-dropdown-item command="feedback" :icon="ChatDotRound">
              {{ $t("user.feedback") }}
            </el-dropdown-item>
            <el-dropdown-item command="changePassword" :icon="Lock">
              {{ $t("user.changePassword") }}
            </el-dropdown-item>
            <el-dropdown-item command="logout" :icon="SwitchButton" divided>
              <span style="color: #f56c6c">{{ $t("user.logout") }}</span>
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  ArrowDown,
  ChatDotRound,
  Document,
  Fold,
  Folder,
  Lock,
  Monitor,
  Opportunity,
  QuestionFilled,
  Search,
  Setting,
  Star,
  SwitchButton,
  User,
} from "@element-plus/icons-vue";

withDefaults(
  defineProps<{
    collapsed: boolean;
    activeItem: string;
    userName: string;
    canExploreAgents: boolean;
    canHistory: boolean;
    canProfile: boolean;
    canCloudStorage: boolean;
    canUserManagement: boolean;
    canPermissionManagement: boolean;
    canSystemMonitor: boolean;
    canGlobalConfig: boolean;
    canAdminManagement: boolean;
    showAgentsList: boolean;
  }>(),
  {
    collapsed: false,
    activeItem: "",
    userName: "",
    canExploreAgents: false,
    canHistory: false,
    canProfile: false,
    canCloudStorage: false,
    canUserManagement: false,
    canPermissionManagement: false,
    canSystemMonitor: false,
    canGlobalConfig: false,
    canAdminManagement: false,
    showAgentsList: false,
  }
);

const emit = defineEmits<{
  (event: "new-chat"): void;
  (event: "gene-display"): void;
  (event: "favorites"): void;
  (event: "tutorial"): void;
  (event: "explore-agent"): void;
  (event: "account-command", command: string): void;
  (event: "toggle-collapse"): void;
}>();
</script>

<style lang="scss" scoped>
.sidebar-nav {
  width: 100%;
  min-height: 0;
  flex: 1;
  display: flex;
  flex-direction: column;

  &.collapsed {
    .new-chat-container {
      width: 40px;
      margin: 0 auto;
    }
  }
}

.sidebar-nav-top {
  flex-shrink: 0;
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  border-bottom: 1px solid var(--phy-color-border);
  height: 62px;

  .app-title {
    display: flex;
    align-items: center;
    font-size: 24px;
    font-weight: 700;
    color: var(--phy-color-text);

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
}

.new-chat-container {
  padding: 16px 8px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;

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
}

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

:deep(.agent-list) {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

:deep(.input-container-bottom-item) {
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

.sidebar-nav-history {
  flex: 1;
  min-height: 0;
  display: flex;

  :deep(.chat-history) {
    min-height: 0;
  }
}

.user-info {
  display: flex;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid var(--phy-color-border);
  gap: 8px;
  flex-shrink: 0;

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

@media (max-width: 768px) {
  .sidebar-nav.collapsed {
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
</style>
