<template>
  <PhyWorkspaceShell class="permission-workspace" data-scroll-root="workspace">
    <h1>{{ $t("permission.title") }}</h1>
  </PhyWorkspaceShell>
</template>

<script setup lang="ts">
import { PhyWorkspaceShell } from "@/components/shell";
</script>

<style lang="scss" scoped>
.permission-workspace {
  min-width: 0;
}
</style>
