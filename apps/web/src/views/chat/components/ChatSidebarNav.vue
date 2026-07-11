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

      <div class="sidebar-nav-primary">
        <button
          type="button"
          data-test="sidebar-nav-new-chat"
          data-testid="chat-primary-action"
          class="sidebar-nav-row sidebar-primary-action"
          :class="{ 'is-active': activeItem === 'new-chat' }"
          :aria-label="collapsed ? $t('chat.newChat') : undefined"
          @click="emit('new-chat')"
        >
          <el-icon>
            <Document />
          </el-icon>
          <span v-if="!collapsed" class="sidebar-nav-row-label">{{
            $t("chat.newChat")
          }}</span>
        </button>
      </div>

      <div class="sidebar-nav-secondary">
        <button
          v-if="canExploreAgents"
          type="button"
          data-test="sidebar-nav-explore-agent"
          class="sidebar-nav-row"
          :class="{ 'is-active': activeItem === 'explore-agent' }"
          :aria-label="collapsed ? $t('chat.exploreAgent') : undefined"
          @click="emit('explore-agent')"
        >
          <el-icon>
            <Opportunity />
          </el-icon>
          <span v-if="!collapsed" class="sidebar-nav-row-label">{{
            $t("chat.exploreAgent")
          }}</span>
        </button>
        <div v-if="showAgentsList" class="agents-dropdown">
          <slot name="explore-agents" />
        </div>

        <button
          type="button"
          data-test="sidebar-nav-gene-display"
          class="sidebar-nav-row"
          :class="{ 'is-active': activeItem === 'knowledge-base' }"
          :aria-label="collapsed ? $t('chat.deepGenome') : undefined"
          @click="emit('gene-display')"
        >
          <el-icon>
            <Search />
          </el-icon>
          <span v-if="!collapsed" class="sidebar-nav-row-label">{{
            $t("chat.deepGenome")
          }}</span>
        </button>

        <button
          type="button"
          data-test="sidebar-nav-favorites"
          class="sidebar-nav-row"
          :class="{ 'is-active': activeItem === 'favorites' }"
          :aria-label="collapsed ? $t('chat.favorites') : undefined"
          @click="emit('favorites')"
        >
          <el-icon>
            <Star />
          </el-icon>
          <span v-if="!collapsed" class="sidebar-nav-row-label">{{
            $t("chat.favorites")
          }}</span>
        </button>
      </div>
    </div>

    <div class="sidebar-nav-history">
      <slot name="history" />
    </div>

    <div class="sidebar-nav-utility">
      <el-dropdown
        class="help-menu"
        trigger="click"
        @command="handleHelpCommand"
      >
        <button
          type="button"
          data-test="sidebar-nav-tutorial"
          class="sidebar-nav-row sidebar-utility-row"
          :class="{ 'is-active': activeItem === 'tutorial' }"
          :aria-label="collapsed ? $t('help.title') : undefined"
        >
          <el-icon>
            <QuestionFilled />
          </el-icon>
          <span v-if="!collapsed" class="sidebar-nav-row-label">{{
            $t("help.title")
          }}</span>
        </button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item v-if="canHelp" command="help">
              {{ $t("help.title") }}
            </el-dropdown-item>
            <el-dropdown-item command="tutorial">
              {{ $t("tutorial.startTutorial") }}
            </el-dropdown-item>
            <el-dropdown-item v-if="canHelp" command="architecture">
              {{ $t("chat.agentsArchitectureTitle") }}
            </el-dropdown-item>
            <div class="help-legal-links" role="group">
              <a href="/terms">{{ $t("legal.termsTitle") }}</a>
              <a href="/privacy">{{ $t("legal.privacyTitle") }}</a>
              <a
                href="https://beian.miit.gov.cn/"
                target="_blank"
                rel="noopener noreferrer"
              >{{ $t("legal.icpFiling") }}</a
              >
            </div>
            <div class="help-preferences" role="group">
              <LangSwitch />
              <ThemeSwitch />
            </div>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

    <nav
      v-if="!collapsed"
      class="sidebar-legal"
      :aria-label="$t('legal.termsTitle')"
    >
      <a href="/terms">{{ $t("legal.termsTitle") }}</a>
      <a href="/privacy">{{ $t("legal.privacyTitle") }}</a>
      <a
        href="https://beian.miit.gov.cn/"
        target="_blank"
        rel="noopener noreferrer"
        >{{ $t("legal.icpFiling") }}</a
      >
    </nav>

    <div class="user-info">
      <el-dropdown
        data-test="sidebar-nav-account"
        trigger="hover"
        @command="emit('account-command', $event)"
      >
        <div class="user-avatar-container">
          <el-avatar :size="32" src="/avatars/user.svg" />
          <span
            class="username"
            data-testid="chat-account-identity"
            :aria-hidden="collapsed ? 'true' : undefined"
          >
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
import LangSwitch from "@/components/LangSwitch.vue";
import ThemeSwitch from "@/components/ThemeSwitch.vue";

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
    canHelp: boolean;
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
    canHelp: true,
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
  (event: "show-architecture"): void;
  (event: "help"): void;
}>();

const handleHelpCommand = (command: string | number | object) => {
  if (command === "help") {
    emit("help");
  } else if (command === "tutorial") {
    emit("tutorial");
  } else if (command === "architecture") {
    emit("show-architecture");
  }
};
</script>

<style lang="scss" scoped>
.sidebar-nav {
  width: 100%;
  min-height: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
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

.sidebar-nav-primary,
.sidebar-nav-secondary,
.sidebar-nav-utility {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px;
}

.sidebar-nav-primary {
  padding-top: 16px;
  padding-bottom: 4px;
}

.sidebar-nav-secondary {
  padding-top: 0;
}

.sidebar-nav-utility {
  flex-shrink: 0;
  margin-top: auto;
  padding-top: 8px;
  border-top: 1px solid var(--phy-color-border);
}

.sidebar-nav-row {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  width: 100%;
  min-height: var(--phy-control-height-default);
  padding: 8px 12px;
  border: 0;
  border-radius: var(--phy-radius-sm);
  background: transparent;
  color: var(--phy-color-text-secondary);
  font: inherit;
  font-size: 14px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  transition:
    background-color 0.2s ease,
    color 0.2s ease;

  .el-icon {
    flex-shrink: 0;
    font-size: 18px;
  }

  &:hover {
    background-color: var(--phy-color-fill-subtle);
    color: var(--phy-color-text);
  }

  &:focus-visible {
    outline: 2px solid var(--phy-color-focus);
    outline-offset: 2px;
  }

  &.is-active:not(.sidebar-primary-action) {
    background-color: var(--phy-color-accent-soft);
    color: var(--phy-color-accent-text);
  }
}

.sidebar-primary-action {
  justify-content: center;
  min-height: var(--phy-control-height-primary);
  border-radius: var(--phy-radius-pill);
  background-color: var(--phy-color-action-fill);
  color: var(--phy-color-on-action);

  &:hover {
    background-color: var(--phy-color-action-fill-hover);
    color: var(--phy-color-on-action);
  }

  &.is-active {
    background-color: var(--phy-color-action-fill-hover);
    color: var(--phy-color-on-action);
  }
}

.sidebar-utility-row {
  color: var(--phy-color-text-muted);
  font-weight: 400;
}

.sidebar-nav.collapsed {
  .sidebar-nav-primary,
  .sidebar-nav-secondary,
  .sidebar-nav-utility {
    align-items: center;
    padding-left: 0;
    padding-right: 0;
  }

  .sidebar-nav-row {
    justify-content: center;
    width: 40px;
    height: 40px;
    min-height: 40px;
    padding: 0;
    margin: 0 auto;
    border-radius: 50%;
  }

  .sidebar-primary-action {
    width: 40px;
    height: 40px;
    min-height: 40px;
  }

  .username {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
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
  transition: background-color 0.2s ease;
  background-color: var(--phy-color-fill-subtle);
  color: var(--phy-color-text-secondary);

  &:hover {
    background-color: var(--phy-color-accent-soft);
    color: var(--phy-color-accent-text);
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

.sidebar-legal {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  padding: 8px 16px 12px;
  border-top: 1px solid var(--phy-color-border);
  font-size: 11px;
  line-height: 1.4;

  a {
    color: var(--phy-color-text-muted);
    text-decoration: none;

    &:hover,
    &:focus-visible {
      color: var(--phy-color-action-text);
      text-decoration: underline;
    }
  }
}

.help-legal-links {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 4px;
  padding: 8px 12px 2px;
  border-top: 1px solid var(--phy-color-border);
  font-size: 12px;

  a {
    color: var(--phy-color-text-muted);
    text-decoration: none;

    &:hover,
    &:focus-visible {
      color: var(--phy-color-action-text);
      text-decoration: underline;
    }
  }
}

.help-preferences {
  display: flex;
  flex-wrap: wrap;
  gap: var(--phy-space-12);
  margin-top: 8px;
  padding: 8px 12px 2px;
  border-top: 1px solid var(--phy-color-border);
}

.user-info {
  display: flex;
  align-items: center;
  padding: 16px;
  border-top: 1px solid var(--phy-color-border);
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
      color: var(--phy-color-text-muted);
      margin-left: 4px;
    }
  }

  :deep(.el-dropdown) {
    outline: none !important;
  }
}

.help-menu {
  width: 100%;
}

@media (max-width: 768px) {
  .sidebar-nav.collapsed {
    .sidebar-nav-row {
      width: 30px;
      height: 30px;
      min-height: 30px;

      .el-icon {
        font-size: 16px;
      }
    }

    .sidebar-primary-action {
      width: 30px;
      height: 30px;
      min-height: 30px;
    }
  }
}
</style>
