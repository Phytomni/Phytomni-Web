import {
  processInlineMarkdown,
  convertFilePath,
} from "@/utils/markdown-inline";

// deep_genome agent(经 Bot 中转)的 markdown 解析器。从 DeepGenomeResultViewer.vue
// 原样抽出:这是一个纯函数,只读 text 入参,返回 { contentBlocks, headings,
// nestedHeadings },由调用方写入对应的 ref。输出会经 v-html 注入 DOM,故 escapeHtml
// → processInlineMarkdown 的清洗管线必须原样保留(见 @/utils/sanitize-markup 不变量)。

// --- Markdown 转换辅助函数 ---
// escapeHtml 从组件本地原样内联(与 @/utils/sanitize-markup 的导出实现并非逐字相同,
// 为保证行为零变化,这里保留组件原始单遍 replace 实现)。
const escapeHtml = (text: string): string => {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
};

// 内容块(供模板 v-for 渲染):
// - h1/h2/h4: { type, id, content }
// - h3-card:  { type, id, header, body }
// - standalone-content: { type, content }
export interface ContentBlock {
  type: string;
  id?: string;
  content?: string;
  header?: string;
  body?: string;
}

// 扁平标题项,counter-based id。
export interface Heading {
  id: string;
  text: string;
  level: number;
}

// 嵌套标题树(h1 过滤掉)。
export interface NestedHeading extends Heading {
  children: NestedHeading[];
}

// --- 转换逻辑 ---
export function parseDeepGenomeMarkdown(text: string): {
  contentBlocks: ContentBlock[];
  headings: Heading[];
  nestedHeadings: NestedHeading[];
} {
  const lines = text.split("\\n"); // 正确分割行
  const blocks: ContentBlock[] = [];
  let currentH3CardContent = "";
  let currentH3CardHeader = "";
  let currentH3CardId = "";
  let isInH3Card = false;
  let tempContentAfterH2 = "";
  let isInStandaloneContentAfterH2 = false;

  let tempContentAfterH1 = "";
  let isInStandaloneContentAfterH1 = false;

  let isInTable = false;
  let tableHeaders: string[] = [];
  let tableAlignments: string[] = [];
  let tableRows: string[][] = [];

  let headingCounter = 1;

  const headingsList: Heading[] = [];

  const createHeadingId = (prefix = "heading") => {
    return `${prefix}-${headingCounter++}`;
  };

  // --- 新增：将表格行转换为 HTML 字符串的函数 ---
  const generateTableHtml = (
    headers: string[],
    alignments: string[],
    rows: string[][]
  ) => {
    let html = '<table border="1" class="markdown-table"><thead><tr>';
    headers.forEach((header, index) => {
      // 根据 alignments 设置 th 的样式
      let alignStyle = "";
      const align = alignments[index] ? alignments[index].trim() : "";
      if (align.startsWith(":") && align.endsWith(":")) {
        alignStyle = ' style="text-align: center;"';
      } else if (align.endsWith(":")) {
        alignStyle = ' style="text-align: right;"';
      } else if (align.startsWith(":")) {
        // 默认左对齐，通常不需要显式设置，但可以加上
        alignStyle = ' style="text-align: left;"';
      } else {
        // 默认左对齐
        alignStyle = ' style="text-align: left;"';
      }
      html += `<th${alignStyle}>${header}</th>`;
    });
    html += "</tr></thead><tbody>";
    rows.forEach((row) => {
      html += "<tr>";
      row.forEach((cell) => {
        html += `<td>${cell}</td>`;
      });
      html += "</tr>";
    });
    html += "</tbody></table>";
    return html;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const isTableDelimiter = (l: string) => {
      return (
        /^\s*\|.*\|.*\|\s*$/.test(l) && l.replace(/\s/g, "").includes("|-")
      );
    };

    const isTableContent = (l: string) => {
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
        .split("|")
        .map((cell) => cell.trim())
        .filter((cell) => cell.length > 0);
      tableHeaders = headerCells.map((cell) =>
        processInlineMarkdown(escapeHtml(cell))
      );

      i++; // 跳过分隔符行
      const alignmentLine = lines[i];
      tableAlignments = alignmentLine
        .split("|")
        .map((cell) => cell.trim())
        .filter((cell) => cell.length > 0);

      tableRows = [];
      isTableRowProcessed = true; // 标记表头行已处理
      continue; // Skip to next line
    } else if (isInTable) {
      if (isTableContent(line)) {
        const dataCells = line
          .split("|")
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
          const content = processInlineMarkdown(escapeHtml(match![1]));
          const id = createHeadingId("h4");
          headingsList.push({ id, text: content, level: 4 });
          if (isInH3Card) {
            currentH3CardContent += `<h4 id="${id}">${content}</h4>`;
          } else {
            blocks.push({ type: "h4", id, content });
          }
          currentLineProcessed = true;
        } else if (/^###\s(.*)/.test(line)) {
          if (isInH3Card) {
            blocks.push({
              type: "h3-card",
              id: currentH3CardId,
              header: currentH3CardHeader,
              body: currentH3CardContent,
            });
            isInH3Card = false;
            currentH3CardContent = "";
            currentH3CardHeader = "";
            currentH3CardId = "";
          }

          if (isInStandaloneContentAfterH2 && tempContentAfterH2) {
            blocks.push({
              type: "standalone-content",
              content: tempContentAfterH2,
            });
            isInStandaloneContentAfterH2 = false;
            tempContentAfterH2 = "";
          }

          const match = line.match(/^###\s(.*)/);
          const content = processInlineMarkdown(escapeHtml(match![1]));
          currentH3CardId = createHeadingId("h3");
          currentH3CardHeader = content;
          currentH3CardContent = "";
          isInH3Card = true;
          headingsList.push({
            id: currentH3CardId,
            text: currentH3CardHeader,
            level: 3,
          });
          currentLineProcessed = true;
        } else if (/^##\s(.*)/.test(line)) {
          const match = line.match(/^##\s(.*)/);
          const content = processInlineMarkdown(escapeHtml(match![1]));
          const id = createHeadingId("h2");
          headingsList.push({ id, text: content, level: 2 });

          if (isInStandaloneContentAfterH1 && tempContentAfterH1) {
            blocks.push({
              type: "standalone-content",
              content: tempContentAfterH1,
            });
            isInStandaloneContentAfterH1 = false;
            tempContentAfterH1 = "";
          }

          if (isInH3Card) {
            blocks.push({
              type: "h3-card",
              id: currentH3CardId,
              header: currentH3CardHeader,
              body: currentH3CardContent,
            });
            isInH3Card = false;
            currentH3CardContent = "";
            currentH3CardHeader = "";
            currentH3CardId = "";
          }

          blocks.push({ type: "h2", id, content });
          isInStandaloneContentAfterH2 = true;
          currentLineProcessed = true;
        } else if (/^#\s(.*)/.test(line)) {
          const match = line.match(/^#\s(.*)/);
          const content = processInlineMarkdown(escapeHtml(match![1]));
          const id = createHeadingId("h1");
          headingsList.push({ id, text: content, level: 1 });

          if (isInH3Card) {
            blocks.push({
              type: "h3-card",
              id: currentH3CardId,
              header: currentH3CardHeader,
              body: currentH3CardContent,
            });
            isInH3Card = false;
            currentH3CardContent = "";
            currentH3CardHeader = "";
            currentH3CardId = "";
          }
          if (isInStandaloneContentAfterH2 && tempContentAfterH2) {
            blocks.push({
              type: "standalone-content",
              content: tempContentAfterH2,
            });
            isInStandaloneContentAfterH2 = false;
            tempContentAfterH2 = "";
          }
          isInStandaloneContentAfterH1 = true;
          tempContentAfterH1 = "";

          blocks.push({ type: "h1", id, content });
          currentLineProcessed = true;
        } else {
          // 处理表格结束后紧跟的普通文本行
          const processedLineContent = `<p>${processInlineMarkdown(
            escapeHtml(line)
          )}</p>`;
          const isLineContentEmpty = line.trim() === "";

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
      const content = processInlineMarkdown(escapeHtml(match![1]));
      const id = createHeadingId("h4");
      headingsList.push({ id, text: content, level: 4 });
      if (isInH3Card) {
        currentH3CardContent += `<h4 id="${id}">${content}</h4>`;
      } else {
        blocks.push({ type: "h4", id, content });
      }
    } else if (/^###\s(.*)/.test(line)) {
      if (isInH3Card) {
        blocks.push({
          type: "h3-card",
          id: currentH3CardId,
          header: currentH3CardHeader,
          body: currentH3CardContent,
        });
        isInH3Card = false;
        currentH3CardContent = "";
        currentH3CardHeader = "";
        currentH3CardId = "";
      }

      if (isInStandaloneContentAfterH2 && tempContentAfterH2) {
        blocks.push({
          type: "standalone-content",
          content: tempContentAfterH2,
        });
        isInStandaloneContentAfterH2 = false;
        tempContentAfterH2 = "";
      }

      const match = line.match(/^###\s(.*)/);
      const content = processInlineMarkdown(escapeHtml(match![1]));
      currentH3CardId = createHeadingId("h3");
      currentH3CardHeader = content;
      currentH3CardContent = "";
      isInH3Card = true;
      headingsList.push({
        id: currentH3CardId,
        text: currentH3CardHeader,
        level: 3,
      });
    } else if (/^##\s(.*)/.test(line)) {
      const match = line.match(/^##\s(.*)/);
      const content = processInlineMarkdown(escapeHtml(match![1]));
      const id = createHeadingId("h2");
      headingsList.push({ id, text: content, level: 2 });

      if (isInStandaloneContentAfterH1 && tempContentAfterH1) {
        blocks.push({
          type: "standalone-content",
          content: tempContentAfterH1,
        });
        isInStandaloneContentAfterH1 = false;
        tempContentAfterH1 = "";
      }

      if (isInH3Card) {
        blocks.push({
          type: "h3-card",
          id: currentH3CardId,
          header: currentH3CardHeader,
          body: currentH3CardContent,
        });
        isInH3Card = false;
        currentH3CardContent = "";
        currentH3CardHeader = "";
        currentH3CardId = "";
      }

      // 在添加新的h2标题前，先处理之前的h2后独立内容
      if (isInStandaloneContentAfterH2 && tempContentAfterH2) {
        blocks.push({
          type: "standalone-content",
          content: tempContentAfterH2,
        });
        isInStandaloneContentAfterH2 = false;
        tempContentAfterH2 = "";
      }

      blocks.push({ type: "h2", id, content });
      isInStandaloneContentAfterH2 = true;
    } else if (/^#\s(.*)/.test(line)) {
      const match = line.match(/^#\s(.*)/);
      const content = processInlineMarkdown(escapeHtml(match![1]));
      const id = createHeadingId("h1");
      headingsList.push({ id, text: content, level: 1 });

      if (isInH3Card) {
        blocks.push({
          type: "h3-card",
          id: currentH3CardId,
          header: currentH3CardHeader,
          body: currentH3CardContent,
        });
        isInH3Card = false;
        currentH3CardContent = "";
        currentH3CardHeader = "";
        currentH3CardId = "";
      }
      if (isInStandaloneContentAfterH2 && tempContentAfterH2) {
        blocks.push({
          type: "standalone-content",
          content: tempContentAfterH2,
        });
        isInStandaloneContentAfterH2 = false;
        tempContentAfterH2 = "";
      }
      isInStandaloneContentAfterH1 = true;
      tempContentAfterH1 = "";

      blocks.push({ type: "h1", id, content });
    } else {
      // 处理普通段落、图片、链接等
      const processedLineContent = `<p>${processInlineMarkdown(
        escapeHtml(line)
      )}</p>`;
      const isLineContentEmpty = line.trim() === "";

      // 检查当前行是否包含图片
      const imageMatch = line.match(/!\[(.*?)\]\((.*?)\)/);

      if (imageMatch) {
        let imageHtml = "";

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

        let captionHtml = "";

        // 检查图片后的行是否包含图注（处理空行问题）
        // 寻找图片后第一个非空行作为图注
        let j = i + 1;
        while (j < lines.length && lines[j].trim() === "") {
          j++;
        }

        // 如果找到了非空行，认为它是图注
        if (j < lines.length) {
          const captionLine = lines[j];
          // 提取图注文本，保留所有内容
          let captionText = captionLine.trim();
          // 对图注文本应用Markdown处理，确保**被转换为strong标签。
          // 先 escapeHtml 再做内联处理（与标题/段落/表格单元格等同级路径一致），
          // 让 agent/RAG 图注里的原始 HTML（如 <img onerror>）变成惰性文本，
          // 不会经 v-html 槽执行,合法的 **加粗** 仍会被转换为 strong。
          captionText = processInlineMarkdown(escapeHtml(captionText));
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
    blocks.push({ type: "standalone-content", content: tempContentAfterH1 });
  }
  if (isInH3Card && currentH3CardHeader) {
    blocks.push({
      type: "h3-card",
      id: currentH3CardId,
      header: currentH3CardHeader,
      body: currentH3CardContent,
    });
  }
  if (isInStandaloneContentAfterH2 && tempContentAfterH2) {
    // 确保每个h2后面的内容都作为单独的el-card处理
    blocks.push({ type: "standalone-content", content: tempContentAfterH2 });
  }

  return {
    contentBlocks: blocks,
    headings: headingsList,
    nestedHeadings: buildNestedHeadings(headingsList),
  };

  // 辅助函数：构建嵌套标题结构
  function buildNestedHeadings(flatHeadings: Heading[]): NestedHeading[] {
    const nested: NestedHeading[] = [];
    const stack: NestedHeading[] = [];

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
}
