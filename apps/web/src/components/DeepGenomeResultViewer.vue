<template>
  <div class="deep-genome-viewer" data-testid="deep-genome-viewer">
    <DeepGenomeToc
      :nested-headings="nestedHeadings"
      :active-heading-id="activeHeadingId"
      :title="$t('help.tableOfContents')"
      @select="handleNavSelect"
    />

    <main
      ref="mainContentRef"
      class="deep-genome-main"
      data-testid="deep-genome-main"
    >
      <div
        v-if="props.showActions"
        class="deep-genome-toolbar"
        data-testid="deep-genome-toolbar"
      >
        <el-button
          class="deep-genome-toolbar-button"
          plain
          @click="downloadPDF"
        >
          <i class="el-icon-document"></i>
          {{ $t("agents.deepGenome.downloadPDF") }}
        </el-button>
        <el-button
          class="deep-genome-toolbar-button"
          plain
          @click="downloadMarkdown"
        >
          <i class="el-icon-edit"></i>
          {{ $t("agents.deepGenome.downloadMD") }}
        </el-button>
      </div>
      <article
        ref="documentRef"
        class="deep-genome-document phy-reading"
        data-testid="deep-genome-document"
      >
        <ScientificMarkdown
          :source="props.markdown"
          surface="document"
          :citation-namespace="citationNamespace"
          :reference-count="referenceRows.length"
          :resources="props.resources"
          @headings="handleHeadings"
          @citation-activate="emit('citation-activate', $event)"
          @resource-activate="emit('resource-activate', $event)"
        />

        <!-- References section -->
        <section
          v-if="props.showReferences"
          class="deep-genome-references"
          id="section4"
        >
          <h2 class="deep-genome-heading deep-genome-heading--references">
            {{ $t("agents.deepGenome.references") }}
          </h2>
          <div
            v-if="displayReferences.length > 0"
            class="deep-genome-reference-list"
          >
            <div
              v-for="ref in displayReferences"
              :key="ref.id"
              :id="ref.id"
              class="deep-genome-reference"
              v-html="ref.html"
            ></div>
          </div>
          <p v-else class="deep-genome-empty-references">
            {{ $t("agents.deepGenome.noReferences") }}
          </p>
        </section>
      </article>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { ElButton } from "element-plus";
import DeepGenomeToc from "@/components/research/DeepGenomeToc.vue";
import ScientificMarkdown from "@/components/ScientificMarkdown.vue";
import type {
  DeepGenomeDownloadFormat,
  DeepGenomeViewerHandle,
} from "@/components/research/deep-genome-types";
import { useDeepGenomeDownloads } from "@/composables/useDeepGenomeDownloads";
import { useDeepGenomeToc } from "@/composables/useDeepGenomeToc";
import { buildDisplayReferences } from "@/utils/reference-renderer";
import {
  buildNestedHeadings,
  type NestedScientificHeading,
} from "@/utils/scientific-markdown/toc";
import type {
  AuthorizedScientificResource,
  ScientificCitationActivation,
  ScientificHeading,
  ScientificResourceActivation,
} from "@/utils/scientific-markdown/types";

const props = withDefaults(
  defineProps<{
    markdown?: string;
    references?: readonly unknown[] | null;
    ns: string;
    resources?: readonly AuthorizedScientificResource[];
    embedded?: boolean;
    showActions?: boolean;
    showReferences?: boolean;
    renderingFileId?: string;
  }>(),
  {
    markdown: "",
    references: () => [],
    resources: () => [],
    embedded: false,
    showActions: true,
    showReferences: true,
  }
);

const emit = defineEmits<{
  "citation-activate": [activation: ScientificCitationActivation];
  "resource-activate": [activation: ScientificResourceActivation];
}>();

const headings = ref<ScientificHeading[]>([]);
const nestedHeadings = ref<NestedScientificHeading[]>([]);
const mainContentRef = ref<HTMLElement | null>(null);
const documentRef = ref<HTMLElement | null>(null);
let observerSetupTimer: number | null = null;

// Computed: process the reference list into formatted HTML.
// Rendering logic (incl. the v-html sanitization invariant) is extracted to
// @/utils/reference-renderer for direct unit testing.
const referenceRows = computed<readonly unknown[]>(
  () => props.references ?? []
);
const displayReferences = computed(() =>
  buildDisplayReferences(referenceRows.value, props.ns)
);
const citationNamespace = computed(() =>
  referenceRows.value.length > 0 ? props.ns : ""
);

function handleHeadings(nextHeadings: ScientificHeading[]): void {
  headings.value = nextHeadings;
  nestedHeadings.value = buildNestedHeadings(nextHeadings);
  void nextTick(() => setupIntersectionObserver()).catch(() => undefined);
}

// Download methods (extracted into a composable)
const { downloadPDF, downloadMarkdown } = useDeepGenomeDownloads({
  props,
  mainContentRef: documentRef,
  displayReferences,
});

const download: DeepGenomeViewerHandle["download"] = async (
  format: DeepGenomeDownloadFormat
) => {
  if (format === "pdf") {
    await downloadPDF();
    return;
  }

  downloadMarkdown();
};

defineExpose<DeepGenomeViewerHandle>({ download });

// TOC navigation + IntersectionObserver active tracking — extracted into a composable
const { activeHeadingId, handleNavSelect, setupIntersectionObserver } =
  useDeepGenomeToc({ headings, nestedHeadings, mainContentRef });

onMounted(() => {
  observerSetupTimer = window.setTimeout(() => {
    setupIntersectionObserver();
  }, 100);
});

onBeforeUnmount(() => {
  if (observerSetupTimer !== null) {
    window.clearTimeout(observerSetupTimer);
    observerSetupTimer = null;
  }
});
</script>

<style scoped>
.deep-genome-viewer {
  display: flex;
  align-items: flex-start;
  gap: var(--phy-space-24);
  width: 100%;
  max-width: 100%;
  min-width: 0;
  color: var(--phy-color-text);
}

.deep-genome-main {
  position: relative;
  box-sizing: border-box;
  width: 0;
  min-width: 0;
  min-height: 0;
  flex: 1 1 auto;
  padding: 0 var(--phy-space-16);
  overflow: visible;
}

.deep-genome-toolbar {
  position: sticky;
  top: 0;
  z-index: var(--phy-z-sticky);
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--phy-space-8);
  margin-bottom: var(--phy-space-16);
  padding: var(--phy-space-4) 0 var(--phy-space-12);
  overflow: visible;
  border-bottom: 1px solid var(--phy-color-border-subtle);
  background: var(--phy-color-bg-elevated);
}

.deep-genome-toolbar :deep(.el-button) {
  max-width: 100%;
  margin-left: 0;
}

.deep-genome-toolbar-button {
  color: var(--phy-color-action-text);
  border-color: var(--phy-color-border-subtle);
  background: transparent;
}

.deep-genome-toolbar-button:hover,
.deep-genome-toolbar-button:focus-visible {
  color: var(--phy-color-action-text-hover);
  border-color: var(--phy-color-border-control);
  background: var(--phy-color-fill-subtle);
}

@media (max-width: 899px) {
  .deep-genome-viewer {
    flex-direction: column;
    gap: var(--phy-space-20);
  }

  .deep-genome-main {
    width: 100%;
    flex: 1 1 auto;
    padding: 0;
  }

  .deep-genome-toolbar {
    justify-content: flex-start;
  }
}

.deep-genome-document {
  box-sizing: border-box;
  width: 100%;
  max-width: var(--phy-layout-reading-max-width);
  margin: 0 auto;
  padding: var(--phy-space-4) 0 var(--phy-space-32);
  color: var(--phy-color-text-secondary);
}

.deep-genome-document :deep(a) {
  color: var(--phy-color-action-text);
  text-decoration-thickness: 0.08em;
  text-underline-offset: 0.15em;
}

.deep-genome-document :deep(a:hover) {
  color: var(--phy-color-action-text-hover);
}

.deep-genome-document :deep(a:focus-visible) {
  outline: 2px solid var(--phy-color-focus);
  outline-offset: 2px;
  border-radius: var(--phy-radius-sm);
}

.deep-genome-document :deep(.markdown-table) {
  display: block;
  width: max-content;
  max-width: 100%;
  margin: var(--phy-space-20) 0;
  overflow-x: auto;
  overscroll-behavior-inline: contain;
  border: 0;
  border-collapse: collapse;
  scrollbar-width: thin;
}

.deep-genome-document :deep(.markdown-table th),
.deep-genome-document :deep(.markdown-table td) {
  min-width: 112px;
  padding: var(--phy-space-8) var(--phy-space-12);
  border: 1px solid var(--phy-color-border-subtle);
  color: var(--phy-color-text-secondary);
  text-align: left;
  overflow-wrap: anywhere;
}

.deep-genome-document :deep(.markdown-table th) {
  color: var(--phy-color-text);
  font-family: var(--phy-font-shell);
  font-weight: 600;
  background: var(--phy-color-fill-subtle);
}

.deep-genome-references {
  margin-top: var(--phy-space-40);
  padding-top: var(--phy-space-24);
  border-top: 1px solid var(--phy-color-border-subtle);
}

.deep-genome-heading--references {
  margin: 0 0 var(--phy-space-12);
  font-size: 20px;
}

.deep-genome-reference {
  padding: var(--phy-space-12) 0;
  border-bottom: 1px solid var(--phy-color-border-subtle);
  color: var(--phy-color-text-secondary);
  overflow-wrap: anywhere;
}

.deep-genome-reference:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}

.deep-genome-reference :deep(.doc-citation) {
  line-height: 1.6;
}

.deep-genome-reference :deep(.doi-link),
.deep-genome-reference :deep(.pmid-link) {
  color: var(--phy-color-action-text);
  text-decoration: none;
}

.deep-genome-reference :deep(.doi-link:hover),
.deep-genome-reference :deep(.pmid-link:hover) {
  color: var(--phy-color-action-text-hover);
  text-decoration: underline;
}

.deep-genome-reference :deep(.doc-link-inline) {
  margin-left: var(--phy-space-4);
}

.deep-genome-empty-references {
  margin: 0;
  padding: var(--phy-space-12) 0;
  color: var(--phy-color-text-muted);
  text-align: center;
}
</style>
