<template>
  <el-container style="height: 100vh; background: #fff; overflow: hidden">
    <!-- 侧边栏导航 -->
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
        <!-- 层级目录渲染 -->
        <template v-for="item in nestedHeadings" :key="item.id">
          <!-- H2 标题 -->
          <el-menu-item
            v-if="
              item.level === 2 && (!item.children || item.children.length === 0)
            "
            :index="item.id"
            class="menu-level-2"
          >
            <span v-html="item.text"></span>
          </el-menu-item>

          <!-- H2 标题（带子标题） -->
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

            <!-- H3 子标题 -->
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

              <!-- H3 子标题（带子标题） -->
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

                <!-- H4 子标题 -->
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

          <!-- 直接的 H3 或 H4 标题（当没有父 H2 时） -->
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

    <!-- 主内容区 -->
    <el-main style="padding: 20px; overflow-y: auto" ref="mainContentRef">
      <!-- 下载按钮组 -->
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
        <!-- H1 Title (居中) -->
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
          <!-- 使用 v-html 渲染包含 el-card 和 table 的 HTML -->
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
      <!-- 参考文献部分 -->
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
        <!-- 显示引用为空的提示 -->
        <div
          v-else-if="!props.references || props.references.length === 0"
          style="text-align: center; color: #999"
        >
          No references available.
        </div>
      </el-card>
    </el-main>
  </el-container>

  <!-- 图片查看器弹窗 -->
  <el-dialog
    v-model="imageViewerVisible"
    title="图片查看"
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

// 模拟从 json.txt 获取的 Markdown 内容
const props = defineProps({
  markdown: {
    type: String,
    default: "",
  },
  references: {
    type: Array,
    default: () => [],
  },
});

const contentBlocks = ref([]);
const headings = ref([]);
const nestedHeadings = ref([]);
const mainContentRef = ref(null);

// 图片查看器（缩放/拖拽/点击放大弹窗）— 已提取至 composable
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

// 计算属性：处理参考文献列表，生成格式化后的HTML
// 渲染逻辑(含 v-html 清洗不变量)抽到 @/utils/reference-renderer 直接单测。
const displayReferences = computed(() =>
  buildDisplayReferences(props.references)
);

// 处理CIF容器的函数
const processCifContainers = async () => {
  await nextTick();

  // 查找所有未处理的CIF容器
  const cifContainers = document.querySelectorAll(
    '.cif-container[data-src$=".cif"]:not([data-processed])'
  );

  cifContainers.forEach((container) => {
    const src = container.getAttribute("data-src") || "";
    const alt = container.getAttribute("data-alt") || "";

    // 标记为已处理
    container.setAttribute("data-processed", "true");

    try {
      // 动态加载3Dmol.js
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

      // 加载3Dmol.js并渲染结构
      load3DMol()
        .then(() => {
          // 生成唯一ID
          const viewerId = `cif-viewer-${Date.now()}-${Math.floor(
            Math.random() * 1000
          )}`;

          // 清空容器并创建查看器元素
          container.innerHTML = "";
          const viewerDiv = document.createElement("div");
          viewerDiv.id = viewerId;
          viewerDiv.style.width = "100%";
          viewerDiv.style.height = "600px";
          container.appendChild(viewerDiv);

          // 生成文件路径
          let publicSrc = src;
          if (!src.startsWith("http")) {
            // 确保路径正确
            if (!src.startsWith("/")) {
              publicSrc = `/${src}`;
            }
          }

          // 创建3Dmol查看器
          const viewer = window.$3Dmol.createViewer(viewerDiv, {
            backgroundColor: "#f5f5f5",
          });

          // 尝试加载CIF文件
          const loadCifFile = async () => {
            try {
              const response = await fetch(publicSrc);
              if (!response.ok) {
                throw new Error(
                  `Failed to load CIF file: HTTP status ${response.status}`
                );
              }
              const cifContent = await response.text();

              // 添加模型到查看器
              viewer.addModel(cifContent, "cif");

              // 设置样式和视图
              viewer.setStyle({}, { cartoon: { color: "spectrum" } });
              viewer.zoomTo();
              viewer.render();
              viewer.animate();
            } catch (error) {
              console.error("Error loading or rendering CIF file:", error);
              viewerDiv.innerHTML = `<div class="error">无法加载或渲染CIF文件: ${
                error instanceof Error ? error.message : "未知错误"
              }</div>`;
            }
          };

          // 执行加载
          loadCifFile();
        })
        .catch((error) => {
          console.error("Error loading 3Dmol.js:", error);
          container.innerHTML = `<div class="error">无法加载3Dmol.js库: ${error.message}</div>`;
        });
    } catch (error) {
      console.error("Unexpected error processing CIF container:", error);
      container.innerHTML = `<div class="error">处理CIF文件时发生错误: ${
        error instanceof Error ? error.message : "未知错误"
      }</div>`;
    }
  });
};

// 下载功能相关方法（已提取至 composable）
const { downloadPDF, downloadMarkdown } = useDeepGenomeDownloads({
  props,
  mainContentRef,
  displayReferences,
});

// TOC 导航 + IntersectionObserver 激活追踪 — 已提取至 composable
const { activeHeadingId, handleNavSelect, setupIntersectionObserver } =
  useDeepGenomeToc({ headings, nestedHeadings, mainContentRef });

// 在 onMounted 中设置 Intersection Observer
onMounted(async () => {
  const parsed = parseDeepGenomeMarkdown(props.markdown);
  contentBlocks.value = parsed.contentBlocks;
  headings.value = parsed.headings;
  nestedHeadings.value = parsed.nestedHeadings;

  // 使用 nextTick 确保 DOM 更新后处理 CIF 容器和添加图片点击事件
  await nextTick();
  processCifContainers();
  setupImageClickListeners();

  // 等待标题元素渲染完成后设置 Intersection Observer
  setTimeout(() => {
    setupIntersectionObserver();
  }, 100);

  // 初始化设置第一个激活项
  await nextTick(() => {
    if (headings.value.length > 0) {
      // 直接使用第一个标题作为初始激活项
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
/* 侧边栏菜单层级样式 */
/* 一级菜单 (H2) - 缩进10px, 字体粗细600 */
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

/* 侧边栏菜单激活状态样式 */
.el-menu-item.is-active {
  color: #fff !important;
  background-color: #409eff !important;
}

/* 侧边栏菜单项hover状态 */
.el-menu-item:hover {
  span {
    color: #409eff !important;
  }
}

/* 添加对 image-card 类的样式支持 */

/* 图片和图注样式 */
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
  text-align: left; /* 默认或根据 alignStyle */
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

/* 深色主题下的侧边栏样式 */
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

/* 深色主题下的菜单项文本颜色 */
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
/* 侧边栏菜单项文本样式 */
.menu-level-2 span,
.menu-level-3 span,
.menu-level-4 span {
  color: #000;
}

/* 参考文献样式 */
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

/* 图片查看器样式 */
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

/* 下载下拉菜单样式 */
.download-dropdown {
  z-index: 2000 !important;
  position: fixed !important;
  top: auto !important;
  left: auto !important;
}

/* 确保主内容区域不影响下拉菜单显示 */
.el-main {
  overflow: visible !important;
  position: relative;
}

/* 确保sticky按钮容器不影响下拉菜单 */
[style*="position: sticky"] {
  overflow: visible !important;
  position: sticky;
}

/* 确保下拉菜单可见，同时保留滚动功能 */
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

/* 为下拉菜单添加背景和边框，确保可见性 */
.download-dropdown .el-dropdown-menu {
  background-color: #fff !important;
  border: 1px solid #dcdfe6 !important;
  box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.1) !important;
  padding: 5px 0 !important;
}

/* 确保菜单项正确显示激活状态 */
::v-deep .el-menu-item.is-active {
  color: #409eff !important;
  background-color: #ecf5ff !important;
}

::v-deep .el-menu-item.is-active span {
  color: #409eff !important;
}

/* 改进菜单项的hover效果 */
::v-deep .el-menu-item:hover {
  background-color: #f5f7fa !important;
}

::v-deep .el-menu-item:hover span {
  color: #409eff !important;
}
</style>
