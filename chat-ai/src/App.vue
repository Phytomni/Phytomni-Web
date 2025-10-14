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
  <RouterView />
</template>
<script setup lang="ts">
  import { RouterView } from 'vue-router';
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
</style>
