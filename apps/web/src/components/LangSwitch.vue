<template>
  <div class="lang-switch">
    <el-dropdown @command="handleCommand" trigger="click">
      <button
        type="button"
        class="lang-dropdown-link"
        :aria-label="$t('common.languageSelector')"
      >
        <span class="lang-label-full">{{ currentLangLabel }}</span>
        <span class="lang-label-compact" aria-hidden="true">
          {{ currentLangCompactLabel }}
        </span>
        <el-icon class="el-icon--right">
          <arrow-down />
        </el-icon>
      </button>
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

const currentLangCompactLabel = computed(() => {
  return currentLang.value === "zh-CN" ? "中" : "EN";
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
    min-height: var(--phy-control-height-compact);
    gap: var(--phy-space-4);
    padding: var(--phy-space-4) var(--phy-space-8);
    border: 0;
    border-radius: var(--phy-radius-sm);
    background: transparent;
    color: var(--phy-color-text-secondary);
    cursor: pointer;
    font-family: inherit;
    font-size: 14px;

    &:hover {
      color: var(--phy-color-action-text-hover);
      background: var(--phy-color-fill-subtle);
    }

    &:focus-visible {
      outline: 2px solid var(--phy-color-focus);
      outline-offset: 2px;
    }
  }
}

.lang-label-compact {
  display: none;
}

@media (max-width: 599px) {
  .lang-label-full {
    display: none;
  }

  .lang-label-compact {
    display: inline;
  }

  .lang-dropdown-link .el-icon--right {
    display: none;
  }
}
</style>
