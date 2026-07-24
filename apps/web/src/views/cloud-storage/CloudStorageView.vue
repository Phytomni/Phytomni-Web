<template>
  <PhyWorkspaceShell :class="['cloud-storage-workspace', themeClass]">
    <template #header>
      <PhyPageHeader :title="$t('cloudStorage.title')" />
    </template>

    <PhyEmptyState
      class="cloud-storage-content"
      :subtitle="$t('cloudStorage.description')"
    >
      <el-button type="primary" @click="handleTryDemo">{{
        $t("cloudStorage.tryDemo")
      }}</el-button>
    </PhyEmptyState>
  </PhyWorkspaceShell>
</template>

<script setup lang="ts">
import { computed } from "vue";
import {
  PhyEmptyState,
  PhyPageHeader,
  PhyWorkspaceShell,
} from "@/components/shell";
import { useThemeStore } from "@/stores/theme";

const themeStore = useThemeStore();
const themeClass = computed(() => `theme-${themeStore.currentTheme}`);

const handleTryDemo = () => {
  console.log("Opening demo for Cloud Drive");
};
</script>

<style lang="scss" scoped>
.cloud-storage-workspace {
  min-width: 0;
}

.cloud-storage-content {
  min-width: 0;
}
</style>
