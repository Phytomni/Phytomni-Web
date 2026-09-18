<template>
  <main class="gene-detail-route" data-scroll-root="gene-detail">
    <PhyAsyncState class="gene-detail-state" :state="asyncState">
      <template #loading>
        <div class="gene-detail-state-surface">
          <PhySkeleton shape="line" :count="8" />
        </div>
      </template>

      <template #empty>
        <div class="gene-detail-state-surface">
          <PhyEmptyState :title="$t('gene.notFound')" />
        </div>
      </template>

      <template #error>
        <div class="gene-detail-state-surface">
          <PhyErrorState
            :title="$t('gene.getFailed')"
            :description="$t('common.opFailedRetry')"
            :retry-label="$t('common.retry')"
            @retry="retryFetch"
          />
        </div>
      </template>

      <template #ready>
        <DeepGenomeArtifact
          class="gene-detail-artifact"
          :markdown="MDContent"
          :references="references"
          :resources="renderResources"
          :reference-materials="report?.reference_materials ?? []"
          :report-key="`${fileName}:${report?.report_revision ?? ''}`"
          :detail-state="materialDetail"
          :read-resource="readResource"
          ns="gene-detail"
          :title="pageTitle"
          :metadata="artifactMetadata"
          :tab-labels="artifactTabLabels"
          :tabs="artifactTabs"
          :tablist-label="t('common.operation')"
          artifact-id="gene-detail-artifact"
          :back-label="t('common.back')"
          :close-label="t('common.close')"
          :action-label="t('common.operation')"
          :menu-items="artifactMenuItems"
          ref="artifactRef"
          @back="handleArtifactNavigation"
          @close="handleArtifactNavigation"
          @action="onArtifactMenu"
        />
      </template>
    </PhyAsyncState>
  </main>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import {
  getGeneDetails,
  getGeneResourceCif,
  getGeneResourceMarkdown,
} from "@/api/gene-display";
import type { AuthorizedScientificResource } from "@/utils/scientific-markdown/types";
import { createDeepGenomeMaterialDetailState } from "@/components/research/deep-genome-report";
import type { GeneDetail } from "@/api/types";
import { isRecord } from "@/api/contracts";
import { DeepGenomeArtifact } from "@/components/research";
import { copyDownloadCloseArtifactMenuItems } from "@/components/research/artifact-overflow";
import {
  artifactChrome,
  artifactDownloadFormat,
} from "@/views/chat/utils/artifact-chrome";
import { useI18n } from "vue-i18n";
import { PhyEmptyState } from "@/components/shell";
import { PhyAsyncState, PhyErrorState, PhySkeleton } from "@/components/state";

type AsyncState = "loading" | "empty" | "error" | "ready";

const { t } = useI18n();

const route = useRoute();
const router = useRouter();
const loading = ref(false);
const requestFailed = ref(false);
const report = ref<GeneDetail | null>(null);
const materialDetail = reactive(createDeepGenomeMaterialDetailState());
const readResource = (id: string, signal: AbortSignal) => {
  if (
    !report.value?.resources.some(
      (resource) => resource.id === id && resource.kind === "markdown"
    )
  ) {
    return Promise.reject(new Error("Gene resource unavailable"));
  }
  return getGeneResourceMarkdown(fileName.value, id, signal);
};
const MDContent = computed(() => report.value?.content ?? "");
const references = computed(() => report.value?.references ?? []);
let activeRequest = 0;

const fileName = computed(() => {
  const value = route.query.file_name;
  return typeof value === "string" ? value : "";
});

const renderResources = computed<AuthorizedScientificResource[]>(() => {
  const currentReport = report.value;
  const reportFile = fileName.value;
  const revision = currentReport?.report_revision;
  return (currentReport?.resources ?? []).map((resource) => {
    if (resource.kind !== "cif") return resource;
    return {
      id: resource.id,
      name: resource.name,
      kind: resource.kind,
      markdownHref: resource.markdownHref,
      renderSource: {
        kind: "cif-text",
        read: (signal: AbortSignal) => {
          if (
            fileName.value !== reportFile ||
            report.value?.report_revision !== revision ||
            !report.value?.resources.some(
              (item) => item.id === resource.id && item.kind === "cif"
            )
          )
            return Promise.reject(new Error("Gene resource unavailable"));
          return getGeneResourceCif(reportFile, resource.id, signal);
        },
      },
    };
  });
});

const pageTitle = computed(() => fileName.value || t("gene.detailTitle"));
const artifactMetadata = computed(() => t("agents.deepGenome.title"));
const artifactTabLabels = computed(() => ({
  content: t("common.view"),
  evidence: t("agents.deepGenome.references"),
  activity: t("chat.log.activityLabel"),
  downloads: t("chat.actions.attachments"),
}));
const artifactChromeState = computed(() =>
  artifactChrome({
    tool: "DeepGenomeAgent",
    referenceCount: references.value.length,
    hasAttachments: false,
    runComplete: true,
    surface: "client",
  })
);
const artifactTabs = computed(() => artifactChromeState.value.tabs);
const artifactMenuItems = computed(() =>
  copyDownloadCloseArtifactMenuItems(t, artifactChromeState.value.exportFormats)
);
const artifactRef = ref<{
  download: (format: "pdf" | "markdown") => Promise<void>;
} | null>(null);

const asyncState = computed<AsyncState>(() => {
  if (loading.value) return "loading";
  if (requestFailed.value) return "error";
  if (!MDContent.value) return "empty";
  return "ready";
});

// Fetch gene details
const fetchGeneDetail = async (file_name: string) => {
  const requestId = ++activeRequest;
  loading.value = true;
  requestFailed.value = false;

  try {
    const res = await getGeneDetails({ file_name });
    if (requestId !== activeRequest) return;

    if (res.code === 200 && res.data) {
      report.value = res.data;
    } else {
      report.value = null;
      requestFailed.value = true;
      ElMessage.error(res.message || t("gene.getFailed"));
    }
  } catch (error) {
    if (requestId !== activeRequest) return;
    console.error(t("gene.logs.fetchDetailFailed"), error);
    report.value = null;
    requestFailed.value = true;
    ElMessage.error(t("gene.getFailed"));
  } finally {
    if (requestId === activeRequest) {
      loading.value = false;
    }
  }
};

const retryFetch = () => {
  if (fileName.value) {
    fetchGeneDetail(fileName.value).catch(() => undefined);
  }
};

const handleArtifactNavigation = () => {
  if (window.history.length > 1) {
    window.history.back();
  } else {
    const opener: unknown = window.opener;
    if (isRecord(opener) && opener.closed === false) {
      window.close();
      return;
    }
  }
  if (window.history.length <= 1) {
    Promise.resolve(router.push({ name: "geneDisplay" })).catch(
      () => undefined
    );
  }
};

const onArtifactMenu = (command: string) => {
  if (command === "close") {
    handleArtifactNavigation();
    return;
  }
  const format = artifactDownloadFormat(command);
  const artifact = artifactRef.value;
  if (format === "PDF") {
    if (artifact) void artifact.download("pdf").catch(() => undefined);
    return;
  }
  if (format === "Markdown") {
    if (artifact) void artifact.download("markdown").catch(() => undefined);
    return;
  }
  if (command !== "copy") return;
  const text = MDContent.value.trim();
  if (!text) {
    ElMessage.error(t("chat.copyFailed"));
    return;
  }
  void navigator.clipboard.writeText(text).then(
    () => {
      ElMessage.success(t("chat.copySuccess"));
    },
    () => {
      ElMessage.error(t("chat.copyFailed"));
    }
  );
};

watch(
  fileName,
  (nextFileName) => {
    report.value = null;
    requestFailed.value = false;

    if (nextFileName) {
      fetchGeneDetail(nextFileName).catch(() => undefined);
    } else {
      activeRequest += 1;
      loading.value = false;
    }
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  activeRequest += 1;
});
</script>

<style scoped lang="scss">
.gene-detail-route {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  padding-bottom: calc(var(--phy-space-40) + var(--phy-space-24));
  background: var(--phy-color-bg-page);
  color: var(--phy-color-text);
}

.gene-detail-state {
  flex: 1 1 auto;
  min-height: 0;
}

.gene-detail-state :deep(.phy-async-state__ready),
.gene-detail-state :deep(.phy-async-state__content) {
  height: 100%;
  min-height: 0;
}

.gene-detail-artifact {
  height: 100%;
  width: 100%;
  max-width: 100%;
  min-height: 0;
}

.gene-detail-state-surface {
  min-height: 260px;
  padding: var(--phy-space-24);
  border: 1px solid var(--phy-color-border-subtle);
  border-radius: var(--phy-radius-md);
  background: var(--phy-color-bg-elevated);
}

@media (max-width: 599px) {
  .gene-detail-state-surface {
    min-height: 200px;
    padding: var(--phy-space-16);
  }
}
</style>
