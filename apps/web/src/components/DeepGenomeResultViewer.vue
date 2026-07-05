<template>
  <el-container style="height: 100vh; background: #fff; overflow: hidden">
    <!-- Sidebar navigation -->
    <el-aside
      width="400px"
      style="
        background-color: #f5f6f7 !important;
        padding: 20px 10px;
        overflow-y: auto;
      "
    >
      <h3 style="color: #000">{{ $t("help.tableOfContents") }}</h3>
      <el-menu
        :default-active="activeHeadingId"
        @select="handleNavSelect"
        :unique-opened="true"
        style="background-color: #fff !important; border-radius: 8px"
      >
        <!-- Hierarchical TOC rendering -->
        <template v-for="item in nestedHeadings" :key="item.id">
          <!-- H2 heading -->
          <el-menu-item
            v-if="
              item.level === 2 && (!item.children || item.children.length === 0)
            "
            :index="item.id"
            class="menu-level-2"
          >
            <span v-html="item.text"></span>
          </el-menu-item>

          <!-- H2 heading (with sub-headings) -->
          <el-sub-menu
            v-else-if="
              item.level === 2 && item.children && item.children.length > 0
            "
            :index="item.id"
            class="menu-level-2"
          >
            <template #title>
              <span v-html="item.text"></span>
            </template>

            <!-- H3 sub-heading -->
            <template v-for="child in item.children" :key="child.id">
              <el-menu-item
                v-if="
                  child.level === 3 &&
                  (!child.children || child.children.length === 0)
                "
                :index="child.id"
                class="menu-level-3"
              >
                <span v-html="child.text"></span>
              </el-menu-item>

              <!-- H3 sub-heading (with sub-headings) -->
              <el-sub-menu
                v-else-if="
                  child.level === 3 &&
                  child.children &&
                  child.children.length > 0
                "
                :index="child.id"
                class="menu-level-3"
              >
                <template #title>
                  <span v-html="child.text"></span>
                </template>

                <!-- H4 sub-heading -->
                <el-menu-item
                  v-for="grandChild in child.children"
                  :key="grandChild.id"
                  :index="grandChild.id"
                  class="menu-level-4"
                >
                  <span v-html="grandChild.text"></span>
                </el-menu-item>
              </el-sub-menu>
            </template>
          </el-sub-menu>

          <!-- Direct H3 or H4 heading (when there is no parent H2) -->
          <el-menu-item
            v-else-if="item.level >= 3"
            :index="item.id"
            :class="`menu-level-${item.level}`"
          >
            <span v-html="item.text"></span>
          </el-menu-item>
        </template>
      </el-menu>
    </el-aside>

    <!-- Main content area -->
    <el-main style="padding: 20px; overflow-y: auto" ref="mainContentRef">
      <!-- Download button group -->
      <div
        style="
          position: sticky;
          top: 0;
          padding: 10px 0;
          z-index: 1000;
          display: flex;
          justify-content: flex-end;
          gap: 10px;
        "
      >
        <el-button type="primary" @click="downloadPDF">
          <i class="el-icon-document"></i>
          {{ $t("agents.deepGenome.downloadPDF") }}
        </el-button>
        <el-button type="primary" @click="downloadMarkdown">
          <i class="el-icon-edit"></i>
          {{ $t("agents.deepGenome.downloadMD") }}
        </el-button>
      </div>
      <div v-for="(block, index) in contentBlocks" :key="index">
        <!-- H1 Title (centered) -->
        <h1
          v-if="block.type === 'h1'"
          :id="block.id"
          class="text-center"
          v-html="block.content"
        ></h1>

        <!-- H2 Title -->
        <h2
          v-else-if="block.type === 'h2'"
          :id="block.id"
          v-html="block.content"
        ></h2>

        <!-- H3 Card -->
        <el-card
          v-else-if="block.type === 'h3-card'"
          class="mb-20 card"
          shadow="hover"
        >
          <template #header>
            <h3 :id="block.id" v-html="block.header"></h3>
          </template>
          <!-- Render HTML containing el-card and table via v-html -->
          <div v-html="block.body"></div>
        </el-card>

        <!-- H4 Title -->
        <h4
          v-else-if="block.type === 'h4'"
          :id="block.id"
          v-html="block.content"
        ></h4>

        <!-- Standalone Content (e.g., after h1, after h2, before h3) -->
        <el-card v-else-if="block.type === 'standalone-content'" class="mb-20">
          <div v-html="block.content"></div>
        </el-card>
      </div>

      <h2>References</h2>
      <!-- References section -->
      <el-card class="mb-20 reference-card" id="section4">
        <div v-if="displayReferences && displayReferences.length > 0">
          <div
            v-for="ref in displayReferences"
            :key="ref.id"
            :id="ref.id"
            style="margin-bottom: 10px"
            v-html="ref.html"
          ></div>
        </div>
        <!-- Show an empty-references hint -->
        <div
          v-else-if="!props.references || props.references.length === 0"
          style="text-align: center; color: #999"
        >
          No references available.
        </div>
      </el-card>
    </el-main>
  </el-container>

  <!-- Image viewer dialog -->
  <el-dialog
    v-model="imageViewerVisible"
    :title="$t('agents.deepGenome.imageViewerTitle')"
    :close-on-click-modal="true"
    :close-on-press-escape="true"
    width="800px"
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
      style="
        overflow: hidden;
        cursor: grab;
        height: 600px;
        display: flex;
        align-items: center;
        justify-content: center;
      "
    >
      <img
        ref="imageRef"
        :src="currentImageSrc"
        :alt="currentImageAlt"
        class="image-view-image"
        :style="imageStyle"
      />
    </div>
  </el-dialog>
</template>

<script setup>
import { ref, computed, onMounted, nextTick } from "vue";
import {
  ElContainer,
  ElAside,
  ElMain,
  ElCard,
  ElMenu,
  ElMenuItem,
  ElSubMenu,
  ElDialog,
  ElButton,
  ElDropdown,
  ElDropdownMenu,
  ElDropdownItem,
} from "element-plus";
import { useDeepGenomeDownloads } from "@/composables/useDeepGenomeDownloads";
import { useDeepGenomeImageViewer } from "@/composables/useDeepGenomeImageViewer";
import { useDeepGenomeToc } from "@/composables/useDeepGenomeToc";
import { parseDeepGenomeMarkdown } from "@/utils/deep-genome-markdown";
import { buildDisplayReferences } from "@/utils/reference-renderer";

// Props: markdown content and the references list.
const props = defineProps({
  markdown: {
    type: String,
    default: "",
  },
  references: {
    type: Array,
    default: () => [],
  },
  ns: {
    type: String,
    default: "",
  },
});

const contentBlocks = ref([]);
const headings = ref([]);
const nestedHeadings = ref([]);
const mainContentRef = ref(null);

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
} = useDeepGenomeImageViewer();

// Computed: process the reference list into formatted HTML.
// Rendering logic (incl. the v-html sanitization invariant) is extracted to
// @/utils/reference-renderer for direct unit testing.
const displayReferences = computed(() =>
  buildDisplayReferences(props.references, props.ns)
);

// Process CIF containers
const processCifContainers = async () => {
  await nextTick();

  // find all unprocessed CIF containers
  const cifContainers = document.querySelectorAll(
    '.cif-container[data-src$=".cif"]:not([data-processed])'
  );

  cifContainers.forEach((container) => {
    const src = container.getAttribute("data-src") || "";
    const alt = container.getAttribute("data-alt") || "";

    // mark as processed
    container.setAttribute("data-processed", "true");

    try {
      // dynamically load 3Dmol.js
      const load3DMol = () => {
        return new Promise((resolve, reject) => {
          if (window.$3Dmol) {
            resolve();
            return;
          }

          const script = document.createElement("script");
          script.src = "/static/js/3Dmol-min.js";
          script.onload = () => {
            if (window.$3Dmol) {
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
        .then(() => {
          // generate a unique id
          const viewerId = `cif-viewer-${Date.now()}-${Math.floor(
            Math.random() * 1000
          )}`;

          // clear the container and create the viewer element
          container.innerHTML = "";
          const viewerDiv = document.createElement("div");
          viewerDiv.id = viewerId;
          viewerDiv.style.width = "100%";
          viewerDiv.style.height = "600px";
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
          const viewer = window.$3Dmol.createViewer(viewerDiv, {
            backgroundColor: "#f5f5f5",
          });

          // try loading the CIF file
          const loadCifFile = async () => {
            try {
              const response = await fetch(publicSrc);
              if (!response.ok) {
                throw new Error(
                  `Failed to load CIF file: HTTP status ${response.status}`
                );
              }
              const cifContent = await response.text();

              // add the model to the viewer
              viewer.addModel(cifContent, "cif");

              // set style and view
              viewer.setStyle({}, { cartoon: { color: "spectrum" } });
              viewer.zoomTo();
              viewer.render();
              viewer.animate();
            } catch (error) {
              console.error("Error loading or rendering CIF file:", error);
              viewerDiv.innerHTML = `<div class="error">Failed to load or render the CIF file: ${
                error instanceof Error ? error.message : "Unknown error"
              }</div>`;
            }
          };

          // run the load
          loadCifFile();
        })
        .catch((error) => {
          console.error("Error loading 3Dmol.js:", error);
          container.innerHTML = `<div class="error">Failed to load the 3Dmol.js library: ${error.message}</div>`;
        });
    } catch (error) {
      console.error("Unexpected error processing CIF container:", error);
      container.innerHTML = `<div class="error">An error occurred while processing the CIF file: ${
        error instanceof Error ? error.message : "Unknown error"
      }</div>`;
    }
  });
};

// Download methods (extracted into a composable)
const { downloadPDF, downloadMarkdown } = useDeepGenomeDownloads({
  props,
  mainContentRef,
  displayReferences,
});

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
  processCifContainers();
  setupImageClickListeners();

  // Wait for heading elements to render, then set up the Intersection Observer
  setTimeout(() => {
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

</script>

<style scoped>
.mb-20 {
  margin-bottom: 20px;
}
::v-deep .el-menu {
  border: none !important;
  overflow: hidden;
}
/* Sidebar menu level styles */
/* Level-1 menu (H2) - 10px indent, font-weight 600 */
.menu-level-2 {
  span {
    font-weight: 600 !important;
    color: #000 !important;
    font-size: 16px;
  }
}

.menu-level-3 span {
  font-weight: 500 !important;
  font-size: 14px;
}

.menu-level-4 span {
  font-weight: 400 !important;
  font-size: 14px;
}

::v-deep .cif-container {
  border-radius: 20px;
  padding: 10px;
  margin: 10px 0;
  background: #fff !important;
}
.theme-dark .cif-container {
  border-radius: 20px;
  background: #fff;
}

/* Sidebar menu active-state styles */
.el-menu-item.is-active {
  color: #fff !important;
  background-color: #409eff !important;
}

/* Sidebar menu item hover state */
.el-menu-item:hover {
  span {
    color: #409eff !important;
  }
}

/* Style support for the image-card class */

/* Image and caption styles */
figure {
  margin: 0;
  text-align: center;
}
figcaption {
  font-size: 0.9em;
  color: #000;
  margin-top: 0.5em;
}
.text-center {
  text-align: center;
}
.markdown-table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 1em;
}
.markdown-table th,
.markdown-table td {
  border: 1px solid #ddd;
  padding: 8px;
  text-align: left; /* default, or per alignStyle */
}
.markdown-table th {
  background-color: #f2f2f2;
  font-weight: bold;
}

h1 {
  font-size: 36px;
  font-weight: 600;
  color: #000;
  margin-bottom: 20px;
}
h2 {
  font-size: 28px;
  font-weight: 600;
  color: #000;
  margin-top: 40px;
  margin-bottom: 20px;
}
h3 {
  font-size: 24px;
  font-weight: 600;
  color: #000;
}

/* Sidebar styles under the dark theme */
.theme-dark .el-aside {
  background-color: #1f1f1f !important;
}

.theme-dark .el-menu {
  background-color: #1f1f1f !important;
}

.theme-dark .el-menu-item {
  color: #ddd !important;
}

.theme-dark .el-menu-item.is-active {
  color: #409eff !important;
  background-color: rgba(64, 158, 255, 0.1) !important;
}

/* Menu item text color under the dark theme */
.theme-dark .menu-level-2 span,
.theme-dark .menu-level-3 span,
.theme-dark .menu-level-4 span {
  color: #000 !important;
}

.theme-dark h3 {
  color: #000;
}
.card,
.el-card {
  border-radius: 16px;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.06), 0 8px 25px rgba(0, 0, 0, 0.09),
    0 2px 8px rgba(0, 0, 0, 0.05);
  box-sizing: border-box;
  border: none;
  margin-bottom: 20px;
  transition: all 0.3s ease;
  background-color: #fff;
  overflow: hidden;
  position: relative;
  z-index: 1;
}
.card:hover,
.el-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.1), 0 12px 30px rgba(0, 0, 0, 0.15),
    0 3px 10px rgba(0, 0, 0, 0.08);
}

.theme-dark .card,
.el-card {
  background-color: #1f1f1f;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2), 0 8px 25px rgba(0, 0, 0, 0.25),
    0 2px 8px rgba(0, 0, 0, 0.18);
}

.theme-dark .card:hover,
.el-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.3), 0 12px 30px rgba(0, 0, 0, 0.35),
    0 3px 10px rgba(0, 0, 0, 0.25);
}
.card ::v-deep .el-card__body,
.el-card ::v-deep .el-card__body {
  background: #f5f6f7 !important;

  h4,
  p {
    color: #000;
  }

  h4 {
    font-size: 18px;
    font-weight: 500;
    color: #000;
    margin: 20px 0 10px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    color: #000;

    th {
      background: #ccc;
      text-align: center;
    }
  }

  p {
    padding: 10px 20px;

    strong {
      font-weight: 500;
    }
  }
}
.card ::v-deep .el-card__header {
  background: #f5f6f7 !important;
}
::v-deep .el-card .el-card__body {
  background: #f5f6f7 !important;

  p,
  div {
    color: #000;
  }
}
/* Sidebar menu item text styles */
.menu-level-2 span,
.menu-level-3 span,
.menu-level-4 span {
  color: #000;
}

/* Reference styles */
.doc-citation {
  line-height: 1.6;
  margin-bottom: 10px;
}

.doi-link,
.pmid-link {
  color: #1890ff;
  text-decoration: none;
}

.doi-link:hover,
.pmid-link:hover {
  text-decoration: underline;
}

.doc-link-inline {
  margin-left: 5px;
}
::v-deep .image-card {
  border: none;
  margin: 0 60px;
  border-radius: 20px;
  overflow: hidden;

  .el-card__body {
    background: #fff !important;
  }
}
::v-deep .el-sub-menu__icon-arrow {
  color: #000;
}

/* Image viewer styles */
.image-view-container {
  background-color: #f0f0f0;
}

.image-view-image {
  max-width: 100%;
  max-height: 100%;
  transition: transform 0.2s ease;
}

.theme-dark .image-view-container {
  background-color: #1f1f1f;
}

/* Download dropdown styles */
.download-dropdown {
  z-index: 2000 !important;
  position: fixed !important;
  top: auto !important;
  left: auto !important;
}

/* ensure the main content area doesn't affect dropdown display */
.el-main {
  overflow: visible !important;
  position: relative;
}

/* ensure the sticky button container doesn't affect the dropdown */
[style*="position: sticky"] {
  overflow: visible !important;
  position: sticky;
}

/* keep the dropdown visible while preserving scrolling */
.el-container {
  overflow: hidden !important;
}
.el-aside {
  overflow-y: auto !important;
}
.el-main {
  overflow-y: auto !important;
}
[ref="mainContentRef"] {
  overflow: visible !important;
}

/* add background and border to the dropdown for visibility */
.download-dropdown .el-dropdown-menu {
  background-color: #fff !important;
  border: 1px solid #dcdfe6 !important;
  box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.1) !important;
  padding: 5px 0 !important;
}

/* ensure menu items show the active state correctly */
::v-deep .el-menu-item.is-active {
  color: #409eff !important;
  background-color: #ecf5ff !important;
}

::v-deep .el-menu-item.is-active span {
  color: #409eff !important;
}

/* improve the menu item hover effect */
::v-deep .el-menu-item:hover {
  background-color: #f5f7fa !important;
}

::v-deep .el-menu-item:hover span {
  color: #409eff !important;
}
</style>
