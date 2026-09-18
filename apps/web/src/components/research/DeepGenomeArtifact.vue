<template>
  <div class="deep-genome-artifact" data-testid="deep-genome-artifact">
    <DeepGenomeMaterialDetail
      v-if="detailState.selection"
      :state="detailState"
      :title="materialTitle"
      :downloadable="Boolean(materialDetail.download.value)"
      @back="backFromMaterial"
      @retry="materialDetail.retry"
      @download="downloadMaterial"
    />
    <div
      ref="parentReport"
      class="deep-genome-artifact__parent"
      data-testid="deep-genome-parent"
      :hidden="Boolean(detailState.selection)"
      :inert="Boolean(detailState.selection)"
    >
      <ResearchArtifactShell
        :title="title"
        :metadata="metadata"
        :status="status"
        :report-status="reportPresentation?.state"
        :tab="selectedTab"
        :tabs="visibleTabs"
        :tab-labels="tabLabels"
        content-layout="wide"
        :tablist-label="tablistLabel"
        :artifact-id="artifactId"
        :back-label="backLabel"
        :close-label="closeLabel"
        :action-label="actionLabel"
        :menu-items="menuItems"
        @back="emit('back')"
        @close="emit('close')"
        @action="emit('action', $event)"
        @tab="handleTab"
      >
        <template #content>
          <BotReportWarnings
            :warning-keys="reportPresentation?.warningKeys ?? []"
          />
          <DeepGenomeResultViewer
            ref="viewerRef"
            :markdown="markdown"
            :references="references"
            :resources="resources"
            :registered-resources-only="true"
            :ns="ns"
            :rendering-file-id="renderingFileId"
            :show-actions="false"
            :show-references="false"
            :print-references-root="() => evidencePanelRef?.$el ?? null"
            @citation-activate="activateEvidence"
            @resource-activate="activateResource"
          />
        </template>

        <template #evidence>
          <ResearchEvidencePanel
            ref="evidencePanelRef"
            :references="references"
            :ns="ns"
            :reference-materials="referenceMaterials"
            @material-activate="openMaterial"
          />
        </template>

        <template #activity>{{ $t("common.noData") }}</template>
        <template #downloads>{{ $t("common.noData") }}</template>
      </ResearchArtifactShell>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { saveAs } from "file-saver";
import DeepGenomeResultViewer from "@/components/DeepGenomeResultViewer.vue";
import type {
  DeepGenomeDownloadFormat,
  DeepGenomeViewerHandle,
} from "./deep-genome-types";
import type { ArtifactOverflowItem } from "./artifact-overflow";
import ResearchArtifactShell from "./ResearchArtifactShell.vue";
import BotReportWarnings from "./BotReportWarnings.vue";
import { reportPresentationFor } from "@/views/chat/utils/report-presentation";
import type { BotLifecycleState } from "@/views/chat/streaming/botLifecycleReducer";
import { artifactChrome } from "@/views/chat/utils/artifact-chrome";
import ResearchEvidencePanel from "./ResearchEvidencePanel.vue";
import DeepGenomeMaterialDetail from "./DeepGenomeMaterialDetail.vue";
import { useDeepGenomeMaterialDetail } from "./useDeepGenomeMaterialDetail";
import {
  createDeepGenomeMaterialDetailState,
  type DeepGenomeMaterialDetailState,
  type DeepGenomeMaterialSelection,
  type DeepGenomeReferenceMaterial,
  type DeepGenomeResourceReader,
} from "./deep-genome-report";
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
    referenceMaterials?: readonly DeepGenomeReferenceMaterial[];
    detailState?: DeepGenomeMaterialDetailState;
    reportKey?: string;
    readResource?: DeepGenomeResourceReader;
    ns: string;
    renderingFileId?: string;
    title: string;
    metadata?: string | string[];
    status?: string;
    reportState?: BotLifecycleState;
    tab?: ArtifactTab;
    tabs?: readonly ArtifactTab[];
    tabLabels?: ArtifactTabLabels;
    tablistLabel?: string;
    artifactId?: string;
    backLabel: string;
    closeLabel: string;
    actionLabel: string;
    menuItems?: readonly ArtifactOverflowItem[];
  }>(),
  {
    markdown: "",
    references: () => [],
    resources: () => [],
    referenceMaterials: () => [],
    detailState: () => reactive(createDeepGenomeMaterialDetailState()),
    reportKey: "",
    tab: "content",
    tabLabels: () => ({}),
    tablistLabel: "Report sections",
    menuItems: () => [],
  }
);

const emit = defineEmits<{
  (event: "back"): void;
  (event: "close"): void;
  (event: "action", command: string): void;
  (event: "tab", tab: ArtifactTab): void;
  (event: "resource-activate", activation: ScientificResourceActivation): void;
}>();

const viewerRef = ref<DeepGenomeViewerHandle | null>(null);
const reportPresentation = computed(() =>
  props.reportState
    ? reportPresentationFor(
        props.reportState,
        {
          report: props.markdown,
          source:
            props.markdown === props.reportState.finalReport
              ? "final"
              : "intermediate",
        },
        "DeepGenomeAgent"
      )
    : null
);
const { t } = useI18n();
const parentReport = ref<HTMLElement | null>(null);
let previousFocus: HTMLElement | null = null;
let previousScroll: Array<{ element: HTMLElement; top: number; left: number }> =
  [];
const materialDetail = useDeepGenomeMaterialDetail({
  state: () => props.detailState,
  reportKey: () => props.reportKey || props.ns,
  resources: () => props.resources,
  materials: () => props.referenceMaterials,
  readResource: () => props.readResource,
});
const materialTitle = computed(() => {
  const selection = props.detailState.selection;
  return selection?.kind === "excerpt"
    ? t("agents.deepGenome.material.excerptTitle", {
        index: selection.referenceIndex,
      })
    : materialDetail.selectedResource.value?.name ||
        t("agents.deepGenome.material.unavailable");
});
watch(
  () => props.markdown,
  () => materialDetail.back()
);

async function openMaterial(
  selection: DeepGenomeMaterialSelection
): Promise<void> {
  if (!props.detailState.selection && parentReport.value) {
    previousFocus = parentReport.value.contains(document.activeElement)
      ? (document.activeElement as HTMLElement)
      : null;
    previousScroll = Array.from(
      parentReport.value.querySelectorAll<HTMLElement>("*")
    )
      .filter((element) => element.scrollTop !== 0 || element.scrollLeft !== 0)
      .map((element) => ({
        element,
        top: element.scrollTop,
        left: element.scrollLeft,
      }));
  }
  await materialDetail.open(selection);
}

async function activateResource(
  activation: ScientificResourceActivation
): Promise<void> {
  if (activation.kind === "markdown" && props.readResource) {
    await openMaterial({ kind: "resource", resourceId: activation.id });
  } else {
    emit("resource-activate", activation);
  }
}

async function backFromMaterial(): Promise<void> {
  materialDetail.back();
  await nextTick();
  for (const { element, top, left } of previousScroll) {
    element.scrollTop = top;
    element.scrollLeft = left;
  }
  if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  previousFocus = null;
  previousScroll = [];
}

function downloadMaterial(): void {
  const download = materialDetail.download.value;
  if (!download) return;
  saveAs(
    new Blob([Uint8Array.from(download.bytes)], {
      type: "text/markdown;charset=utf-8",
    }),
    download.name
  );
}
const evidencePanelRef = ref<{
  $el?: HTMLElement;
  focusReferences(indices: readonly number[]): boolean;
} | null>(null);
const visibleTabs = computed<readonly ArtifactTab[]>(() => {
  if (props.tabs && props.tabs.length > 0) return props.tabs;
  return artifactChrome({
    tool: "DeepGenomeAgent",
    referenceCount: props.references?.length ?? 0,
    hasAttachments: false,
    runComplete: true,
    surface: "client",
  }).tabs;
});
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
  if (!visibleTabs.value.includes("evidence")) return;
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

defineExpose({ download: delegateDownload });
</script>

<style scoped>
.deep-genome-artifact {
  width: 100%;
  min-width: 0;
  min-height: 0;
  height: 100%;
}

.deep-genome-artifact__parent {
  height: 100%;
  min-height: 0;
}

.deep-genome-artifact__parent[hidden] {
  display: none;
}

.deep-genome-artifact :deep(.research-artifact-shell__panel) {
  min-width: 0;
}

.deep-genome-artifact :deep(.deep-genome-document) {
  max-width: var(--phy-layout-artifact-document-max-width);
}
</style>
