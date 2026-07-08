<template>
  <el-watermark v-if="userName" :content="content">
    <slot />
  </el-watermark>
  <slot v-else />
</template>

<script setup lang="ts">
import { computed } from "vue";
import userStore from "@/stores/user";

// Overlay a traceability watermark (viewer + date) on PII-bearing admin views.
// el-watermark is pointer-events:none by default, so it never blocks interaction.
const user = userStore();

const today = new Date();
const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

const userName = computed(() => user.name ?? "");
const content = computed(() => [userName.value, dateStr]);
</script>
