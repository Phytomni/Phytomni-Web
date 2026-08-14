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
          :markdown="processedContent"
          :references="references"
          ns="gene-detail"
          :title="pageTitle"
          :metadata="artifactMetadata"
          :tab-labels="artifactTabLabels"
          :tablist-label="t('common.operation')"
          artifact-id="gene-detail-artifact"
          :back-label="t('common.back')"
          :close-label="t('common.close')"
          :action-label="t('common.operation')"
          @back="handleArtifactNavigation"
          @close="handleArtifactNavigation"
        />
      </template>
    </PhyAsyncState>
  </main>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { getGeneDetails } from "@/api/gene-display";
import { isRecord } from "@/api/contracts";
import { DeepGenomeArtifact } from "@/components/research";
import { useI18n } from "vue-i18n";
import { buildDisplayContent } from "./gene-markdown";
import { PhyEmptyState } from "@/components/shell";
import { PhyAsyncState, PhyErrorState, PhySkeleton } from "@/components/state";

type AsyncState = "loading" | "empty" | "error" | "ready";

interface GeneReference {
  title: string;
  [key: string]: unknown;
}

const { t } = useI18n();

const route = useRoute();
const router = useRouter();
const loading = ref(false);
const requestFailed = ref(false);
const MDContent = ref("");
const references = ref<GeneReference[]>([]);
let activeRequest = 0;

const fileName = computed(() => {
  const value = route.query.file_name;
  return typeof value === "string" ? value : "";
});

const pageTitle = computed(() => fileName.value || t("gene.detailTitle"));
const artifactMetadata = computed(() => t("agents.deepGenome.title"));
const artifactTabLabels = computed(() => ({
  content: t("common.view"),
  evidence: t("agents.deepGenome.references"),
  activity: t("chat.log.activityLabel"),
  downloads: t("chat.actions.downloadAttachments"),
}));

const asyncState = computed<AsyncState>(() => {
  if (loading.value) return "loading";
  if (requestFailed.value) return "error";
  if (!MDContent.value) return "empty";
  return "ready";
});

// Parse DOC TITLES into references
const parseDocTitles = (
  content: string
): { mainContent: string; refs: GeneReference[] } => {
  const separator = "--- DOC TITLES ---";
  const separatorIndex = content.indexOf(separator);

  if (separatorIndex === -1) {
    return { mainContent: content, refs: [] };
  }

  const mainContent = content.substring(0, separatorIndex).trim();
  const docTitlesSection = content
    .substring(separatorIndex + separator.length)
    .trim();

  // Parse the reference list (format: number. title)
  const refs = docTitlesSection
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      // Match the format: 1. title
      const match = line.match(/^\d+\.\s+(.+)$/);
      if (match) {
        return { title: match[1].trim() };
      }
      return null;
    })
    .filter((ref): ref is GeneReference => ref !== null);

  return { mainContent, refs };
};

const processedContent = computed(() =>
  buildDisplayContent(MDContent.value).replace(/\\n/g, "\n")
);

// Fetch gene details
const fetchGeneDetail = async (file_name: string) => {
  const requestId = ++activeRequest;
  loading.value = true;
  requestFailed.value = false;

  try {
    const res = await getGeneDetails({ file_name });
    if (requestId !== activeRequest) return;

    if (res.code === 200 && res.data) {
      const content =
        typeof res.data.content === "string" ? res.data.content : "";
      const { mainContent, refs } = parseDocTitles(content);

      MDContent.value = mainContent;
      references.value =
        Array.isArray(res.data.references) && res.data.references.length > 0
          ? res.data.references
          : refs;
    } else {
      MDContent.value = "";
      references.value = [];
      requestFailed.value = true;
      ElMessage.error(res.message || t("gene.getFailed"));
    }
  } catch (error) {
    if (requestId !== activeRequest) return;
    console.error(t("gene.logs.fetchDetailFailed"), error);
    MDContent.value = "";
    references.value = [];
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

watch(
  fileName,
  (nextFileName) => {
    MDContent.value = "";
    references.value = [];
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
