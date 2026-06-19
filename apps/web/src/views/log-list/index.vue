<!--
  操作日志查看页 — 占位中(功能延期,非已落地特性)。
  后端 /v1/operation/logs 现已收敛为仅管理员可读;此页待实现
  「管理员鉴权感知 + 分页 + 日期筛选」的审计日志查看 UI,在此之前保持占位。
-->
<template>
  <div class="log-list">
    <h1>{{ $t("log.list") }}</h1>
  </div>
</template>
<script setup lang="ts">
import { useI18n } from "vue-i18n";

const { t } = useI18n();
</script>
<style lang="scss" scoped></style>
