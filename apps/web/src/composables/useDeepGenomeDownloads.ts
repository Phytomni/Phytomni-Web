import { nextTick } from "vue";
import type { Ref, ComputedRef } from "vue";
import { saveAs } from "file-saver";
import { ElMessage } from "element-plus";
import { convertFilePath } from "@/utils/markdown-inline";

export interface DeepGenomeDownloadsOpts {
  props: {
    markdown: string;
    filename?: string;
  };
  mainContentRef: Ref<any>;
  displayReferences: ComputedRef<Array<{ html?: string; id?: string }>>;
}

export function useDeepGenomeDownloads(opts: DeepGenomeDownloadsOpts) {
  const { props, mainContentRef, displayReferences } = opts;

  // 下载功能相关方法
  const downloadPDF = async () => {
    // 创建打印容器
    const printContainer = document.createElement("div");
    printContainer.id = "print-container";
    printContainer.style.position = "absolute";
    printContainer.style.top = "0";
    printContainer.style.left = "0";
    printContainer.style.width = "100%";
    printContainer.style.height = "auto";
    printContainer.style.backgroundColor = "#fff";
    printContainer.style.zIndex = "9999";
    printContainer.style.padding = "20px";
    printContainer.style.display = "none";
    printContainer.style.boxSizing = "border-box";

    // 复制当前内容
    const contentWrapper = document.createElement("div");
    contentWrapper.style.maxWidth = "210mm";
    contentWrapper.style.margin = "0 auto";
    contentWrapper.style.fontSize = "12pt";
    contentWrapper.style.pageBreakInside = "auto";
    contentWrapper.style.overflow = "visible";
    contentWrapper.style.height = "auto";

    // 复制所有内容块
    const contentBlocksCopy = document.createElement("div");
    contentBlocksCopy.style.pageBreakInside = "auto";
    contentBlocksCopy.style.overflow = "visible";
    contentBlocksCopy.style.height = "auto";

    // 直接获取el-main内部的所有内容（不包括el-main本身）
    const originalElMain = mainContentRef.value.$el;
    const contentInsideElMain = document.createElement("div");

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
    const allElements = contentInsideElMain.querySelectorAll("*");
    allElements.forEach((element) => {
      // 移除内联样式中的高度和溢出限制
      (element as HTMLElement).style.height = "auto";
      (element as HTMLElement).style.maxHeight = "none";
      (element as HTMLElement).style.overflow = "visible";
      (element as HTMLElement).style.minHeight = "auto";
      (element as HTMLElement).style.position = "static";
    });

    contentBlocksCopy.appendChild(contentInsideElMain);
    contentWrapper.appendChild(contentBlocksCopy);
    printContainer.appendChild(contentWrapper);

    // 添加到文档
    document.body.appendChild(printContainer);

    // 显示打印容器
    printContainer.style.display = "block";

    // 等待所有内容渲染完成
    await nextTick();

    // 添加打印样式
    const style = document.createElement("style");
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
      ElMessage.error("打印失败");
      console.error("打印错误:", error);
    }

    // 移除打印容器
    document.body.removeChild(printContainer);
  };

  const downloadMarkdown = () => {
    // 创建转换后的Markdown内容
    let convertedMarkdown = props.markdown;

    // 处理换行符 - 将转义的\n转换为实际的换行符
    convertedMarkdown = convertedMarkdown.replace(/\\n/g, "\n");

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
        if (url.startsWith("http://") || url.startsWith("https://")) {
          return match;
        }
        const convertedUrl = convertFilePath(url);
        return `[${text}](${convertedUrl})`;
      }
    );

    // 添加参考文献部分
    if (displayReferences.value && displayReferences.value.length > 0) {
      convertedMarkdown += "\n\n## References\n";

      displayReferences.value.forEach((ref, index) => {
        const refIndex = index + 1;
        let refText = "";

        // 从HTML中提取纯文本内容，移除HTML标签
        if (ref.html) {
          // 创建临时元素来解析HTML
          const tempElement = document.createElement("div");
          tempElement.innerHTML = ref.html;

          // 获取纯文本内容并去掉参考文献编号（因为我们会手动添加）
          let plainText = tempElement.textContent || tempElement.innerText || "";
          plainText = plainText.trim();

          // 移除开头的编号和点号（如 "1. "）
          plainText = plainText.replace(/^\d+\.\s+/, "");

          refText = plainText;
        }

        // 添加格式化的参考文献条目
        convertedMarkdown += `${refIndex}. ${refText}\n`;
      });
    }

    // 创建Blob对象并下载
    const blob = new Blob([convertedMarkdown], {
      type: "text/markdown;charset=utf-8",
    });
    const filename = props.filename || "document.md";
    saveAs(blob, filename);
  };

  return { downloadPDF, downloadMarkdown };
}
