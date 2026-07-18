<template>
  <div class="theme-switch">
    <el-dropdown @command="handleCommand" trigger="click">
      <button
        type="button"
        class="theme-dropdown-link"
        :aria-label="$t('common.themeSelector')"
      >
        <el-icon class="theme-icon">
          <Sunny v-if="currentTheme === 'light'" />
          <Moon v-else-if="currentTheme === 'dark'" />
          <Monitor v-else />
        </el-icon>
        <span class="theme-label">{{ currentThemeLabel }}</span>
        <el-icon class="el-icon--right">
          <arrow-down />
        </el-icon>
      </button>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item
            command="light"
            :disabled="themeStore.theme === 'light'"
          >
            <el-icon><Sunny /></el-icon>
            {{ $t("common.lightTheme") }}
          </el-dropdown-item>
          <el-dropdown-item
            command="dark"
            :disabled="themeStore.theme === 'dark'"
          >
            <el-icon><Moon /></el-icon>
            {{ $t("common.darkTheme") }}
          </el-dropdown-item>
          <el-dropdown-item
            command="system"
            :disabled="themeStore.theme === 'system'"
          >
            <el-icon><Monitor /></el-icon>
            {{ $t("common.followSystem") }}
          </el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { ArrowDown, Sunny, Moon, Monitor } from "@element-plus/icons-vue";
import { useThemeStore, type ThemeType } from "@/stores";

const themeStore = useThemeStore();
const { t } = useI18n();

// the theme currently applied
const currentTheme = computed(() => {
  return themeStore.currentTheme;
});

const currentThemeLabel = computed(() => {
  if (themeStore.theme === "light") return t("common.lightTheme");
  if (themeStore.theme === "dark") return t("common.darkTheme");
  return t("common.followSystem");
});

// switch theme
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
    transition: color var(--phy-motion-fast) var(--phy-motion-ease-out),
      background-color var(--phy-motion-fast) var(--phy-motion-ease-out);

    &:hover {
      color: var(--phy-color-action-text-hover);
      background-color: var(--phy-color-fill-subtle);
    }

    &:focus-visible {
      outline: 2px solid var(--phy-color-focus);
      outline-offset: 2px;
    }
  }

  .theme-icon {
    font-size: 16px;
  }
}

@media (max-width: 599px) {
  .theme-label,
  .theme-dropdown-link .el-icon--right {
    display: none;
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
