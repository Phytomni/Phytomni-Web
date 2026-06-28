<template>
  <div class="app-container">
    <RouterView />
    <Footer v-if="showFooter" class="app-footer" />
  </div>
</template>
<script setup lang="ts">
import { computed } from "vue";
import { RouterView, useRoute } from "vue-router";
import Footer from "@/components/Footer.vue";

const route = useRoute();

// Show the ICP footer on no-layout routes only;
// exclude the chat page, which has its own footer
const showFooter = computed(() => {
  if (route.meta?.layout === "nolayout" && route.path !== "/chat") {
    return true;
  }
  return false;
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
