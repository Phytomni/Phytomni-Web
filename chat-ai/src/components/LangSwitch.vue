<!--
 * 组件注释
 * @Author: AI Assistant
 * @Date: 2024-06-17
 * @Description: 语言切换组件
 * 既往不恋！当下不杂！！未来不迎！！！
-->
<template>
  <div class="lang-switch">
    <el-dropdown @command="handleCommand" trigger="click">
      <span class="lang-dropdown-link">
        {{ currentLangLabel }}
        <el-icon class="el-icon--right">
          <arrow-down />
        </el-icon>
      </span>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item command="zh-CN" :disabled="currentLang === 'zh-CN'">
            中文
          </el-dropdown-item>
          <el-dropdown-item command="en-US" :disabled="currentLang === 'en-US'">
            English
          </el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue';
  import { ArrowDown } from '@element-plus/icons-vue';
  import { useI18n } from 'vue-i18n';
  import { setLanguage } from '@/locales';
  import { useAppStore } from '@/stores';

  const { locale } = useI18n();
  const appStore = useAppStore();

  // 获取当前语言
  const currentLang = computed(() => {
    return appStore.language;
  });

  // 显示的语言标签
  const currentLangLabel = computed(() => {
    return currentLang.value === 'zh-CN' ? '中文' : 'English';
  });

  // 切换语言
  const handleCommand = (command: string) => {
    setLanguage(command);
  };
</script>

<style lang="scss" scoped>
  .lang-switch {
    display: inline-flex;
    align-items: center;
    cursor: pointer;

    .lang-dropdown-link {
      display: flex;
      align-items: center;
      color: #606266;
      font-size: 14px;
      min-width: 50px;
      &:hover {
        color: #409eff;
      }
    }
  }
</style>
