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
      <article class="deep-genome-document phy-reading" ref="documentRef">
        <div v-for="(block, index) in contentBlocks" :key="index">
          <!-- H1 document title -->
          <h1
            v-if="block.type === 'h1'"
            :id="block.id"
            class="deep-genome-title"
            v-html="block.content"
          ></h1>

          <!-- H2 section title -->
          <h2
            v-else-if="block.type === 'h2'"
            :id="block.id"
            class="deep-genome-heading deep-genome-heading--section"
            v-html="block.content"
          ></h2>

          <!-- H3 document section -->
          <section
            v-else-if="block.type === 'h3-card'"
            class="deep-genome-section"
          >
            <h3
              :id="block.id"
              class="deep-genome-section-title"
              v-html="block.header"
            ></h3>
            <div class="deep-genome-section-body" v-html="block.body"></div>
          </section>

          <!-- H4 Title -->
          <h4
            v-else-if="block.type === 'h4'"
            :id="block.id"
            class="deep-genome-subheading"
            v-html="block.content"
          ></h4>

          <!-- Standalone Content (e.g., after h1, after h2, before h3) -->
          <div
            v-else-if="block.type === 'standalone-content'"
            class="deep-genome-prose-block"
            v-html="block.content"
          ></div>
        </div>

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
            v-if="displayReferences && displayReferences.length > 0"
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
          <!-- Show an empty-references hint -->
          <p
            v-else-if="!props.references || props.references.length === 0"
            class="deep-genome-empty-references"
          >
            {{ $t("agents.deepGenome.noReferences") }}
          </p>
        </section>
      </article>
    </main>
  </div>

  <!-- Image viewer dialog -->
  <el-dialog
    v-model="imageViewerVisible"
    :title="$t('agents.deepGenome.imageViewerTitle')"
    :close-on-click-modal="true"
    :close-on-press-escape="true"
    width="min(800px, calc(100vw - var(--phy-space-32)))"
    center
  >
    <div
      class="image-view-container"
      @wheel="handleWheel"
      @mousedown="handleMouseDown"
      @mousemove="handleMouseMove"
      @mouseup="handleMouseUp"
      @mouseleave="handleMouseLeave"
      ref="containerRef"
    >
      <img
        ref="imageRef"
        :src="currentImageSrc"
        :alt="currentImageAlt"
        class="image-view-image"
      />
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from "vue";
import { ElDialog, ElButton } from "element-plus";
import DeepGenomeToc from "@/components/research/DeepGenomeToc.vue";
import type {
  DeepGenomeDownloadFormat,
  DeepGenomeViewerHandle,
} from "@/components/research/deep-genome-types";
import { useDeepGenomeDownloads } from "@/composables/useDeepGenomeDownloads";
import { useDeepGenomeImageViewer } from "@/composables/useDeepGenomeImageViewer";
import { useDeepGenomeToc } from "@/composables/useDeepGenomeToc";
import {
  parseDeepGenomeMarkdown,
  type ContentBlock,
  type Heading,
  type NestedHeading,
} from "@/utils/deep-genome-markdown";
import { buildDisplayReferences } from "@/utils/reference-renderer";

interface DeepGenome3DViewer {
  addModel(content: string, format: string): void;
  setStyle(selection: Record<string, never>, style: unknown): void;
  zoomTo(): void;
  render(): void;
  animate(): void;
  stopAnimate?(): void;
  clear?(): void;
}

interface DeepGenome3Dmol {
  createViewer(
    element: HTMLElement,
    options: { backgroundColor: string }
  ): DeepGenome3DViewer;
}

type DeepGenomeWindow = Window & { $3Dmol?: DeepGenome3Dmol };

const get3DMol = () => (window as DeepGenomeWindow).$3Dmol;

const props = withDefaults(
  defineProps<{
    markdown?: string;
    references?: readonly unknown[];
    ns?: string;
    embedded?: boolean;
    showActions?: boolean;
    showReferences?: boolean;
  }>(),
  {
    markdown: "",
    references: () => [],
    ns: "",
    embedded: false,
    showActions: true,
    showReferences: true,
  }
);

const contentBlocks = ref<ContentBlock[]>([]);
const headings = ref<Heading[]>([]);
const nestedHeadings = ref<NestedHeading[]>([]);
const mainContentRef = ref<HTMLElement | null>(null);
const documentRef = ref<HTMLElement | null>(null);
const cifAbortControllers = new Set<AbortController>();
const cifViewers = new Set<DeepGenome3DViewer>();
let observerSetupTimer: number | null = null;
let isUnmounted = false;

// Image viewer (zoom/drag/click-to-enlarge dialog) — extracted into a composable
const {
  imageViewerVisible,
  currentImageSrc,
  currentImageAlt,
  containerRef,
  imageRef,
  imageStyle,
  handleWheel,
  handleMouseDown,
  handleMouseMove,
  handleMouseUp,
  handleMouseLeave,
  setupImageClickListeners,
  cleanupImageClickListeners,
} = useDeepGenomeImageViewer();
const imageTransform = computed(() => imageStyle.value.transform);
const imageCursor = computed(() => imageStyle.value.cursor);

// Computed: process the reference list into formatted HTML.
// Rendering logic (incl. the v-html sanitization invariant) is extracted to
// @/utils/reference-renderer for direct unit testing.
const displayReferences = computed(() =>
  buildDisplayReferences(props.references, props.ns)
);

const renderCifError = (container: Element, message: string) => {
  const errorNode = document.createElement("div");
  errorNode.className = "error";
  errorNode.textContent = message;
  container.replaceChildren(errorNode);
};

// Process CIF containers
const processCifContainers = async () => {
  await nextTick();
  if (isUnmounted) return;

  // find all unprocessed CIF containers
  const cifContainers =
    documentRef.value?.querySelectorAll(
      '.cif-container[data-src$=".cif"]:not([data-processed])'
    ) ?? [];

  cifContainers.forEach((container) => {
    const src = container.getAttribute("data-src") || "";

    // mark as processed
    container.setAttribute("data-processed", "true");

    try {
      // dynamically load 3Dmol.js
      const load3DMol = () => {
        return new Promise<void>((resolve, reject) => {
          if (get3DMol()) {
            resolve();
            return;
          }

          const script = document.createElement("script");
          script.src = "/static/js/3Dmol-min.js";
          script.onload = () => {
            if (get3DMol()) {
              resolve();
            } else {
              reject(new Error("3Dmol.js loaded but $3Dmol is not defined"));
            }
          };
          script.onerror = () => {
            reject(new Error("Failed to load 3Dmol.js"));
          };
          document.head.appendChild(script);
        });
      };

      // load 3Dmol.js and render the structure
      load3DMol()
        .then(async () => {
          if (isUnmounted) return;

          // generate a unique id
          const viewerId = `cif-viewer-${Date.now()}-${Math.floor(
            Math.random() * 1000
          )}`;

          // clear the container and create the viewer element
          container.replaceChildren();
          const viewerDiv = document.createElement("div");
          viewerDiv.id = viewerId;
          viewerDiv.className = "deep-genome-cif-viewer";
          container.appendChild(viewerDiv);

          // build the file path
          let publicSrc = src;
          if (!src.startsWith("http")) {
            // ensure the path is correct
            if (!src.startsWith("/")) {
              publicSrc = `/${src}`;
            }
          }

          // create the 3Dmol viewer
          const threeDMol = get3DMol();
          if (!threeDMol) {
            throw new Error("3Dmol.js loaded but $3Dmol is not defined");
          }
          const viewer = threeDMol.createViewer(viewerDiv, {
            backgroundColor: "#f5f5f5",
          });
          cifViewers.add(viewer);

          // try loading the CIF file
          const loadCifFile = async () => {
            const controller = new AbortController();
            cifAbortControllers.add(controller);

            try {
              const response = await fetch(publicSrc, {
                signal: controller.signal,
              });
              if (!response.ok) {
                throw new Error(
                  `Failed to load CIF file: HTTP status ${response.status}`
                );
              }
              const cifContent = await response.text();
              if (isUnmounted) return;

              // add the model to the viewer
              viewer.addModel(cifContent, "cif");

              // set style and view
              viewer.setStyle({}, { cartoon: { color: "spectrum" } });
              viewer.zoomTo();
              viewer.render();
              viewer.animate();
            } catch (error) {
              if (controller.signal.aborted || isUnmounted) return;
              console.error("Error loading or rendering CIF file:", error);
              renderCifError(
                viewerDiv,
                `Failed to load or render the CIF file: ${
                  error instanceof Error ? error.message : "Unknown error"
                }`
              );
            } finally {
              cifAbortControllers.delete(controller);
            }
          };

          // run the load
          await loadCifFile();
        })
        .catch((error) => {
          if (isUnmounted) return;
          console.error("Error loading 3Dmol.js:", error);
          renderCifError(
            container,
            `Failed to load the 3Dmol.js library: ${
              error instanceof Error ? error.message : "Unknown error"
            }`
          );
        });
    } catch (error) {
      if (isUnmounted) return;
      console.error("Unexpected error processing CIF container:", error);
      renderCifError(
        container,
        `An error occurred while processing the CIF file: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  });
};

// Download methods (extracted into a composable)
const { downloadPDF, downloadMarkdown } = useDeepGenomeDownloads({
  props,
  mainContentRef,
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

// Set up the Intersection Observer in onMounted
onMounted(async () => {
  const parsed = parseDeepGenomeMarkdown(props.markdown, props.ns);
  contentBlocks.value = parsed.contentBlocks;
  headings.value = parsed.headings;
  nestedHeadings.value = parsed.nestedHeadings;

  // Use nextTick to process CIF containers and add image click handlers after the DOM updates
  await nextTick();
  await processCifContainers();
  setupImageClickListeners(documentRef.value);

  // Wait for heading elements to render, then set up the Intersection Observer
  observerSetupTimer = window.setTimeout(() => {
    setupIntersectionObserver();
  }, 100);

  // initialize the first active item
  await nextTick(() => {
    if (headings.value.length > 0) {
      // use the first heading as the initial active item
      // activeHeadingId.value = headings.value[0].id;
      // expandParentMenus(headings.value[0].id);
    }
  });
});

onBeforeUnmount(() => {
  isUnmounted = true;
  if (observerSetupTimer !== null) {
    window.clearTimeout(observerSetupTimer);
    observerSetupTimer = null;
  }
  cleanupImageClickListeners();
  cifAbortControllers.forEach((controller) => controller.abort());
  cifAbortControllers.clear();
  cifViewers.forEach((viewer) => {
    viewer.stopAnimate?.();
    viewer.clear?.();
  });
  cifViewers.clear();
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

.deep-genome-title,
.deep-genome-heading,
.deep-genome-section-title,
.deep-genome-subheading,
.deep-genome-section-body :deep(h4) {
  color: var(--phy-color-text);
  font-family: var(--phy-font-shell);
  font-weight: 600;
}

.deep-genome-title {
  margin: var(--phy-space-8) 0 var(--phy-space-32);
  font-family: var(--phy-font-shell);
  font-size: clamp(26px, 3vw, 34px);
  line-height: 1.2;
  letter-spacing: -0.02em;
}

.deep-genome-heading {
  line-height: 1.3;
}

.deep-genome-heading--section {
  margin: var(--phy-space-40) 0 var(--phy-space-20);
  padding-bottom: var(--phy-space-8);
  border-bottom: 1px solid var(--phy-color-border-subtle);
  font-size: 22px;
}

.deep-genome-section {
  margin-bottom: var(--phy-space-24);
  padding-bottom: var(--phy-space-24);
  border-bottom: 1px solid var(--phy-color-border-subtle);
}

.deep-genome-section-title {
  margin: 0 0 var(--phy-space-12);
  font-size: 18px;
  line-height: 1.4;
}

.deep-genome-subheading,
.deep-genome-section-body :deep(h4) {
  margin: var(--phy-space-20) 0 var(--phy-space-8);
  font-size: 16px;
  line-height: 1.45;
}

.deep-genome-prose-block,
.deep-genome-section-body {
  margin-bottom: var(--phy-space-24);
  color: var(--phy-color-text-secondary);
  overflow-wrap: anywhere;
}

.deep-genome-prose-block :deep(p),
.deep-genome-section-body :deep(p) {
  margin: 0 0 var(--phy-space-16);
  padding: 0;
  color: var(--phy-color-text-secondary);
}

.deep-genome-prose-block :deep(strong),
.deep-genome-section-body :deep(strong) {
  color: var(--phy-color-text);
  font-weight: 600;
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

.deep-genome-document :deep(.image-card) {
  box-sizing: border-box;
  margin: var(--phy-space-24) 0;
  padding-bottom: var(--phy-space-24);
  overflow: visible;
  border: 0;
  border-bottom: 1px solid var(--phy-color-border-subtle);
  border-radius: 0;
  background: transparent;
}

.deep-genome-document :deep(.image-card .el-card__body) {
  color: var(--phy-color-text-secondary);
  background: transparent;
}

.deep-genome-document :deep(.clickable-image) {
  max-width: 100%;
  height: auto;
}

.deep-genome-document :deep(.cif-container) {
  box-sizing: border-box;
  margin: var(--phy-space-24) 0;
  padding: var(--phy-space-20) 0;
  overflow: hidden;
  border-top: 1px solid var(--phy-color-border-subtle);
  border-bottom: 1px solid var(--phy-color-border-subtle);
  background: transparent;
}

.deep-genome-document :deep(.deep-genome-cif-viewer) {
  width: 100%;
  height: clamp(
    calc(var(--phy-space-64) * 4),
    56dvh,
    calc(var(--phy-space-64) * 9)
  );
}

.deep-genome-document :deep(figure) {
  margin: 0;
  text-align: center;
}

.deep-genome-document :deep(figcaption) {
  margin-top: var(--phy-space-8);
  color: var(--phy-color-text-muted);
  font-size: 0.9em;
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

/* Image viewer styles */
.image-view-container {
  box-sizing: border-box;
  display: flex;
  height: clamp(
    calc(var(--phy-space-64) * 4),
    60dvh,
    calc(var(--phy-space-64) * 9)
  );
  align-items: center;
  justify-content: center;
  overflow: hidden;
  cursor: grab;
  background-color: var(--phy-color-fill-subtle);
}

.image-view-image {
  display: block;
  max-width: 100%;
  max-height: 100%;
  cursor: v-bind(imageCursor);
  transform: v-bind(imageTransform);
  transform-origin: 0 0;
  transition: transform 0.2s ease;
}

/* Download dropdown styles */
.download-dropdown {
  z-index: var(--phy-z-modal) !important;
  position: fixed !important;
  top: auto !important;
  left: auto !important;
}

.download-dropdown .el-dropdown-menu {
  padding: var(--phy-space-4) 0 !important;
  border: 1px solid var(--phy-color-border-subtle) !important;
  background-color: var(--phy-color-bg-elevated) !important;
}
</style>
