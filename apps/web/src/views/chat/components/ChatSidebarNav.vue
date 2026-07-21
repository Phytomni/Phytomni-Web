<template>
  <div class="sidebar-nav" :class="{ collapsed }">
    <div class="sidebar-nav-top">
      <div class="sidebar-header">
        <div class="app-title">
          <button
            v-if="collapsed"
            type="button"
            class="logo-toggle"
            data-test="sidebar-nav-expand"
            :aria-label="$t('chat.expandNavigation')"
            @click="emit('toggle-collapse')"
          >
            <img
              src="../../../assets/images/chat/logo.png"
              class="logo"
              alt=""
            />
          </button>
          <img
            v-else
            src="../../../assets/images/chat/logo.png"
            class="logo"
            alt=""
          />
          <span
            v-if="!collapsed"
            class="app-title-label"
            :title="$t('chat.appTitle')"
          >
            {{ $t("chat.appTitle") }}</span
          >
        </div>
        <el-button
          v-if="!collapsed"
          data-test="sidebar-nav-collapse"
          type="text"
          class="collapse-btn"
          :aria-label="$t('chat.collapseNavigation')"
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
          :aria-current="activeItem === 'new-chat' ? 'page' : undefined"
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
          :aria-current="activeItem === 'explore-agent' ? 'page' : undefined"
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
          :aria-current="activeItem === 'knowledge-base' ? 'page' : undefined"
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
          :aria-current="activeItem === 'favorites' ? 'page' : undefined"
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
            :aria-hidden="identityAriaHidden ? 'true' : undefined"
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
              <span class="danger-label">{{ $t("user.logout") }}</span>
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>
  </div>
</template>

<script lang="ts">
export const CHAT_SIDEBAR_DRAWER_OPEN_KEY = Symbol("chatSidebarDrawerOpen");
</script>

<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, ref, type Ref } from "vue";
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
import { SIDEBAR_MOBILE_BREAKPOINT } from "@/views/chat/composables/useSidebarResponsive";

const props = withDefaults(
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
    offCanvas?: boolean;
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

const injectedDrawerOpen = inject<Ref<boolean>>(
  CHAT_SIDEBAR_DRAWER_OPEN_KEY,
  ref(true)
);
const isMobileViewport = ref(false);
let mobileQuery: MediaQueryList | null = null;

const syncMobileViewport = () => {
  isMobileViewport.value = mobileQuery?.matches ?? false;
};

onMounted(() => {
  if (typeof window === "undefined") {
    return;
  }

  mobileQuery = window.matchMedia(
    `(max-width: ${SIDEBAR_MOBILE_BREAKPOINT - 1}px)`
  );
  syncMobileViewport();
  mobileQuery.addEventListener("change", syncMobileViewport);
});

onUnmounted(() => {
  mobileQuery?.removeEventListener("change", syncMobileViewport);
});

const isOffCanvas = computed(() => {
  if (props.offCanvas !== undefined) {
    return props.offCanvas;
  }

  return isMobileViewport.value && !injectedDrawerOpen.value;
});

const identityAriaHidden = computed(() => props.collapsed || isOffCanvas.value);

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
  gap: var(--phy-space-8);
  height: calc(var(--phy-control-height-default) + var(--phy-space-16));
  padding: 0 var(--phy-space-12);

  .app-title {
    display: flex;
    flex: 1;
    align-items: center;
    min-width: 0;
    font-size: 20px;
    font-weight: 600;
    color: var(--phy-color-text);

    .logo-toggle {
      display: inline-flex;
      flex: 0 0 auto;
      align-items: center;
      justify-content: center;
      padding: 0;
      border: 0;
      background: transparent;
      cursor: pointer;

      &:focus-visible {
        outline: 2px solid var(--phy-color-focus);
        outline-offset: 2px;
        border-radius: var(--phy-radius-sm);
      }
    }

    .logo {
      width: 24px;
      height: 24px;
      flex: 0 0 auto;
      margin-right: var(--phy-space-8);
    }

    .app-title-label {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .collapse-btn {
    flex: 0 0 auto;
    width: var(--phy-control-height-default);
    height: var(--phy-control-height-default);
    padding: var(--phy-space-8);
    border-radius: var(--phy-radius-sm);
    color: var(--phy-color-text-secondary);

    &:hover {
      background: var(--phy-color-fill-subtle);
      color: var(--phy-color-text);
    }

    &:focus-visible {
      outline: 2px solid var(--phy-color-focus);
      outline-offset: 2px;
    }
  }
}

.sidebar-nav-primary,
.sidebar-nav-secondary,
.sidebar-nav-utility {
  display: flex;
  flex-direction: column;
  gap: var(--phy-space-4);
  padding: var(--phy-space-8);
}

.sidebar-nav-primary {
  padding-top: var(--phy-space-8);
  padding-bottom: var(--phy-space-4);
}

.sidebar-nav-secondary {
  padding-top: 0;
}

.sidebar-nav-utility {
  flex-shrink: 0;
  margin-top: auto;
  padding-top: var(--phy-space-8);
  border-top: 1px solid var(--phy-color-border-subtle);
}

.sidebar-nav-row {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: var(--phy-space-8);
  width: 100%;
  min-height: var(--phy-control-height-default);
  padding: var(--phy-space-8) var(--phy-space-12);
  border: 0;
  border-radius: var(--phy-radius-pill);
  background: transparent;
  color: var(--phy-color-text-secondary);
  font: inherit;
  font-size: 14px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  transition: background-color var(--phy-motion-fast) ease,
    color var(--phy-motion-fast) ease;

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

  &.is-active,
  &.is-active:hover {
    background-color: var(--phy-color-primary-soft);
    color: var(--phy-color-action-text);
  }
}

.sidebar-primary-action {
  min-height: var(--phy-control-height-default);
  font-weight: 600;
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
    width: var(--phy-control-height-default);
    height: var(--phy-control-height-default);
    min-height: var(--phy-control-height-default);
    padding: 0;
    margin: 0 auto;
    border-radius: var(--phy-radius-pill);
  }

  .sidebar-primary-action {
    width: var(--phy-control-height-default);
    height: var(--phy-control-height-default);
    min-height: var(--phy-control-height-default);
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
  max-height: 400px;
  margin-left: var(--phy-space-8);
  padding: var(--phy-space-4) 0 var(--phy-space-4) var(--phy-space-12);
  overflow-y: hidden;
  border: 1px solid var(--phy-color-border-subtle);
  border-radius: var(--phy-radius-md);
  background: var(--phy-color-bg-elevated);
  box-shadow: var(--phy-shadow-soft);
  z-index: 1000;
}

:deep(.agent-list) {
  display: flex;
  flex-direction: column;
  gap: var(--phy-space-8);
}

:deep(.agent-option) {
  display: flex;
  align-items: center;
  gap: var(--phy-space-8);
  padding: var(--phy-space-8) var(--phy-space-12);
  border-radius: var(--phy-radius-sm);
  cursor: pointer;
  transition: background-color var(--phy-motion-fast) ease;
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
  gap: var(--phy-space-4) var(--phy-space-8);
  padding: var(--phy-space-4) var(--phy-space-16) var(--phy-space-8);
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
  gap: var(--phy-space-4);
  margin-top: var(--phy-space-4);
  padding: var(--phy-space-8) var(--phy-space-12) 2px;
  border-top: 1px solid var(--phy-color-border-subtle);
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
  margin-top: var(--phy-space-8);
  padding: var(--phy-space-8) var(--phy-space-12) 2px;
  border-top: 1px solid var(--phy-color-border-subtle);
}

.user-info {
  display: flex;
  align-items: center;
  padding: var(--phy-space-8) var(--phy-space-12) var(--phy-space-12);
  gap: var(--phy-space-8);
  flex-shrink: 0;

  .user-avatar-container {
    display: flex;
    align-items: center;
    gap: var(--phy-space-8);
    width: 100%;
    min-width: 0;
    min-height: var(--phy-control-height-default);
    padding: var(--phy-space-4);
    border-radius: var(--phy-radius-md);
    cursor: pointer;

    &:hover {
      background: var(--phy-color-fill-subtle);
    }

    &:focus-visible {
      outline: 2px solid var(--phy-color-focus);
      outline-offset: 2px;
    }

    .el-icon {
      font-size: 12px;
      color: var(--phy-color-text-muted);
      margin-left: var(--phy-space-4);
    }
  }

  :deep(.el-dropdown) {
    width: 100%;
  }

  .username {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.help-menu {
  width: 100%;
}

.danger-label {
  color: var(--el-color-danger);
}

@media (max-width: 899px) {
  .sidebar-header {
    padding-inline-end: calc(
      var(--phy-control-height-default) + var(--phy-space-16)
    );
  }

  .sidebar-header .collapse-btn {
    display: none;
  }
}
</style>
