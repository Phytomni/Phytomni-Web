<!--
 * 组件注释
 * @Author: wuq-l
 * @Date: 2022-08-18 21:07:25
 * @LastEditors: error: git config user.name & please set dead value or install git
 * @LastEditTime: 2025-05-09 16:46:41
 * @Description:
 * 人生无常！大肠包小肠......
-->
<template>
  <div class="app-container">
    <RouterView />
    <Footer v-if="showFooter" class="app-footer" />
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import { RouterView, useRoute } from 'vue-router';
import Footer from '@/components/Footer.vue';

const route = useRoute();

// 判断是否为无布局路由,如果是则显示备案信息
// 排除聊天页面,因为它有自己的 footer
const showFooter = computed(() => {
  if (route.meta?.layout === 'nolayout' && route.path !== '/chat') {
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
