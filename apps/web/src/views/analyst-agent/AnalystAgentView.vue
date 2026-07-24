<template>
  <AgentDemoShell
    :title="$t('agents.analyst.title')"
    :subtitle="$t('agents.analyst.subtitle')"
    @back="goBack"
  >
    <template #question>
      <p data-test="analyst-question">{{ sampleQuestion }}</p>
    </template>

    <template #result>
      <div class="analyst-result" data-test="analyst-result">
        <p class="analyst-result-label" data-test="analyst-result-label">
          {{ $t("agents.analyst.sampleResult") }}
        </p>
        <p class="analyst-task-label" data-test="analyst-task-label">
          {{ $t("agents.analyst.sampleTask") }}
          <code>4a7715a-996a-22e0-acd5-fb278e7d45b3</code>
        </p>
        <el-button
          type="primary"
          size="small"
          :icon="Download"
          class="analyst-download"
          data-test="analyst-download"
          @click="downloadResults"
          @keydown.enter.prevent="downloadResults"
        >
          {{ $t("agents.analyst.downloadResults") }}
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
  'Your data is {"/obs/phytomni/agent_data/raw_data/04.benchmark_data/07.testbenchmark/epigenetic/callpeak/data1_1.fq.gz": "pair-end 1 chip-seq data for rice", "/obs/phytomni/agent_data/raw_data/04.benchmark_data/07.testbenchmark/epigenetic/callpeak/data1_2.fq.gz": "pair-end 2 chip-seq data for rice", "/obs/phytomni/agent_data/raw_data/04.benchmark_data/07.testbenchmark/epigenetic/callpeak/NIP_genome_final.fa": "rice genome fasta file"}, please help me to perform the callpeak analysis.';

const goBack = () => {
  router.back();
};

const downloadResults = () => {
  const link = document.createElement("a");
  link.href =
    "/static/downloads/3.Analyst Agent/1.AnalystAgent/results/callpeak_results.zip";
  link.download = "callpeak_results.zip";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};
</script>

<style scoped>
.analyst-result-label,
.analyst-task-label {
  margin: 0;
}

.analyst-result {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  width: 100%;
  min-width: 0;
  max-width: 100%;
}

.analyst-result-label {
  color: var(--phy-color-action-text);
  font-size: 0.75rem;
  font-weight: 650;
  letter-spacing: 0.01em;
  text-transform: uppercase;
}

.analyst-task-label {
  margin-top: var(--phy-space-8);
  overflow-wrap: anywhere;
}

.analyst-task-label code {
  color: var(--phy-color-text);
  font-family: var(--phy-font-mono);
  font-size: 0.9em;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.analyst-download {
  margin-top: var(--phy-space-12);
  max-width: 100%;
}
</style>
