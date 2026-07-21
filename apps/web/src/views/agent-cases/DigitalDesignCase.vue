<template>
  <AgentDemoShell
    :title="$t('agents.digitalDesign.title')"
    :subtitle="$t('agents.digitalDesign.subtitle')"
    @back="goBack"
  >
    <template #question>
      <p data-test="digital-design-question">{{ sampleQuestion }}</p>
    </template>

    <template #result>
      <div data-test="digital-design-result">
        <p
          class="digital-design-result-label"
          data-test="digital-design-result-label"
        >
          {{ $t("agents.digitalDesign.sampleResult") }}
        </p>
        <p class="digital-design-task-label" data-test="digital-design-task">
          {{ $t("agents.digitalDesign.sampleTask") }}
          <code>3b5564b-772a-44f0-abc5-fb163e7d13c4</code>
        </p>

        <el-button
          type="primary"
          size="small"
          :icon="Download"
          class="digital-design-download"
          data-test="digital-design-download"
          @click="downloadResults"
          @keydown.enter.prevent="downloadResults"
        >
          {{ $t("agents.digitalDesign.downloadResults") }}
        </el-button>
      </div>
    </template>

    <template #footer>{{ $t("common.Tip") }}</template>
  </AgentDemoShell>
</template>

<script setup lang="ts">
import { useRouter } from "vue-router";
import { Download } from "@element-plus/icons-vue";
import { AgentDemoShell } from "@/components/demo";

const router = useRouter();

const sampleQuestion =
  "Please help me design the protein structure based on evolution information for gene Os01g0177400.";

const goBack = () => {
  router.back();
};

const downloadResults = () => {
  const link = document.createElement("a");
  link.href =
    "/static/downloads/7.Digital Design Agent/2.DigitalAgent/results/design_results.zip";
  link.download = "design_results.zip";
  link.style.display = "none";
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    document.body.removeChild(link);
  }
};
</script>

<style scoped>
.digital-design-result-label,
.digital-design-task-label {
  margin: 0;
}

.digital-design-result-label {
  color: var(--phy-color-action-text);
  font-size: 0.75rem;
  font-weight: 650;
  letter-spacing: 0.01em;
  text-transform: uppercase;
}

.digital-design-task-label {
  margin-top: var(--phy-space-8);
}

.digital-design-task-label code {
  color: var(--phy-color-text);
  font-family: var(--phy-font-mono);
  font-size: 0.9em;
}

.digital-design-download {
  margin-top: var(--phy-space-12);
}
</style>
