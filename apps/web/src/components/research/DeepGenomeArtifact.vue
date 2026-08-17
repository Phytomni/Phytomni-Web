<template>
  <div class="deep-genome-artifact" data-testid="deep-genome-artifact">
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
          :resources="resources"
          :ns="ns"
          :rendering-file-id="renderingFileId"
          :show-actions="false"
          :show-references="false"
          @citation-activate="activateEvidence"
          @resource-activate="emit('resource-activate', $event)"
        />
      </template>

      <template #evidence>
        <ResearchEvidencePanel
          ref="evidencePanelRef"
          :references="references"
          :ns="ns"
        />
      </template>

      <template #activity>{{ $t("common.noData") }}</template>
      <template #downloads>{{ $t("common.noData") }}</template>
    </ResearchArtifactShell>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import DeepGenomeResultViewer from "@/components/DeepGenomeResultViewer.vue";
import type {
  DeepGenomeDownloadFormat,
  DeepGenomeViewerHandle,
} from "./deep-genome-types";
import ResearchArtifactHeader from "./ResearchArtifactHeader.vue";
import ResearchArtifactShell from "./ResearchArtifactShell.vue";
import ResearchEvidencePanel from "./ResearchEvidencePanel.vue";
import type {
  AuthorizedScientificResource,
  ScientificCitationActivation,
  ScientificResourceActivation,
} from "@/utils/scientific-markdown/types";

type ArtifactTab = "content" | "evidence" | "activity" | "downloads";
type ArtifactTabLabels = Partial<Record<ArtifactTab, string>>;

const props = withDefaults(
  defineProps<{
    markdown?: string;
    references?: readonly unknown[];
    resources?: readonly AuthorizedScientificResource[];
    ns: string;
    renderingFileId?: string;
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
    resources: () => [],
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
  (event: "resource-activate", activation: ScientificResourceActivation): void;
}>();

const viewerRef = ref<DeepGenomeViewerHandle | null>(null);
const evidencePanelRef = ref<{
  focusReferences(indices: readonly number[]): boolean;
} | null>(null);
const selectedTab = ref<ArtifactTab>(props.tab);

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

async function activateEvidence(
  activation: ScientificCitationActivation
): Promise<void> {
  if (activation.namespace !== props.ns) return;
  handleTab("evidence");
  await nextTick();
  evidencePanelRef.value?.focusReferences(activation.indices);
}

async function delegateDownload(
  format: DeepGenomeDownloadFormat
): Promise<void> {
  const handle = viewerRef.value;
  if (!handle) return;
  try {
    await handle.download(format);
  } catch {
    // The embedded viewer owns its download error surface.
  }
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

.deep-genome-artifact :deep(.deep-genome-document) {
  max-width: var(--phy-layout-artifact-document-max-width);
}
</style>
