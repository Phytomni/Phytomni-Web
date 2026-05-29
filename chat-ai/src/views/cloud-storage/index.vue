<template>
  <div :class="['cloud-storage-container', themeClass]">
    <div class="cloud-storage-content">
      <h1>{{ $t('cloudStorage.title') }}</h1>
      <p>{{ $t('cloudStorage.description') }}</p>
      <el-button type="primary" @click="handleTryDemo">{{ $t('cloudStorage.tryDemo') }}</el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useThemeStore } from '@/stores/theme';

const themeStore = useThemeStore();

const themeClass = computed(() => `theme-${themeStore.currentTheme}`);

const handleTryDemo = () => {
  console.log('Opening demo for Cloud Drive');
};
</script>

<style lang="scss" scoped>
.cloud-storage-container {
  padding: 24px;
  background-color: var(--el-bg-color-page, #f5f7fa);
  min-height: 100vh;
}

.cloud-storage-content {
  max-width: 1200px;
  margin: 0 auto;
  text-align: center;

  h1 {
    color: var(--el-text-color-primary, #303133);
    margin-bottom: 16px;
    font-size: 28px;
    font-weight: 600;
  }

  p {
    color: var(--el-text-color-regular, #606266);
    margin-bottom: 24px;
    font-size: 16px;
    line-height: 1.6;
  }
}

.theme-dark .cloud-storage-container {
  background-color: var(--el-bg-color-page, #1a1a1a);
}

.theme-dark .cloud-storage-content h1 {
  color: var(--el-text-color-primary, #ffffff);
}

.theme-dark .cloud-storage-content p {
  color: var(--el-text-color-regular, rgba(235, 235, 235, 0.64));
}
</style>
