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
import { computed } from "vue";
import { ArrowDown } from "@element-plus/icons-vue";
import { setLanguage } from "@/locales";
import { useAppStore } from "@/stores";

const appStore = useAppStore();

// current language
const currentLang = computed(() => {
  return appStore.language;
});

// displayed language label
const currentLangLabel = computed(() => {
  return currentLang.value === "zh-CN" ? "中文" : "English";
});

// switch language (setLanguage also syncs document.title via chat.appTitle)
const handleCommand = async (command: string) => {
  await setLanguage(command as "zh-CN" | "en-US");
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
      color: var(--el-color-primary);
    }
  }
}
</style>
