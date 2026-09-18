<template>
  <div
    v-if="warningKeys.length"
    class="bot-report-warnings"
    data-test="bot-report-warnings"
    role="status"
  >
    <p v-for="key in warningKeys" :key="key">{{ t(key) }}</p>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
defineProps<{ warningKeys: readonly string[] }>();
const { t } = useI18n();
</script>

<style scoped>
.bot-report-warnings {
  color: var(--phy-color-text-secondary);
  font-size: 14px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.bot-report-warnings p {
  margin: var(--phy-space-8) 0;
}
</style>
