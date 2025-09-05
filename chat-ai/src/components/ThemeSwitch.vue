<!--
 * 组件注释
 * @Author: AI Assistant
 * @Date: 2024-12-19
 * @Description: 主题切换组件
 * 既往不恋！当下不杂！！未来不迎！！！
-->
<template>
  <div class="theme-switch">
    <el-dropdown @command="handleCommand" trigger="click">
      <span class="theme-dropdown-link">
        <el-icon class="theme-icon">
          <Sunny v-if="currentTheme === 'light'" />
          <Moon v-else-if="currentTheme === 'dark'" />
          <Monitor v-else />
        </el-icon>
        {{ themeStore.themeLabel }}
        <el-icon class="el-icon--right">
          <arrow-down />
        </el-icon>
      </span>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item command="light" :disabled="themeStore.theme === 'light'">
            <el-icon><Sunny /></el-icon>
            浅色主题
          </el-dropdown-item>
          <el-dropdown-item command="dark" :disabled="themeStore.theme === 'dark'">
            <el-icon><Moon /></el-icon>
            深色主题
          </el-dropdown-item>
          <el-dropdown-item command="system" :disabled="themeStore.theme === 'system'">
            <el-icon><Monitor /></el-icon>
            跟随系统
          </el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue';
  import { ArrowDown, Sunny, Moon, Monitor } from '@element-plus/icons-vue';
  import { useThemeStore, type ThemeType } from '@/stores';

  const themeStore = useThemeStore();

  // 获取当前实际应用的主题
  const currentTheme = computed(() => {
    return themeStore.currentTheme;
  });

  // 切换主题
  const handleCommand = (command: ThemeType) => {
    themeStore.setTheme(command);
  };
</script>

<style lang="scss" scoped>
  .theme-switch {
    display: inline-flex;
    align-items: center;
    cursor: pointer;

    .theme-dropdown-link {
      display: flex;
      align-items: center;
      color: var(--el-text-color-primary);
      font-size: 14px;
      min-width: 80px;
      padding: 8px 12px;
      border-radius: 4px;
      transition: all 0.3s ease;
      
      &:hover {
        color: var(--el-color-primary);
        background-color: var(--el-fill-color-light);
      }
    }

    .theme-icon {
      margin-right: 4px;
      font-size: 16px;
    }
  }

  :deep(.el-dropdown-menu__item) {
    display: flex;
    align-items: center;
    
    .el-icon {
      margin-right: 8px;
    }
  }
</style> 