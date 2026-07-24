<!--
  Operation-log viewer page — placeholder (feature deferred, not a shipped feature).
  The backend /api/v1/operation-logs is now restricted to admin-only reads; this page
  awaits an audit-log viewer UI with "admin-auth awareness + pagination + date filtering".
  It stays a placeholder until then.
-->
<template>
  <PhyWorkspaceShell class="log-list-workspace" data-scroll-root="workspace">
    <h1>{{ $t("log.list") }}</h1>
  </PhyWorkspaceShell>
</template>

<script setup lang="ts">
import { PhyWorkspaceShell } from "@/components/shell";
</script>

<style lang="scss" scoped>
.log-list-workspace {
  min-width: 0;
}
</style>
