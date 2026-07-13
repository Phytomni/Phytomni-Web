<template>
  <div
    ref="artifactRoot"
    class="deep-genome-artifact"
    data-testid="deep-genome-artifact"
    @click="handleArtifactClick"
  >
    <ResearchArtifactShell
      :title="title"
      :metadata="metadata"
      :status="status"
      :tab="selectedTab"
      :tab-labels="tabLabels"
      content-layout="wide"
      :tablist-label="tablistLabel"
      :artifact-id="artifactId"
      :back-label="backLabel"
      :close-label="closeLabel"
      :action-label="actionLabel"
      @back="emit('back')"
      @close="emit('close')"
      @action="emit('action')"
      @tab="handleTab"
    >
      <template #header>
        <ResearchArtifactHeader
          :title="title"
          :metadata="metadata"
          :status="status"
          :back-label="backLabel"
          :close-label="closeLabel"
          :action-label="actionLabel"
          @back="emit('back')"
          @close="emit('close')"
          @action="emit('action')"
        >
          <template #actions>
            <button
              type="button"
              class="research-artifact-header__control"
              data-test="deep-genome-download-pdf"
              :aria-label="$t('agents.deepGenome.downloadPDF')"
              @click="delegateDownload('pdf')"
            >
              {{ $t("agents.deepGenome.downloadPDF") }}
            </button>
            <button
              type="button"
              class="research-artifact-header__control"
              data-test="deep-genome-download-markdown"
              :aria-label="$t('agents.deepGenome.downloadMD')"
              @click="delegateDownload('markdown')"
            >
              {{ $t("agents.deepGenome.downloadMD") }}
            </button>
          </template>
        </ResearchArtifactHeader>
      </template>

      <template #content>
        <DeepGenomeResultViewer
          ref="viewerRef"
          :markdown="markdown"
          :references="references"
          :ns="ns"
          :show-actions="false"
          :show-references="false"
        />
      </template>

      <template #evidence>
        <ResearchEvidencePanel
          :references="references"
          :ns="ns"
          @activate="handleTab('evidence')"
        />
      </template>

      <template #activity>{{ $t("common.noData") }}</template>
      <template #downloads>{{ $t("common.noData") }}</template>
    </ResearchArtifactShell>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import DeepGenomeResultViewer from "@/components/DeepGenomeResultViewer.vue";
import type {
  DeepGenomeDownloadFormat,
  DeepGenomeViewerHandle,
} from "./deep-genome-types";
import ResearchArtifactHeader from "./ResearchArtifactHeader.vue";
import ResearchArtifactShell from "./ResearchArtifactShell.vue";
import ResearchEvidencePanel from "./ResearchEvidencePanel.vue";

type ArtifactTab = "content" | "evidence" | "activity" | "downloads";
type ArtifactTabLabels = Partial<Record<ArtifactTab, string>>;

const props = withDefaults(
  defineProps<{
    markdown?: string;
    references?: unknown[];
    ns: string;
    title: string;
    metadata?: string | string[];
    status?: string;
    tab?: ArtifactTab;
    tabLabels?: ArtifactTabLabels;
    tablistLabel?: string;
    artifactId?: string;
    backLabel: string;
    closeLabel: string;
    actionLabel: string;
  }>(),
  {
    markdown: "",
    references: () => [],
    tab: "content",
    tabLabels: () => ({}),
    tablistLabel: "Report sections",
  }
);

const emit = defineEmits<{
  (event: "back"): void;
  (event: "close"): void;
  (event: "action"): void;
  (event: "tab", tab: ArtifactTab): void;
}>();

const artifactRoot = ref<HTMLElement | null>(null);
const viewerRef = ref<DeepGenomeViewerHandle | null>(null);
const selectedTab = ref<ArtifactTab>(props.tab);
const safeNamespace = computed(() => props.ns.replace(/[^A-Za-z0-9-]/g, ""));

watch(
  () => props.tab,
  (tab) => {
    selectedTab.value = tab;
  }
);

function handleTab(tab: ArtifactTab): void {
  selectedTab.value = tab;
  emit("tab", tab);
}

function delegateDownload(format: DeepGenomeDownloadFormat): void {
  const handle = viewerRef.value;
  if (!handle) return;
  void handle.download(format);
}

function findEvidenceRow(targetId: string): HTMLElement | null {
  const prefix = safeNamespace.value ? `${safeNamespace.value}-ref-` : "ref-";
  if (!targetId.startsWith(prefix)) return null;

  return (
    Array.from(
      artifactRoot.value?.querySelectorAll<HTMLElement>(
        ".research-evidence-panel__item"
      ) ?? []
    ).find((row) => row.id === targetId) ?? null
  );
}

async function handleArtifactClick(event: MouseEvent): Promise<void> {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return;
  }

  const target = event.target;
  if (!(target instanceof Element) || !artifactRoot.value) return;

  const anchor = target.closest<HTMLAnchorElement>("a[href]");
  if (!anchor || !artifactRoot.value.contains(anchor)) return;
  if (!anchor.closest('[data-panel-id="content"]')) return;

  const href = anchor.getAttribute("href");
  if (!href || !href.startsWith("#") || href.length === 1) return;
  const targetId = href.slice(1);
  if (!findEvidenceRow(targetId)) return;

  event.preventDefault();
  handleTab("evidence");
  await nextTick();
  const row = findEvidenceRow(targetId);
  if (!row) return;
  row.scrollIntoView({ block: "nearest" });
  row.focus();
}
</script>

<style scoped>
.deep-genome-artifact {
  width: 100%;
  min-width: 0;
  min-height: 0;
}

.deep-genome-artifact :deep(.research-artifact-shell__panel) {
  min-width: 0;
}
</style>
