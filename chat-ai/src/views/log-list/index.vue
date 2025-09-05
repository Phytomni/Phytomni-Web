<!--
 * 组件注释
 * @Author: error: git config user.name & please set dead value or install git
 * @Date: 2025-04-28 17:54:52
 * @LastEditors: error: git config user.name & please set dead value or install git
 * @LastEditTime: 2025-05-09 17:23:44
 * @Description: 
 * 既往不恋！当下不杂！！未来不迎！！！
-->
<template>
  <div class="log-list">
    <h1>{{ $t('log.list') }}</h1>
  </div>
</template>
<script setup lang="ts">
  import { useI18n } from 'vue-i18n';

  const { t } = useI18n();
</script>
<style lang="scss" scoped></style>
