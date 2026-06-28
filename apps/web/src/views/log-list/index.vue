<!--
  Operation-log viewer page — placeholder (feature deferred, not a shipped feature).
  The backend /api/v1/operation-logs is now restricted to admin-only reads; this page
  awaits an audit-log viewer UI with "admin-auth awareness + pagination + date filtering".
  It stays a placeholder until then.
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
