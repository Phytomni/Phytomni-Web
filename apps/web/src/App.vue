<template>
  <el-config-provider :locale="epLocale">
    <div class="app-container">
      <RouterView />
      <Footer v-if="showFooter" class="app-footer" />
      <TransferProgressList />
    </div>
  </el-config-provider>
</template>
<script setup lang="ts">
import { computed } from "vue";
import { RouterView, useRoute } from "vue-router";
import en from "element-plus/es/locale/lang/en";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import Footer from "@/components/Footer.vue";
import TransferProgressList from "@/components/TransferProgressList.vue";
import { useAppStore } from "@/stores";

const route = useRoute();
const appStore = useAppStore();

const epLocale = computed(() =>
  appStore.language === "zh-CN" ? zhCn : en,
);

const AUTH_PATHS = new Set([
  "/login",
  "/register",
  "/forgot-password",
  "/change-password",
]);

const showFooter = computed(() => {
  if (route.meta?.layout !== "nolayout") return false;
  if (route.meta?.productLayout === "auth") return false;
  return (
    !new Set(["/chat", "/help", "/terms", "/privacy"]).has(route.path) &&
    !AUTH_PATHS.has(route.path)
  );
});
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

.app-footer {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 1000;
  background-color: #fff;
}

:global(.theme-dark) .app-footer {
  background-color: #1d1e1f;
}
</style>
