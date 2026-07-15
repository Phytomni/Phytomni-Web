<template>
  <AgentDemoShell
    :title="t('agents.design.title')"
    :subtitle="t('agents.design.subtitle')"
    @back="handleBack"
  >
    <template #result>
      <section
        class="design-unavailable"
        data-test="design-unavailable"
        role="status"
        aria-live="polite"
      >
        <h2 data-test="design-unavailable-title">
          {{ t("agents.design.unavailableTitle") }}
        </h2>
        <p>{{ t("agents.design.unavailableMessage") }}</p>
      </section>
    </template>
  </AgentDemoShell>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { AgentDemoShell } from "@/components/demo";

const { t } = useI18n();
const router = useRouter();

const handleBack = () => {
  router.back();
};
</script>

<style scoped>
.design-unavailable {
  display: grid;
  gap: var(--phy-space-8);
  min-height: 220px;
  place-content: center;
  padding: var(--phy-space-32) var(--phy-space-24);
  border: 1px solid var(--phy-color-border-subtle);
  border-radius: var(--phy-radius-lg);
  background: var(--phy-color-bg-page);
  text-align: center;
}

.design-unavailable h2,
.design-unavailable p {
  margin: 0;
}

.design-unavailable h2 {
  color: var(--phy-color-text);
  font-size: 1.1rem;
  font-weight: 650;
}

.design-unavailable p {
  max-width: 620px;
  color: var(--phy-color-text-secondary);
  line-height: 1.6;
}
</style>
