<template>
  <el-config-provider :locale="epLocale">
    <div class="app-container">
      <RouterView />
      <TransferProgressList />
    </div>
  </el-config-provider>
</template>
<script setup lang="ts">
import { computed } from "vue";
import { RouterView } from "vue-router";
import en from "element-plus/es/locale/lang/en";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import TransferProgressList from "@/components/TransferProgressList.vue";
import { useAppStore } from "@/stores";

const appStore = useAppStore();

const epLocale = computed(() => (appStore.language === "zh-CN" ? zhCn : en));
</script>

<style lang="scss">
html,
body {
  margin: 0;
  padding: 0;
  height: 100%;
  overflow: hidden;
}

#app {
  height: 100%;
  overflow: hidden;
}

.app-container {
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
}
</style>
