<template>
  <AgentDemoShell
    :title="$t('agents.geneNetwork.title')"
    :subtitle="$t('agents.geneNetwork.subtitle')"
    @back="goBack"
  >
    <template #question>
      <p data-test="gene-network-question">{{ sampleQuestion }}</p>
    </template>

    <template #result>
      <div data-test="gene-network-result">
        <p
          class="gene-network-result-label"
          data-test="gene-network-result-label"
        >
          {{ $t("agents.geneNetwork.sampleResult") }}
        </p>
        <p class="gene-network-task-label" data-test="gene-network-task">
          {{ $t("agents.geneNetwork.sampleTask") }}
          <code>8ab4434b-772a-44f0-aaa5-fa163e7f84a3</code>
        </p>

        <el-button
          type="primary"
          size="small"
          :icon="Download"
          class="gene-network-download"
          data-test="gene-network-download"
          :disabled="downloadState === 'starting'"
          @click="downloadResults"
          @keydown.enter.prevent="downloadResults"
        >
          {{ $t("agents.geneNetwork.downloadResults") }}
        </el-button>

        <div
          v-if="downloadState !== 'idle'"
          class="gene-network-download-status"
          data-test="gene-network-download-status-group"
        >
          <p data-test="gene-network-download-status" role="status">
            {{ downloadStatus }}
          </p>
          <p
            v-if="currentDownloadFile"
            class="gene-network-current-file"
            data-test="gene-network-current-file"
          >
            {{ currentDownloadFile }}
          </p>
        </div>
      </div>
    </template>

    <template #footer>{{ $t("common.Tip") }}</template>
  </AgentDemoShell>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { Download } from "@element-plus/icons-vue";
import { AgentDemoShell } from "@/components/demo";
import { NETWORK_CASE_QUESTION } from "@/views/chat/demos/network-fixture";

const router = useRouter();
const { t } = useI18n();

const sampleQuestion = NETWORK_CASE_QUESTION;

const fileParts = [
  "network_results.zip.001",
  "network_results.zip.002",
  "network_results.zip.003",
  "network_results.zip.004",
  "network_results.zip.005",
] as const;
const basePath =
  "/static/downloads/5.Gene Netwrok Agent/3.NetwrokAgent/results/";

type DownloadState = "idle" | "starting" | "started";

const downloadState = ref<DownloadState>("idle");
const currentDownloadFile = ref("");
const currentDownloadIndex = ref(0);

const downloadStatus = computed(() => {
  if (downloadState.value === "started") {
    return t("agents.geneNetwork.allDownloadsStarted");
  }
  return t("agents.geneNetwork.startingDownload", {
    current: currentDownloadIndex.value + 1,
    total: fileParts.length,
  });
});

const goBack = () => {
  router.back();
};

const startDownloadRequest = (fileName: string) => {
  const link = document.createElement("a");
  link.href = basePath + fileName;
  link.download = fileName;
  link.style.display = "none";
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    document.body.removeChild(link);
  }
};

const downloadResults = () => {
  if (downloadState.value === "starting") return;

  downloadState.value = "starting";
  currentDownloadIndex.value = 0;
  currentDownloadFile.value = fileParts[0];

  fileParts.forEach((fileName, index) => {
    window.setTimeout(() => {
      currentDownloadIndex.value = index;
      currentDownloadFile.value = fileName;
      startDownloadRequest(fileName);

      if (index === fileParts.length - 1) {
        downloadState.value = "started";
      }
    }, index * 1000);
  });
};
</script>

<style scoped>
.gene-network-result-label,
.gene-network-task-label {
  margin: 0;
}

.gene-network-result-label {
  color: var(--phy-color-action-text);
  font-size: 0.75rem;
  font-weight: 650;
  letter-spacing: 0.01em;
  text-transform: uppercase;
}

.gene-network-task-label {
  margin-top: var(--phy-space-8);
}

.gene-network-task-label code {
  color: var(--phy-color-text);
  font-family: var(--phy-font-mono);
  font-size: 0.9em;
}

.gene-network-download {
  margin-top: var(--phy-space-12);
}

.gene-network-download-status {
  margin-top: var(--phy-space-12);
  color: var(--phy-color-text-secondary);
  font-size: 0.875rem;
  line-height: 1.5;
}

.gene-network-download-status p {
  margin: 0;
}

.gene-network-current-file {
  color: var(--phy-color-text);
  font-family: var(--phy-font-mono);
  overflow-wrap: anywhere;
}
</style>
