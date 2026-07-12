<template>
  <div class="layout-container">
    <RouterView v-if="noLayoutRoute" />
    <template v-else>
      <el-container class="main-container">
        <el-header height="60px">
          <div class="logo">
            <el-button @click="handleBack" type="primary" size="small">{{
              $t("common.back")
            }}</el-button>
            <h1 class="logo-text">{{ $t("app.title") }}</h1>
          </div>
          <div class="header-right">
            <ThemeSwitch class="theme-switch-component" />
            <LangSwitch class="lang-switch-component" />
            <el-dropdown>
              <span class="user-info">
                <el-avatar :size="32" :icon="UserFilled" />
                <span class="username">{{ UserStore.name }}</span>
              </span>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item @click="$router.push('/chat')">{{
                    $t("chat.conversationTitle")
                  }}</el-dropdown-item>
                  <el-dropdown-item @click="$router.push('/change-password')">
                    {{ $t("user.changePassword") }}
                  </el-dropdown-item>
                  <el-dropdown-item divided @click="handleLogout">{{
                    $t("user.logout")
                  }}</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </el-header>
        <el-container class="content-container">
          <el-aside
            v-if="!hideSidebar"
            :width="isCollapse ? '64px' : '200px'"
            class="sidebar"
          >
            <el-menu
              :default-active="activeMenu"
              :router="true"
              :collapse="isCollapse"
              class="el-menu-vertical"
            >
              <el-menu-item index="/gene-display">
                <el-icon><Document /></el-icon>
                <span>{{ $t("menu.deepGenome") }}</span>
              </el-menu-item>
              <el-menu-item index="/favorites">
                <el-icon><Star /></el-icon>
                <span>{{ $t("menu.favorites") }}</span>
              </el-menu-item>
              <!-- History -->
              <el-menu-item v-if="hasPermission('History')" index="/history">
                <el-icon><Clock /></el-icon>
                <span>{{ $t("user.history") }}</span>
              </el-menu-item>
              <!-- Profile management -->
              <el-menu-item
                v-if="hasPermission('Profile management')"
                index="/profile"
              >
                <el-icon><User /></el-icon>
                <span>{{ $t("user.profile") }}</span>
              </el-menu-item>
              <!-- Cloud storage -->
              <el-menu-item
                v-if="hasPermission('Cloud storage')"
                index="/cloud-storage"
              >
                <el-icon><Folder /></el-icon>
                <span>{{ $t("user.cloudStorage") }}</span>
              </el-menu-item>
              <el-menu-item index="/feedback">
                <el-icon><ChatDotRound /></el-icon>
                <span>{{ $t("menu.feedback") }}</span>
              </el-menu-item>
              <el-menu-item index="/task-management">
                <el-icon><Document /></el-icon>
                <span>{{ $t("menu.taskManager") }}</span>
              </el-menu-item>
              <!-- User management -->
              <el-menu-item
                v-if="hasPermission('User management')"
                index="/user-list"
              >
                <el-icon><User /></el-icon>
                <span>{{ $t("menu.userList") }}</span>
              </el-menu-item>
              <!-- System monitoring -->
              <el-menu-item
                v-if="hasPermission('System monitor')"
                index="/log-list"
              >
                <el-icon><List /></el-icon>
                <span>{{ $t("menu.logList") }}</span>
              </el-menu-item>
              <!-- Role permission assignment -->
              <el-menu-item
                v-if="hasPermission('Role permission assignment')"
                index="/permi-manage"
              >
                <el-icon><Lock /></el-icon>
                <span>{{ $t("menu.permissionManage") }}</span>
              </el-menu-item>
              <!-- Global config -->
              <el-menu-item
                v-if="hasPermission('Global config')"
                index="/global-config"
              >
                <el-icon><Setting /></el-icon>
                <span>{{ $t("menu.globalConfig") }}</span>
              </el-menu-item>
              <!-- Admin management -->
              <el-menu-item
                v-if="hasPermission('Admin management')"
                index="/admin-management"
              >
                <el-icon><User /></el-icon>
                <span>{{ $t("menu.adminManagement") }}</span>
              </el-menu-item>
            </el-menu>
            <div class="collapse-btn" @click="toggleCollapse">
              <el-icon v-if="isCollapse"><Expand /></el-icon>
              <el-icon v-else><Fold /></el-icon>
            </div>
          </el-aside>
          <el-main class="main-content">
            <RouterView />
          </el-main>
        </el-container>
        <el-footer height="auto" class="layout-footer">
          <Footer />
        </el-footer>
      </el-container>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { RouterView, useRoute, useRouter } from "vue-router";
import {
  UserFilled,
  Document,
  User,
  List,
  Lock,
  Expand,
  Fold,
  Star,
  ChatDotRound,
  Folder,
  Clock,
  Setting,
} from "@element-plus/icons-vue";
import { userStore } from "@/stores";
import LangSwitch from "@/components/LangSwitch.vue";
import ThemeSwitch from "@/components/ThemeSwitch.vue";
import Footer from "@/components/Footer.vue";
const route = useRoute();
const router = useRouter();
const UserStore = userStore();
// the currently active menu item
const activeMenu = computed(() => {
  return route.path;
});

// whether this is a no-layout route
const noLayoutRoute = computed(() => {
  return route.meta.layout === "nolayout";
});

// whether to hide the sidebar
const hideSidebar = computed(() => {
  return route.meta.hideSidebar === true;
});

// sidebar collapse state
const isCollapse = ref(false);

// toggle the sidebar collapse state
const toggleCollapse = () => {
  isCollapse.value = !isCollapse.value;
};
// logout
const handleLogout = () => {
  const UserStore = userStore();
  UserStore.FedLogOut().finally(() => router.replace("/login"));
};
const handleBack = () => {
  router.push("/chat");
};

// permission check
const hasPermission = (permission: string) => {
  return UserStore.permission_list.includes(permission);
};
</script>

<style scoped lang="scss">
.layout-container {
  height: 100vh;
  height: 100dvh;
  width: 100%;
  max-width: 100%;
  overflow-x: hidden;
  overflow-y: auto;
}

.main-container {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.content-container {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.el-header {
  display: flex;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  flex-shrink: 0;
  align-items: center;
  gap: var(--phy-space-12);
  justify-content: space-between;
  padding: 0 var(--phy-space-20);
  border-bottom: 1px solid var(--phy-color-border-subtle);
  background-color: var(--phy-color-bg-elevated);
  z-index: var(--phy-z-sticky);

  .logo {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: var(--phy-space-16);

    .logo-text {
      min-width: 0;
      margin: 0;
      overflow: hidden;
      color: var(--phy-color-action-text);
      font-size: 20px;
      font-weight: 600;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .header-right {
    display: flex;
    min-width: 0;
    flex-shrink: 0;
    align-items: center;
    gap: var(--phy-space-8);

    .user-info {
      display: flex;
      align-items: center;
      min-height: var(--phy-control-height-compact);
      cursor: pointer;

      .username {
        margin-left: 8px;
        font-size: 14px;
      }
    }
  }
}

.sidebar {
  display: flex;
  flex-direction: column;
  background-color: #f9fbff;
  transition: width 0.3s;
  box-shadow: 2px 0 8px 0 rgba(29, 35, 41, 0.05);
  overflow: hidden;

  .el-menu-vertical {
    border-right: none;
    flex: 1;
    background-color: transparent;

    :deep(.el-menu-item.is-active) {
      background-color: var(--phy-color-primary-soft);
      color: var(--el-color-primary);
      font-weight: bold;

      &::before {
        content: "";
        position: absolute;
        left: 0;
        top: 0;
        bottom: 0;
        width: 4px;
        background-color: var(--el-color-primary);
      }
    }

    :deep(.el-menu-item:hover) {
      background-color: var(--phy-color-primary-soft);
    }
  }

  .collapse-btn {
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: #606266;
    background-color: #f9fbff;
    transition: all 0.3s;

    &:hover {
      background-color: #e6e8eb;
    }
  }
}

.main-content {
  padding: 0;
  overflow-y: auto !important;
  background-color: #fff;
  height: 100%;
}

.layout-footer {
  padding: 0;
  background-color: var(--phy-color-bg-elevated);
  border-top: 1px solid var(--phy-color-border-subtle);
}

@media (max-width: 599px) {
  .el-header {
    gap: var(--phy-space-4);
    padding: 0 var(--phy-space-12);

    .logo {
      flex: 1 1 auto;
      gap: var(--phy-space-8);

      .logo-text {
        max-width: 96px;
        font-size: 17px;
      }
    }

    .header-right {
      gap: var(--phy-space-4);

      .username {
        display: none;
      }
    }
  }
}
</style>
