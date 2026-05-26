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
      <h3 style="color: #000">{{ $t('help.tableOfContents') }}</h3>
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
          {{ $t('agents.deepGenome.downloadPDF') }}
        </el-button>
        <el-button type="primary" @click="downloadMarkdown">
          <i class="el-icon-edit"></i>
          {{ $t('agents.deepGenome.downloadMD') }}
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
import { ref, computed, onMounted, onUnmounted, nextTick, reactive } from 'vue';
import {
  ElContainer,
  ElAside,
  ElMain,
  ElCard,
  ElMenu,
  ElMenuItem,
  ElSubMenu,
  ElDialog,
  ElMessage,
  ElButton,
  ElDropdown,
  ElDropdownMenu,
  ElDropdownItem
} from 'element-plus';
import { saveAs } from 'file-saver';

// 模拟从 json.txt 获取的 Markdown 内容
const props = defineProps({
  markdown: {
    type: String,
    default: ''
  },
  references: {
    type: Array,
    default: () => []
  }
});

const contentBlocks = ref([]);
const headings = ref([]);
const nestedHeadings = ref([]);
const activeHeadingId = ref('');
const mainContentRef = ref(null);

// 点击悬浮放大弹窗相关变量
const imageViewerVisible = ref(false);
const currentImageSrc = ref('');
const currentImageAlt = ref('');
const containerRef = ref(null);
const imageRef = ref(null);
const isDragging = ref(false);
const scale = ref(1);
const minScale = 1;
const maxScale = 5;
const dragStart = reactive({ x: 0, y: 0 });
const imageOffset = reactive({ x: 0, y: 0 });

// 动态样式
const imageStyle = computed(() => {
  return {
    transform: `scale(${scale.value}) translate(${imageOffset.x}px, ${imageOffset.y}px)`,
    transformOrigin: '0 0',
    cursor: isDragging.value ? 'grabbing' : 'grab',
    display: 'block',
    transition: 'transform 0.2s ease'
  };
});

const jumpTo = (id) => {
  const element = document.getElementById(id);
  if (element) {
    // 使用 nextTick 确保 DOM 更新后再滚动
    nextTick(() => {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }
};

const handleNavSelect = (index) => {
  jumpTo(index);
};

// 格式化参考文献的函数
const formatDetailedCitation = (doc) => {
  const parts = [];

  // 作者
  if (doc.au) {
    parts.push(doc.au);
  }

  // 标题
  if (doc.ti) {
    // 移除HTML标签
    const cleanTitle = doc.ti.replace(/<[^>]*>/g, '');
    parts.push('"' + cleanTitle + '"');
  }

  // 期刊名称
  if (doc.so) {
    parts.push(doc.so);
  }

  // 卷号、页码和年份组合
  let volumePageYear = '';
  if (doc.vl) {
    if (doc.bp && doc.ep) {
      volumePageYear = `${doc.vl}, ${doc.bp}-${doc.ep}`;
    } else if (doc.bp) {
      volumePageYear = `${doc.vl}, ${doc.bp}`;
    } else {
      volumePageYear = doc.vl;
    }
  } else if (doc.bp && doc.ep) {
    volumePageYear = `${doc.bp}-${doc.ep}`;
  }

  // 添加年份（用括号包围）
  if (doc.py) {
    if (volumePageYear) {
      volumePageYear += `, (${doc.py})`;
    } else {
      volumePageYear = `(${doc.py})`;
    }
  }

  if (volumePageYear) {
    parts.push(volumePageYear);
  }

  return parts.join('. ');
};

// 计算属性：处理参考文献列表，生成格式化后的HTML
const displayReferences = computed(() => {
  if (!props.references || props.references.length === 0) {
    return [];
  }

  return props.references.map((doc, index) => {
    const refIndex = index + 1;

    if (doc.title) {
      return {
        html: `<div>${refIndex}. ${doc.title}</div>`,
        id: `ref-${refIndex}`
      };
    } else if (doc.au || doc.ti) {
      const citation = formatDetailedCitation(doc);

      // 构建 DOI 和 PMID 链接部分
      let linkPart = '';
      const hasLink = doc.dl || doc.pm;

      if (hasLink) {
        const doiLink = doc.dl
          ? `doi:<a href="${doc.dl}" target="_blank" class="doi-link">${doc.dl}</a>`
          : '';
        const pmidLink = doc.pm
          ? `pmid:<a href="https://pubmed.ncbi.nlm.nih.gov/${doc.pm}" target="_blank" class="pmid-link">${doc.pm}</a>`
          : '';

        const separator = doc.dl && doc.pm ? '; ' : '';

        linkPart = `. <span class="doc-link-inline">${doiLink}</span><span>${separator}</span><span class="doc-link-inline">${pmidLink}</span>`;
      }

      return {
        html: `<div class="doc-citation">${refIndex}. ${citation}${linkPart}</div>`,
        id: `ref-${refIndex}`
      };
    } else {
      // 处理普通字符串类型的引用
      if (typeof doc === 'string') {
        return {
          html: `<div>${refIndex}. ${doc}</div>`,
          id: `ref-${refIndex}`
        };
      }

      // 默认情况
      return {
        html: `<div>${refIndex}. ${JSON.stringify(doc)}</div>`,
        id: `ref-${refIndex}`
      };
    }
  });
});

// --- Markdown 转换辅助函数 ---
const escapeHtml = (text) => {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
};

// AnalystAgent 返回的 markdown 把图片/链接写成 ./.out/xxxx,前端转换为可
// 访问的 attachment URL。base prefix 走 Vite env (VITE_ATTACHMENTS_BASE_URL),
// 默认相对路径 /attachments/ —— dev 时让 vite proxy / 同源 nginx 接管,
// production 想跨域指向独立 attachments 服务,在 .env.production 改 key 即可,
// 不要把 prod host 硬编进源码。
const attachmentsBaseUrl =
  import.meta.env.VITE_ATTACHMENTS_BASE_URL || '/attachments/';

const convertFilePath = (path) => {
  if (!path) return path;
  if (path.includes('.out/')) {
    return path.replace(/\.?\/?\.out\//g, attachmentsBaseUrl);
  }
  return path;
};

const processInlineMarkdown = (line) => {
  if (!line) return line;

  // 调试：检测包含 Protocol Details 的行
  if (line.includes('Protocol Details') || line.includes('&lt;a')) {
    console.log('Processing line with a tag:', line);
  }

  // 先恢复被转义的 HTML <a> 标签（支持各种属性组合）
  // 匹配模式：&lt;a href=&quot;...&quot; ... &gt;...&lt;/a&gt;
  // 使用更宽松的匹配模式来处理包含HTML实体的属性
  line = line.replace(
    /&lt;a\s+(.*?)&gt;(.*?)&lt;\/a&gt;/g,
    function (match, attributes, text) {
      console.log('Found a tag match:', { match, attributes, text });
      // 恢复属性中的转义字符
      attributes = attributes
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&amp;/g, '&');

      // 转换路径（如果 href 属性存在）
      attributes = attributes.replace(
        /href=["']([^"']+)["']/g,
        function (attrMatch, url) {
          const convertedUrl = convertFilePath(url);
          return `href="${convertedUrl}"`;
        }
      );

      const result = `<a ${attributes}>${text}</a>`;
      console.log('Converted to:', result);
      return result;
    }
  );

  if (line.includes('Protocol Details')) {
    console.log('After a tag processing:', line);
  }

  // 先处理.cif格式的图片
  line = line.replace(/!\[(.*?)\]\((.*?\.cif)\)/g, function (match, alt, src) {
    const convertedSrc = convertFilePath(src);
    return (
      '<div class="cif-container" data-src="' +
      convertedSrc +
      '" data-alt="' +
      alt +
      '"></div>'
    );
  });
  // 处理其他格式的图片
  line = line.replace(
    /!\[(.*?)\]\((?!.*\.cif)(.*?)\)/g,
    function (match, alt, src) {
      const convertedSrc = convertFilePath(src);
      return (
        '<img src="' +
        convertedSrc +
        '" alt="' +
        alt +
        '" style="max-width: 100%; height: auto; cursor: zoom-in;" class="clickable-image" data-src="' +
        convertedSrc +
        '" data-alt="' +
        alt +
        '">'
      );
    }
  );
  // 处理 .md 链接
  line = line.replace(
    /\[([^\]]+?)\]\(([^)]+?\.md)\)/g,
    function (match, text, url) {
      const convertedUrl = convertFilePath(url);
      return (
        '<a href="' +
        convertedUrl +
        '" target="_blank" download>' +
        text +
        '</a>'
      );
    }
  );
  // 处理 .cif 链接
  line = line.replace(/\[([^\]]+?)\]\(([^)]+?\.cif)\)/g, (_, text, url) => {
    // 转换路径
    const cleanUrl = convertFilePath(url);
    return `<div class="cif-container" data-src="${cleanUrl}" data-alt="${text}">${text} (CIF 文件)</div>`;
  });
  // 处理参考文献引用，确保引用不单独占行
  line = line.replace(
    /\[(\d{1,2})\]/g,
    '<a href="#ref-$1" @click.prevent="jumpTo(\'ref-$1\')" style="display: inline-block;">[$1]</a>'
  );
  // 处理粗体
  line = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  line = line.replace(/\*(.*?)\*/g, '<em>$1</em>');
  // 处理斜体 (改进版，避免与列表混淆)
  line = line.replace(/(^|\s)\*([^*]+?)\*(?=\s|$|[.,;:!?])/g, '$1<em>$2</em>');
  // 处理行内代码
  line = line.replace(/`(.*?)`/g, '<code>$1</code>');

  return line;
};

// 处理CIF容器的函数
const processCifContainers = async () => {
  console.log('processCifContainers function called');
  await nextTick();

  // 查找所有未处理的CIF容器
  const cifContainers = document.querySelectorAll(
    '.cif-container[data-src$=".cif"]:not([data-processed])'
  );

  console.log(`Found ${cifContainers.length} unprocessed CIF containers`);

  cifContainers.forEach((container) => {
    const src = container.getAttribute('data-src') || '';
    const alt = container.getAttribute('data-alt') || '';

    // 标记为已处理
    container.setAttribute('data-processed', 'true');

    try {
      // 动态加载3Dmol.js
      const load3DMol = () => {
        return new Promise((resolve, reject) => {
          if (window.$3Dmol) {
            console.log('3Dmol.js already loaded');
            resolve();
            return;
          }

          const script = document.createElement('script');
          script.src = '/static/js/3Dmol-min.js';
          script.onload = () => {
            if (window.$3Dmol) {
              console.log('3Dmol.js loaded successfully');
              resolve();
            } else {
              reject(new Error('3Dmol.js loaded but $3Dmol is not defined'));
            }
          };
          script.onerror = () => {
            reject(new Error('Failed to load 3Dmol.js'));
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
          container.innerHTML = '';
          const viewerDiv = document.createElement('div');
          viewerDiv.id = viewerId;
          viewerDiv.style.width = '100%';
          viewerDiv.style.height = '600px';
          container.appendChild(viewerDiv);

          // 生成文件路径
          let publicSrc = src;
          if (!src.startsWith('http')) {
            // 确保路径正确
            if (!src.startsWith('/')) {
              publicSrc = `/${src}`;
            }
          }

          console.log('Attempting to load CIF file from:', publicSrc);

          // 创建3Dmol查看器
          const viewer = window.$3Dmol.createViewer(viewerDiv, {
            backgroundColor: '#f5f5f5'
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
              viewer.addModel(cifContent, 'cif');

              // 设置样式和视图
              viewer.setStyle({}, { cartoon: { color: 'spectrum' } });
              viewer.zoomTo();
              viewer.render();
              viewer.animate();

              console.log('CIF file loaded and rendered successfully');
            } catch (error) {
              console.error('Error loading or rendering CIF file:', error);
              viewerDiv.innerHTML = `<div class="error">无法加载或渲染CIF文件: ${
                error instanceof Error ? error.message : '未知错误'
              }</div>`;
            }
          };

          // 执行加载
          loadCifFile();
        })
        .catch((error) => {
          console.error('Error loading 3Dmol.js:', error);
          container.innerHTML = `<div class="error">无法加载3Dmol.js库: ${error.message}</div>`;
        });
    } catch (error) {
      console.error('Unexpected error processing CIF container:', error);
      container.innerHTML = `<div class="error">处理CIF文件时发生错误: ${
        error instanceof Error ? error.message : '未知错误'
      }</div>`;
    }
  });
};

// --- 转换逻辑 ---
const convertMarkdown = (text) => {
  const lines = text.split('\\n'); // 正确分割行
  console.log(lines.length);
  const blocks = [];
  let currentH3CardContent = '';
  let currentH3CardHeader = '';
  let currentH3CardId = '';
  let isInH3Card = false;
  let tempContentAfterH2 = '';
  let isInStandaloneContentAfterH2 = false;

  let tempContentAfterH1 = '';
  let isInStandaloneContentAfterH1 = false;

  let isInTable = false;
  let tableHeaders = [];
  let tableAlignments = [];
  let tableRows = [];

  let headingCounter = 1;

  const headingsList = [];

  const createHeadingId = (prefix = 'heading') => {
    return `${prefix}-${headingCounter++}`;
  };

  // --- 新增：将表格行转换为 HTML 字符串的函数 ---
  const generateTableHtml = (headers, alignments, rows) => {
    let html = '<table border="1" class="markdown-table"><thead><tr>';
    headers.forEach((header, index) => {
      // 根据 alignments 设置 th 的样式
      let alignStyle = '';
      const align = alignments[index] ? alignments[index].trim() : '';
      if (align.startsWith(':') && align.endsWith(':')) {
        alignStyle = ' style="text-align: center;"';
      } else if (align.endsWith(':')) {
        alignStyle = ' style="text-align: right;"';
      } else if (align.startsWith(':')) {
        // 默认左对齐，通常不需要显式设置，但可以加上
        alignStyle = ' style="text-align: left;"';
      } else {
        // 默认左对齐
        alignStyle = ' style="text-align: left;"';
      }
      html += `<th${alignStyle}>${header}</th>`;
    });
    html += '</tr></thead><tbody>';
    rows.forEach((row) => {
      html += '<tr>';
      row.forEach((cell) => {
        html += `<td>${cell}</td>`;
      });
      html += '</tr>';
    });
    html += '</tbody></table>';
    return html;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const isTableDelimiter = (l) => {
      return (
        /^\s*\|.*\|.*\|\s*$/.test(l) && l.replace(/\s/g, '').includes('|-')
      );
    };

    const isTableContent = (l) => {
      return /^\s*\|.*\|.*\|\s*$/.test(l);
    };

    // 标记当前行是否为表格行并已处理
    let isTableRowProcessed = false;

    // --- 修改：处理表格逻辑 ---
    if (
      !isInTable &&
      isTableContent(line) &&
      i + 1 < lines.length &&
      isTableDelimiter(lines[i + 1])
    ) {
      isInTable = true;

      const headerCells = line
        .split('|')
        .map((cell) => cell.trim())
        .filter((cell) => cell.length > 0);
      tableHeaders = headerCells.map((cell) =>
        processInlineMarkdown(escapeHtml(cell))
      );

      i++; // 跳过分隔符行
      const alignmentLine = lines[i];
      tableAlignments = alignmentLine
        .split('|')
        .map((cell) => cell.trim())
        .filter((cell) => cell.length > 0);

      tableRows = [];
      isTableRowProcessed = true; // 标记表头行已处理
      continue; // Skip to next line
    } else if (isInTable) {
      if (isTableContent(line)) {
        const dataCells = line
          .split('|')
          .map((cell) => cell.trim())
          .filter((cell) => cell.length > 0);
        const processedRow = dataCells.map((cell) =>
          processInlineMarkdown(escapeHtml(cell))
        );
        tableRows.push(processedRow);
        isTableRowProcessed = true; // 标记表格数据行已处理
      } else {
        // 表格结束
        const tableHtml = generateTableHtml(
          tableHeaders,
          tableAlignments,
          tableRows
        );

        // 将表格 HTML 添加到当前上下文
        if (isInH3Card) {
          currentH3CardContent += tableHtml;
        } else if (isInStandaloneContentAfterH2) {
          tempContentAfterH2 += tableHtml;
        } else if (isInStandaloneContentAfterH1) {
          tempContentAfterH1 += tableHtml;
        }

        // 重置表格状态
        isInTable = false;
        tableHeaders = [];
        tableAlignments = [];
        tableRows = [];

        // 继续处理当前行（因为它不是表格行）
        // 使用标志来标记当前行是否已经处理
        let currentLineProcessed = false;

        if (/^####\s(.*)/.test(line)) {
          const match = line.match(/^####\s(.*)/);
          const content = processInlineMarkdown(escapeHtml(match[1]));
          const id = createHeadingId('h4');
          headingsList.push({ id, text: content, level: 4 });
          if (isInH3Card) {
            currentH3CardContent += `<h4 id="${id}">${content}</h4>`;
          } else {
            blocks.push({ type: 'h4', id, content });
          }
          currentLineProcessed = true;
        } else if (/^###\s(.*)/.test(line)) {
          if (isInH3Card) {
            blocks.push({
              type: 'h3-card',
              id: currentH3CardId,
              header: currentH3CardHeader,
              body: currentH3CardContent
            });
            isInH3Card = false;
            currentH3CardContent = '';
            currentH3CardHeader = '';
            currentH3CardId = '';
          }

          if (isInStandaloneContentAfterH2 && tempContentAfterH2) {
            blocks.push({
              type: 'standalone-content',
              content: tempContentAfterH2
            });
            isInStandaloneContentAfterH2 = false;
            tempContentAfterH2 = '';
          }

          const match = line.match(/^###\s(.*)/);
          const content = processInlineMarkdown(escapeHtml(match[1]));
          currentH3CardId = createHeadingId('h3');
          currentH3CardHeader = content;
          currentH3CardContent = '';
          isInH3Card = true;
          headingsList.push({
            id: currentH3CardId,
            text: currentH3CardHeader,
            level: 3
          });
          currentLineProcessed = true;
        } else if (/^##\s(.*)/.test(line)) {
          const match = line.match(/^##\s(.*)/);
          const content = processInlineMarkdown(escapeHtml(match[1]));
          const id = createHeadingId('h2');
          headingsList.push({ id, text: content, level: 2 });

          if (isInStandaloneContentAfterH1 && tempContentAfterH1) {
            blocks.push({
              type: 'standalone-content',
              content: tempContentAfterH1
            });
            isInStandaloneContentAfterH1 = false;
            tempContentAfterH1 = '';
          }

          if (isInH3Card) {
            blocks.push({
              type: 'h3-card',
              id: currentH3CardId,
              header: currentH3CardHeader,
              body: currentH3CardContent
            });
            isInH3Card = false;
            currentH3CardContent = '';
            currentH3CardHeader = '';
            currentH3CardId = '';
          }

          blocks.push({ type: 'h2', id, content });
          isInStandaloneContentAfterH2 = true;
          currentLineProcessed = true;
        } else if (/^#\s(.*)/.test(line)) {
          const match = line.match(/^#\s(.*)/);
          const content = processInlineMarkdown(escapeHtml(match[1]));
          const id = createHeadingId('h1');
          headingsList.push({ id, text: content, level: 1 });

          if (isInH3Card) {
            blocks.push({
              type: 'h3-card',
              id: currentH3CardId,
              header: currentH3CardHeader,
              body: currentH3CardContent
            });
            isInH3Card = false;
            currentH3CardContent = '';
            currentH3CardHeader = '';
            currentH3CardId = '';
          }
          if (isInStandaloneContentAfterH2 && tempContentAfterH2) {
            blocks.push({
              type: 'standalone-content',
              content: tempContentAfterH2
            });
            isInStandaloneContentAfterH2 = false;
            tempContentAfterH2 = '';
          }
          isInStandaloneContentAfterH1 = true;
          tempContentAfterH1 = '';

          blocks.push({ type: 'h1', id, content });
          currentLineProcessed = true;
        } else {
          // 处理表格结束后紧跟的普通文本行
          const processedLineContent = `<p>${processInlineMarkdown(
            escapeHtml(line)
          )}</p>`;
          const isLineContentEmpty = line.trim() === '';

          if (isInH3Card) {
            if (!isLineContentEmpty) {
              currentH3CardContent += processedLineContent;
            }
          } else if (isInStandaloneContentAfterH2) {
            if (!isLineContentEmpty) {
              tempContentAfterH2 += processedLineContent;
            }
          } else if (isInStandaloneContentAfterH1) {
            if (!isLineContentEmpty) {
              tempContentAfterH1 += processedLineContent;
            }
          }
          currentLineProcessed = true; // 即使是空行，也算作已处理
        }

        // 如果当前行已经被处理，则跳过本次循环的剩余部分
        if (currentLineProcessed) {
          continue;
        }
      }
    }

    // 如果是表格行并且已经处理过，则跳过后续处理
    if (isTableRowProcessed) {
      continue;
    }
    // --- 表格处理逻辑结束 ---

    // --- 其他内容处理逻辑 ---
    if (/^####\s(.*)/.test(line)) {
      const match = line.match(/^####\s(.*)/);
      const content = processInlineMarkdown(escapeHtml(match[1]));
      const id = createHeadingId('h4');
      headingsList.push({ id, text: content, level: 4 });
      if (isInH3Card) {
        currentH3CardContent += `<h4 id="${id}">${content}</h4>`;
      } else {
        blocks.push({ type: 'h4', id, content });
      }
    } else if (/^###\s(.*)/.test(line)) {
      if (isInH3Card) {
        blocks.push({
          type: 'h3-card',
          id: currentH3CardId,
          header: currentH3CardHeader,
          body: currentH3CardContent
        });
        isInH3Card = false;
        currentH3CardContent = '';
        currentH3CardHeader = '';
        currentH3CardId = '';
      }

      if (isInStandaloneContentAfterH2 && tempContentAfterH2) {
        blocks.push({
          type: 'standalone-content',
          content: tempContentAfterH2
        });
        isInStandaloneContentAfterH2 = false;
        tempContentAfterH2 = '';
      }

      const match = line.match(/^###\s(.*)/);
      const content = processInlineMarkdown(escapeHtml(match[1]));
      currentH3CardId = createHeadingId('h3');
      currentH3CardHeader = content;
      currentH3CardContent = '';
      isInH3Card = true;
      headingsList.push({
        id: currentH3CardId,
        text: currentH3CardHeader,
        level: 3
      });
    } else if (/^##\s(.*)/.test(line)) {
      const match = line.match(/^##\s(.*)/);
      const content = processInlineMarkdown(escapeHtml(match[1]));
      const id = createHeadingId('h2');
      headingsList.push({ id, text: content, level: 2 });

      if (isInStandaloneContentAfterH1 && tempContentAfterH1) {
        blocks.push({
          type: 'standalone-content',
          content: tempContentAfterH1
        });
        isInStandaloneContentAfterH1 = false;
        tempContentAfterH1 = '';
      }

      if (isInH3Card) {
        blocks.push({
          type: 'h3-card',
          id: currentH3CardId,
          header: currentH3CardHeader,
          body: currentH3CardContent
        });
        isInH3Card = false;
        currentH3CardContent = '';
        currentH3CardHeader = '';
        currentH3CardId = '';
      }

      // 在添加新的h2标题前，先处理之前的h2后独立内容
      if (isInStandaloneContentAfterH2 && tempContentAfterH2) {
        blocks.push({
          type: 'standalone-content',
          content: tempContentAfterH2
        });
        isInStandaloneContentAfterH2 = false;
        tempContentAfterH2 = '';
      }

      blocks.push({ type: 'h2', id, content });
      isInStandaloneContentAfterH2 = true;
    } else if (/^#\s(.*)/.test(line)) {
      const match = line.match(/^#\s(.*)/);
      const content = processInlineMarkdown(escapeHtml(match[1]));
      const id = createHeadingId('h1');
      headingsList.push({ id, text: content, level: 1 });

      if (isInH3Card) {
        blocks.push({
          type: 'h3-card',
          id: currentH3CardId,
          header: currentH3CardHeader,
          body: currentH3CardContent
        });
        isInH3Card = false;
        currentH3CardContent = '';
        currentH3CardHeader = '';
        currentH3CardId = '';
      }
      if (isInStandaloneContentAfterH2 && tempContentAfterH2) {
        blocks.push({
          type: 'standalone-content',
          content: tempContentAfterH2
        });
        isInStandaloneContentAfterH2 = false;
        tempContentAfterH2 = '';
      }
      isInStandaloneContentAfterH1 = true;
      tempContentAfterH1 = '';

      blocks.push({ type: 'h1', id, content });
    } else {
      // 处理普通段落、图片、链接等
      const processedLineContent = `<p>${processInlineMarkdown(
        escapeHtml(line)
      )}</p>`;
      const isLineContentEmpty = line.trim() === '';

      // 检查当前行是否包含图片
      const imageMatch = line.match(/!\[(.*?)\]\((.*?)\)/);

      if (imageMatch) {
        let imageHtml = '';

        if (line.match(/!\[(.*?)\]\((.*\.cif)\)/)) {
          // 转换CIF文件路径
          const convertedSrc = convertFilePath(imageMatch[2]);
          imageHtml = `<div class="cif-container" data-src="${convertedSrc}" data-alt="${imageMatch[1]}"></div>`;
        } else {
          // 转换图片路径
          const convertedSrc = convertFilePath(imageMatch[2]);
          imageHtml = `<div style="text-align: center;width: 100%"><img src="${convertedSrc}" alt="${imageMatch[1]}" style="width: 70%; height: auto; cursor: zoom-in;" class="clickable-image" data-src="${convertedSrc}" data-alt="${imageMatch[1]}"></div>`;
        }
        // 创建图片HTML

        let captionHtml = '';

        // 检查图片后的行是否包含图注（处理空行问题）
        // 寻找图片后第一个非空行作为图注
        let j = i + 1;
        while (j < lines.length && lines[j].trim() === '') {
          j++;
        }

        // 如果找到了非空行，认为它是图注
        if (j < lines.length) {
          const captionLine = lines[j];
          // 提取图注文本，保留所有内容
          let captionText = captionLine.trim();
          // 对图注文本应用Markdown处理，确保**被转换为strong标签
          captionText = processInlineMarkdown(captionText);
          // 生成图注HTML
          captionHtml = `<p style="text-align: center; margin-top: 8px;">${captionText}</p>`;
          // 跳过从i+1到j的所有行（包括空行和图注行）
          i = j;
        }

        // 生成包含图片和图注的el-card结构
        const imageCardHtml = `<div class="mb-20 image-card" shadow="hover">
              <div class="el-card__body" style="padding: 16px;">
                  <div style="text-align: center;">
                      ${imageHtml}
                      ${captionHtml}
                  </div>
              </div>
          </div>`;

        // 根据当前上下文添加图片卡片
        if (isInStandaloneContentAfterH1) {
          tempContentAfterH1 += imageCardHtml;
        } else if (isInH3Card) {
          currentH3CardContent += imageCardHtml;
        } else if (isInStandaloneContentAfterH2) {
          tempContentAfterH2 += imageCardHtml;
        }
      } else {
        // 不是图片，按常规方式处理
        if (isInStandaloneContentAfterH1 && !isLineContentEmpty) {
          tempContentAfterH1 += processedLineContent;
        } else if (isInH3Card && !isLineContentEmpty) {
          currentH3CardContent += processedLineContent;
        } else if (isInStandaloneContentAfterH2 && !isLineContentEmpty) {
          tempContentAfterH2 += processedLineContent;
        }
      }
    }
  }

  // --- 循环结束后处理剩余状态 ---
  // 处理可能在文件末尾未关闭的表格
  if (isInTable) {
    const tableHtml = generateTableHtml(
      tableHeaders,
      tableAlignments,
      tableRows
    );
    if (isInH3Card) {
      currentH3CardContent += tableHtml;
    } else if (isInStandaloneContentAfterH2) {
      tempContentAfterH2 += tableHtml;
    } else if (isInStandaloneContentAfterH1) {
      tempContentAfterH1 += tableHtml;
    }
  }

  if (isInStandaloneContentAfterH1 && tempContentAfterH1) {
    blocks.push({ type: 'standalone-content', content: tempContentAfterH1 });
  }
  if (isInH3Card && currentH3CardHeader) {
    blocks.push({
      type: 'h3-card',
      id: currentH3CardId,
      header: currentH3CardHeader,
      body: currentH3CardContent
    });
  }
  if (isInStandaloneContentAfterH2 && tempContentAfterH2) {
    // 确保每个h2后面的内容都作为单独的el-card处理
    blocks.push({ type: 'standalone-content', content: tempContentAfterH2 });
  }

  contentBlocks.value = blocks;
  headings.value = headingsList;

  // 将扁平的标题列表转换为嵌套结构
  nestedHeadings.value = buildNestedHeadings(headingsList);

  // 辅助函数：构建嵌套标题结构
  function buildNestedHeadings(flatHeadings) {
    const nested = [];
    const stack = [];

    flatHeadings.forEach((heading) => {
      // 只处理 h2, h3, h4 标题
      if (heading.level < 2 || heading.level > 4) {
        return;
      }

      // 移除栈中所有比当前标题层级高的标题
      while (
        stack.length > 0 &&
        stack[stack.length - 1].level >= heading.level
      ) {
        stack.pop();
      }

      // 创建新标题对象（深拷贝避免修改原始数据）
      const newHeading = { ...heading, children: [] };

      // 如果栈为空，添加到根节点
      if (stack.length === 0) {
        nested.push(newHeading);
      } else {
        // 否则添加到父节点的 children 数组
        stack[stack.length - 1].children.push(newHeading);
      }

      // 将当前标题推入栈中
      stack.push(newHeading);
    });

    return nested;
  }
};

// 下载功能相关方法
// 下载功能相关方法
const downloadPDF = async () => {
  // 创建打印容器
  const printContainer = document.createElement('div');
  printContainer.id = 'print-container';
  printContainer.style.position = 'absolute';
  printContainer.style.top = '0';
  printContainer.style.left = '0';
  printContainer.style.width = '100%';
  printContainer.style.height = 'auto';
  printContainer.style.backgroundColor = '#fff';
  printContainer.style.zIndex = '9999';
  printContainer.style.padding = '20px';
  printContainer.style.display = 'none';
  printContainer.style.boxSizing = 'border-box';

  // 复制当前内容
  const contentWrapper = document.createElement('div');
  contentWrapper.style.maxWidth = '210mm';
  contentWrapper.style.margin = '0 auto';
  contentWrapper.style.fontSize = '12pt';
  contentWrapper.style.pageBreakInside = 'auto';
  contentWrapper.style.overflow = 'visible';
  contentWrapper.style.height = 'auto';

  // 复制所有内容块
  const contentBlocksCopy = document.createElement('div');
  contentBlocksCopy.style.pageBreakInside = 'auto';
  contentBlocksCopy.style.overflow = 'visible';
  contentBlocksCopy.style.height = 'auto';

  // 直接获取el-main内部的所有内容（不包括el-main本身）
  const originalElMain = mainContentRef.value.$el;
  const contentInsideElMain = document.createElement('div');

  // 克隆el-main内部的所有子节点
  for (let i = 0; i < originalElMain.children.length; i++) {
    const childClone = originalElMain.children[i].cloneNode(true);
    contentInsideElMain.appendChild(childClone);
  }

  // 移除下载按钮组（通过更精确的选择器）
  const downloadButtonGroup = contentInsideElMain.querySelector(
    'div[style*="position: sticky"]'
  );
  if (downloadButtonGroup) {
    downloadButtonGroup.remove();
  }

  // 移除所有可能影响打印的高度限制和溢出设置
  const allElements = contentInsideElMain.querySelectorAll('*');
  allElements.forEach((element) => {
    // 移除内联样式中的高度和溢出限制
    element.style.height = 'auto';
    element.style.maxHeight = 'none';
    element.style.overflow = 'visible';
    element.style.minHeight = 'auto';
    element.style.position = 'static';
  });

  contentBlocksCopy.appendChild(contentInsideElMain);
  contentWrapper.appendChild(contentBlocksCopy);
  printContainer.appendChild(contentWrapper);

  // 添加到文档
  document.body.appendChild(printContainer);

  // 显示打印容器
  printContainer.style.display = 'block';

  // 等待所有内容渲染完成
  await nextTick();

  // 添加打印样式
  const style = document.createElement('style');
  style.innerHTML = `
    @media print {
      /* 基本打印设置 */
      body * { display: none; }
      #print-container { display: block !important; position: static !important; }
      
      /* 确保print-container内的所有元素都显示 */
      #print-container * {
        display: block !important;
      }
      
      /* 确保内联元素正常显示 */
      #print-container span,
      #print-container a,
      #print-container strong,
      #print-container em,
      #print-container code,
      #print-container b {
        display: inline !important;
      }
      
      /* 修复表格显示问题 - 确保表格正确布局 */
      #print-container table {
        display: table !important;
        width: 100% !important;
        border-collapse: collapse !important;
        margin: 1em 0 !important;
      }
      
      #print-container thead {
        display: table-header-group !important;
      }
      
      #print-container tbody {
        display: table-row-group !important;
      }
      
      #print-container tr {
        display: table-row !important;
        page-break-inside: avoid !important;
      }
      
      #print-container th,
      #print-container td {
        display: table-cell !important;
        padding: 8px !important;
        border: 1px solid #ddd !important;
        text-align: left !important;
        vertical-align: top !important;
      }
      
      #print-container th {
        background-color: #f5f5f5 !important;
        font-weight: bold !important;
      }
      
      /* 移除所有可能影响打印的高度限制和溢出设置 */
      * {
        height: auto !important;
        max-height: none !important;
        overflow: visible !important;
        min-height: auto !important;
        position: static !important;
      }
      
      /* 强制分页设置 */
      #print-container {
        page-break-before: avoid;
        page-break-after: avoid;
      }
      
      /* 避免在不合适的地方分页 */
      h1, h2, h3, h4 {
        page-break-after: avoid;
        page-break-inside: avoid;
      }
      
      .el-card, .card, table, img, p {
        page-break-inside: avoid;
      }
      
      /* 确保图片正确显示 */
      img {
        max-width: 100% !important;
        height: auto !important;
      }
      
      /* 修复参考文献编号显示问题 */
      #print-container a[href^="#ref-"] {
        display: inline-block !important;
      }
      
      /* 确保内容可以正确分页显示多页 */
      #print-container, 
      #print-container > div, 
      #print-container .content-wrapper,
      #print-container .content-blocks-copy {
        page-break-inside: auto;
        box-sizing: border-box;
        float: none !important;
      }
    }
  `;
  document.head.appendChild(style);

  // 触发打印
  try {
    await window.print();
  } catch (error) {
    ElMessage.error('打印失败');
    console.error('打印错误:', error);
  }

  // 移除打印容器
  document.body.removeChild(printContainer);
};

const downloadMarkdown = () => {
  // 创建转换后的Markdown内容
  let convertedMarkdown = props.markdown;

  // 处理换行符 - 将转义的\n转换为实际的换行符
  convertedMarkdown = convertedMarkdown.replace(/\\n/g, '\n');

  // 转换图片路径
  convertedMarkdown = convertedMarkdown.replace(
    /!\[(.*?)\]\((.*?)\)/g,
    (match, alt, src) => {
      const convertedSrc = convertFilePath(src);
      return `![${alt}](${convertedSrc})`;
    }
  );

  // 转换链接路径
  convertedMarkdown = convertedMarkdown.replace(
    /\[([^\]]+?)\]\(([^)]+?)\)/g,
    (match, text, url) => {
      // 跳过已经是http/https开头的链接
      if (url.startsWith('http://') || url.startsWith('https://')) {
        return match;
      }
      const convertedUrl = convertFilePath(url);
      return `[${text}](${convertedUrl})`;
    }
  );

  // 添加参考文献部分
  if (displayReferences.value && displayReferences.value.length > 0) {
    convertedMarkdown += '\n\n## References\n';

    displayReferences.value.forEach((ref, index) => {
      const refIndex = index + 1;
      let refText = '';

      // 从HTML中提取纯文本内容，移除HTML标签
      if (ref.html) {
        // 创建临时元素来解析HTML
        const tempElement = document.createElement('div');
        tempElement.innerHTML = ref.html;

        // 获取纯文本内容并去掉参考文献编号（因为我们会手动添加）
        let plainText = tempElement.textContent || tempElement.innerText || '';
        plainText = plainText.trim();

        // 移除开头的编号和点号（如 "1. "）
        plainText = plainText.replace(/^\d+\.\s+/, '');

        refText = plainText;
      }

      // 添加格式化的参考文献条目
      convertedMarkdown += `${refIndex}. ${refText}\n`;
    });
  }

  // 创建Blob对象并下载
  const blob = new Blob([convertedMarkdown], {
    type: 'text/markdown;charset=utf-8'
  });
  const filename = props.filename || 'document.md';
  saveAs(blob, filename);
};

// 图片查看器相关方法
const openImageViewer = (src, alt) => {
  currentImageSrc.value = src;
  currentImageAlt.value = alt;
  imageViewerVisible.value = true;
  // 重置缩放和位置
  scale.value = 1;
  imageOffset.x = 0;
  imageOffset.y = 0;
  isDragging.value = false;
};

const handleWheel = (event) => {
  event.preventDefault();

  const container = containerRef.value;
  const img = imageRef.value;

  if (!container || !img) return;

  // 获取容器边界
  const containerRect = container.getBoundingClientRect();

  // 计算鼠标相对于容器的位置
  const mouseX = event.clientX - containerRect.left;
  const mouseY = event.clientY - containerRect.top;

  // 获取图片原始尺寸
  const originalWidth = img.naturalWidth;
  const originalHeight = img.naturalHeight;

  // 计算当前图片尺寸
  const currentWidth = originalWidth * scale.value;
  const currentHeight = originalHeight * scale.value;

  // 计算鼠标相对于图片的位置（缩放后的）
  const currentImageX =
    (containerRect.width - currentWidth) / 2 + imageOffset.x * scale.value;
  const currentImageY =
    (containerRect.height - currentHeight) / 2 + imageOffset.y * scale.value;

  // 计算鼠标在图片上的相对位置（百分比）
  const mousePercentX = (mouseX - currentImageX) / currentWidth;
  const mousePercentY = (mouseY - currentImageY) / currentHeight;

  // 调整缩放比例
  const delta = event.deltaY > 0 ? 0.9 : 1.1;
  const newScale = Math.max(minScale, Math.min(maxScale, scale.value * delta));

  // 计算新的图片尺寸
  const newWidth = originalWidth * newScale;
  const newHeight = originalHeight * newScale;

  // 计算新的偏移量，保持鼠标位置不变
  const newImageX = mouseX - mousePercentX * newWidth;
  const newImageY = mouseY - mousePercentY * newHeight;

  // 转换回原始缩放比例下的偏移量
  imageOffset.x = (newImageX - (containerRect.width - newWidth) / 2) / newScale;
  imageOffset.y =
    (newImageY - (containerRect.height - newHeight) / 2) / newScale;

  scale.value = newScale;
};

// 拖拽移动图片
const handleMouseDown = (event) => {
  if (event.button !== 0) return; // 只响应左键
  isDragging.value = true;
  dragStart.x = event.clientX - imageOffset.x;
  dragStart.y = event.clientY - imageOffset.y;
  event.preventDefault();
};

const handleMouseMove = (event) => {
  if (!isDragging.value) return;
  imageOffset.x = event.clientX - dragStart.x;
  imageOffset.y = event.clientY - dragStart.y;
};

const handleMouseUp = () => {
  isDragging.value = false;
};

const handleMouseLeave = () => {
  handleMouseUp();
};

const setupImageClickListeners = () => {
  // 移除旧的事件监听器，避免重复绑定
  const existingImages = document.querySelectorAll('.clickable-image');
  existingImages.forEach((img) => {
    const newImg = img.cloneNode(true);
    img.parentNode.replaceChild(newImg, img);
  });

  // 添加新的事件监听器和处理高宽比
  const images = document.querySelectorAll('.clickable-image');
  images.forEach((img) => {
    // 加载图片以获取其原始宽高
    const tempImg = new Image();
    tempImg.src = img.getAttribute('data-src') || img.src;

    tempImg.onload = () => {
      // 计算高宽比
      const aspectRatio = tempImg.height / tempImg.width;

      // 如果高宽比小于0.5625，则设置宽度为100%
      if (aspectRatio < 0.5625) {
        img.style.width = '100%';
      } else {
        // 否则不单独设置宽度，使用默认的百分比宽度
        img.style.width = '70%';
      }
    };

    img.addEventListener('click', () => {
      const src = img.getAttribute('data-src');
      const alt = img.getAttribute('data-alt');
      openImageViewer(src, alt);
    });
  });
};

// Intersection Observer 相关变量
const observerRef = ref(null);
const observedElements = ref(new Set());

// 改进的自动展开父菜单函数
const expandParentMenus = (id) => {
  // 首先找到当前激活项在嵌套结构中的路径
  const findPath = (items, targetId, path = []) => {
    for (const item of items) {
      if (item.id === targetId) {
        path.push(item.id);
        return path;
      }
      if (item.children && item.children.length > 0) {
        const childPath = findPath(item.children, targetId, [...path, item.id]);
        if (childPath) {
          return childPath;
        }
      }
    }
    return null;
  };

  const path = findPath(nestedHeadings.value, id);
  if (!path) return;

  // 展开路径中所有的父菜单（除了最后一个，即当前激活项本身）
  for (let i = 0; i < path.length - 1; i++) {
    const menuId = path[i];
    const subMenuItem = document.querySelector(
      `.el-sub-menu[index="${menuId}"]`
    );

    if (subMenuItem && !subMenuItem.classList.contains('is-opened')) {
      // 使用 Element Plus 的方法展开菜单
      const subMenuTitle = subMenuItem.querySelector('.el-sub-menu__title');
      if (subMenuTitle) {
        subMenuTitle.click(); // 模拟点击展开
      }
    }
  }
};

// 使用 Intersection Observer 监测标题元素
const setupIntersectionObserver = () => {
  // 创建 Intersection Observer 实例
  const observer = new IntersectionObserver(
    (entries) => {
      const visibleHeadings = [];

      entries.forEach((entry) => {
        const headingId = entry.target.id;

        if (entry.isIntersecting) {
          // 元素进入可视区域
          visibleHeadings.push({
            id: headingId,
            top: entry.boundingClientRect.top
          });
        }
      });

      // 如果有可见的标题元素，找到最上方的那个作为当前激活的标题
      if (visibleHeadings.length > 0) {
        // 按视口中的位置排序，选择最上方的标题
        visibleHeadings.sort((a, b) => a.top - b.top);

        const currentActiveId = visibleHeadings[0].id;

        if (currentActiveId !== activeHeadingId.value) {
          activeHeadingId.value = currentActiveId;
          expandParentMenus(currentActiveId);
        }
      }
    },
    {
      // 设置根元素为滚动容器
      root: mainContentRef.value?.$el || mainContentRef.value,
      // 设置交叉比例，当元素有20%进入视口时触发
      threshold: 0.2,
      // 设置边距，提前或延后触发
      rootMargin: '-10% 0px -70% 0px'
    }
  );

  observerRef.value = observer;

  // 观察所有标题元素
  headings.value.forEach((heading) => {
    const element = document.getElementById(heading.id);
    if (element && !observedElements.value.has(element)) {
      observer.observe(element);
      observedElements.value.add(element);
    }
  });
};

// 在 onMounted 中设置 Intersection Observer
onMounted(async () => {
  console.log('markdown', props.markdown);
  convertMarkdown(props.markdown);

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

// 确保在组件卸载时清理 Intersection Observer
onUnmounted(() => {
  if (observerRef.value) {
    // 停止观察所有元素
    observedElements.value.forEach((element) => {
      observerRef.value.unobserve(element);
    });
    // 断开观察者连接
    observerRef.value.disconnect();
    observerRef.value = null;
    observedElements.value.clear();
  }
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
[style*='position: sticky'] {
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
[ref='mainContentRef'] {
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
