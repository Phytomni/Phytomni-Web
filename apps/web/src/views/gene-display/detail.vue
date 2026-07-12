<template>
  <PhyWorkspaceShell class="gene-detail-workspace">
    <template #header>
      <PhyPageHeader :title="pageTitle" />
    </template>

    <PhyAsyncState :state="asyncState">
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
        <div class="gene-detail-result">
          <DeepGenomeResultViewer
            :markdown="processedContent"
            :references="references"
            ns="gene-detail"
            embedded
          />
        </div>
      </template>
    </PhyAsyncState>
  </PhyWorkspaceShell>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { ElMessage } from "element-plus";
import { getGeneDetails } from "@/api/gene-display";
import DeepGenomeResultViewer from "@/components/DeepGenomeResultViewer.vue";
import { useI18n } from "vue-i18n";
import { buildDisplayContent } from "./gene-markdown";
import {
  PhyEmptyState,
  PhyPageHeader,
  PhyWorkspaceShell,
} from "@/components/shell";
import { PhyAsyncState, PhyErrorState, PhySkeleton } from "@/components/state";

type AsyncState = "loading" | "empty" | "error" | "ready";

interface GeneReference {
  title: string;
  [key: string]: unknown;
}

const { t } = useI18n();

const route = useRoute();
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

const processedContent = computed(() => buildDisplayContent(MDContent.value));

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
    fetchGeneDetail(fileName.value);
  }
};

watch(
  fileName,
  (nextFileName) => {
    MDContent.value = "";
    references.value = [];
    requestFailed.value = false;

    if (nextFileName) {
      fetchGeneDetail(nextFileName);
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
.gene-detail-workspace {
  height: 100%;
  min-width: 0;
  padding-bottom: calc(var(--phy-space-40) + var(--phy-space-24));
}

.gene-detail-state-surface {
  min-height: 260px;
  padding: var(--phy-space-24);
  border: 1px solid var(--phy-color-border-subtle);
  border-radius: var(--phy-radius-md);
  background: var(--phy-color-bg-elevated);
}

.gene-detail-result {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
}

@media (max-width: 599px) {
  .gene-detail-state-surface {
    min-height: 200px;
    padding: var(--phy-space-16);
  }
}
</style>
