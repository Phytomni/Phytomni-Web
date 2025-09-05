/* * 组件注释 * @Author: error: git config user.name & please set dead value or
install git * @Date: 2025-05-09 16:38:25 * @LastEditors: error: git config
user.name & please set dead value or install git * @LastEditTime: 2025-05-09
17:00:32 * @Description: * 既往不恋！当下不杂！！未来不迎！！！ */
<template>
  <div class="layout-container">
    <RouterView v-if="noLayoutRoute" />
    <template v-else>
      <el-container class="main-container">
        <el-header height="60px">
          <div class="logo">
            <el-button @click="handleBack" type="primary" size="small">{{ $t('common.back') }}</el-button>
            <div style="width: 40px; height: 40px" class="logo-img"></div>
            <!-- <img src="@/assets/logo.svg" alt="Logo" class="logo-img" /> -->
            <h1 class="logo-text">{{ $t('app.title') }}</h1>
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
                    $t('chat.title')
                  }}</el-dropdown-item>
                  <el-dropdown-item @click="$router.push('/change-password')">
                    {{ $t('user.changePassword') }}
                  </el-dropdown-item>
                  <el-dropdown-item divided @click="handleLogout">{{
                    $t('user.logout')
                  }}</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </el-header>
        <el-container class="content-container">
          <el-aside :width="isCollapse ? '64px' : '200px'" class="sidebar">
            <el-menu
              :default-active="activeMenu"
              :router="true"
              :collapse="isCollapse"
              class="el-menu-vertical">
              <el-menu-item index="/gene-display">
                <el-icon><Document /></el-icon>
                <span>{{ $t('menu.geneDisplay') }}</span>
              </el-menu-item>
              <el-menu-item index="/favorites">
                <el-icon><Star /></el-icon>
                <span>{{ $t('menu.favorites') }}</span>
              </el-menu-item>
              <!-- 历史记录 -->
              <el-menu-item v-if="hasPermission('历史记录')" index="/history">
                <el-icon><Clock /></el-icon>
                <span>{{ $t('user.history') }}</span>
              </el-menu-item>
              <!-- 个人资料管理 -->
              <el-menu-item v-if="hasPermission('个人资料管理')" index="/profile">
                <el-icon><User /></el-icon>
                <span>{{ $t('user.profile') }}</span>
              </el-menu-item>
              <!-- 网盘空间 -->
              <el-menu-item v-if="hasPermission('网盘空间')" index="/cloud-storage">
                <el-icon><Folder /></el-icon>
                <span>{{ $t('user.cloudStorage') }}</span>
              </el-menu-item>
              <el-menu-item index="/feedback">
                <el-icon><ChatDotRound /></el-icon>
                <span>{{ $t('menu.feedback') }}</span>
              </el-menu-item>
              <el-menu-item index="/task-management">
                <el-icon><Document /></el-icon>
                <span>{{ $t('menu.taskManager') }}</span>
              </el-menu-item>
              <!-- 用户管理 -->
              <el-menu-item v-if="hasPermission('用户管理')" index="/user-list">
                <el-icon><User /></el-icon>
                <span>{{ $t('menu.userList') }}</span>
              </el-menu-item>
              <!-- 系统监控 -->
              <el-menu-item v-if="hasPermission('系统监控')" index="/log-list">
                <el-icon><List /></el-icon>
                <span>{{ $t('menu.logList') }}</span>
              </el-menu-item>
              <!-- 角色权限分配 -->
              <el-menu-item v-if="hasPermission('角色权限分配')" index="/permi-manage">
                <el-icon><Lock /></el-icon>
                <span>{{ $t('menu.permissionManage') }}</span>
              </el-menu-item>
              <!-- 全局策略配置 -->
              <el-menu-item v-if="hasPermission('全局策略配置')" index="/global-config">
                <el-icon><Setting /></el-icon>
                <span>{{ $t('menu.globalConfig') }}</span>
              </el-menu-item>
              <!-- 管理员管理 -->
              <el-menu-item v-if="hasPermission('管理员管理')" index="/admin-management">
                <el-icon><User /></el-icon>
                <span>{{ $t('menu.adminManagement') }}</span>
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
      </el-container>
    </template>
  </div>
</template>

<script setup lang="ts">
  import { ref, computed } from 'vue';
  import { RouterView, useRoute, useRouter } from 'vue-router';
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
  } from '@element-plus/icons-vue';
  import { userStore } from '@/stores';
  import LangSwitch from '@/components/LangSwitch.vue';
  import ThemeSwitch from '@/components/ThemeSwitch.vue';
  import { useI18n } from 'vue-i18n';

  const { t } = useI18n();
  const route = useRoute();
  const router = useRouter();
  const UserStore = userStore();
  // 当前激活的菜单项
  const activeMenu = computed(() => {
    return route.path;
  });

  // 判断是否是无布局路由
  const noLayoutRoute = computed(() => {
    return route.meta.layout === 'nolayout';
  });

  // 侧边栏折叠状态
  const isCollapse = ref(false);

  // 切换侧边栏折叠状态
  const toggleCollapse = () => {
    isCollapse.value = !isCollapse.value;
  };
  // 登出
  const handleLogout = () => {
    const UserStore = userStore();
    UserStore.FedLogOut().then(() => router.replace('/login'));
  };
  const handleBack = () => {
    router.push('/chat');
  };

  // 权限检查方法
  const hasPermission = (permission: string) => {
    return UserStore.permission_list.includes(permission);
  };
</script>

<style scoped lang="scss">
  .layout-container {
    height: 100vh;
    width: 100%;
    // overflow: hidden;
    overflow-y: auto;
  }

  .main-container {
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  .content-container {
    flex: 1;
    overflow: hidden;
  }

  .el-header {
    background-color: #fff;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 20px;
    box-shadow: 0 1px 4px rgba(0, 21, 41, 0.08);
    z-index: 10;

    .logo {
      display: flex;
      align-items: center;

      .logo-img {
        height: 40px;
        margin-right: 10px;
      }

      .logo-text {
        font-size: 20px;
        font-weight: 600;
        color: #409eff;
        margin: 0;
      }
    }

    .header-right {
      .user-info {
        display: flex;
        align-items: center;
        cursor: pointer;

        .username {
          margin-left: 8px;
          font-size: 14px;
        }
      }

      display: flex;
      align-items: center;

      .theme-switch-component {
        margin-right: 20px;
      }
      
      .lang-switch-component {
        margin-right: 20px;
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
        background-color: #e6f1ff;
        color: #1890ff;
        font-weight: bold;

        &::before {
          content: '';
          position: absolute;
          left: 0;
          top: 0;
          bottom: 0;
          width: 4px;
          background-color: #1890ff;
        }
      }

      :deep(.el-menu-item:hover) {
        background-color: #e8f4ff;
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
</style>
