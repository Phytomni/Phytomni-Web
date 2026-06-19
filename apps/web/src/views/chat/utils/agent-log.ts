import { escapeHtml } from "@/utils/sanitize-markup";

// 处理 Markdown 文件中的图片路径
export const processImagePaths = (content: string, filePath: string): string => {
  // 获取文件所在目录
  const fileDir = filePath.substring(0, filePath.lastIndexOf("/"));

  // 处理相对路径的图片引用
  // 匹配 ![alt text](./path/to/image.png) 格式
  const imageRegex = /!\[([^\]]*)\]\(\.\/([^)]+)\)/g;

  return content.replace(imageRegex, (match, altText, imagePath) => {
    // 构建完整的图片路径
    const fullImagePath = `/${fileDir}/${imagePath}`;
    return `![${altText}](${fullImagePath})`;
  });
};

// 读取服务器文件内容的函数
export const readServerFile = async (filePath: string): Promise<string> => {
  try {
    // 将绝对路径转换为相对于项目的路径
    let relativePath = filePath;
    if (
      filePath.includes("src\\assets\\agentOut\\") ||
      filePath.includes("src/assets/agentOut/")
    ) {
      // 提取相对路径部分
      const pathParts = filePath.split(/[\\/]/);
      const srcIndex = pathParts.findIndex((part) => part === "src");
      if (srcIndex !== -1) {
        relativePath = pathParts.slice(srcIndex).join("/");
      }
    }

    // 使用 fetch 读取文件内容
    const response = await fetch(`/${relativePath}`);
    if (response.ok) {
      let content = await response.text();

      // 处理 Markdown 文件中的图片路径
      content = processImagePaths(content, relativePath);

      return content;
    } else {
      console.error("读取文件失败:", response.status, response.statusText);
      return "";
    }
  } catch (error) {
    console.error("读取服务器文件失败:", error);
    return "";
  }
};

// 格式化日志内容（保留ANSI颜色代码）
export const formatLogContent = (logContent: string) => {
  if (!logContent) return "";

  // 处理特殊字符，但保留ANSI颜色代码
  const processedContent = logContent
    .replace(/\u0026\u0026/g, "&&") // 将 \u0026\u0026 转换为 &&
    .replace(/\n/g, "\n") // 保持换行符
    .trim();

  return processedContent;
};

// 格式化日志内容并转换ANSI颜色代码为HTML样式
export const formatLogContentWithColors = (logContent: string) => {
  if (!logContent) return "";

  // 处理特殊字符
  let processedContent = logContent
    .replace(/\u0026\u0026/g, "&&") // 将 \u0026\u0026 转换为 &&
    .replace(/\n/g, "\n") // 保持换行符
    .trim();

  // ANSI ESC (\u001b) is a control char by design; this contiguous block
  // converts terminal escape sequences to HTML tags. no-control-regex is
  // meant to catch accidental control chars in human regex, not ANSI
  // parsing, so we disable it for the block only.

  // XSS 防护:日志正文是 analyst-agent 输出(经后端/EIHealth/Bot 中转,
  // agent/tool/RAG 可影响),最终经 index.vue 的 v-html 注入 DOM。在 ANSI→HTML
  // 转换之前先 HTML 转义,把正文里的恶意 HTML(<img onerror>、<script> 等)
  // 中和成实体。ANSI 控制字符(ESC)与 [31m 等不在 escapeHtml 编码的
  // & < > " ' 之列,故转义后原样保留,下面的 ANSI 正则仍能匹配 —— 着色/加粗/
  // 下划线标签(本函数自身插入的可信字面量)照常生成,合法着色输出渲染不变。
  processedContent = escapeHtml(processedContent);

  /* eslint-disable no-control-regex */
  // 转换ANSI颜色代码为HTML样式
  // 红色文本
  processedContent = processedContent.replace(
    /\u001b\[31m/g,
    '<span style="color: #ff0000;">'
  );
  // 绿色文本
  processedContent = processedContent.replace(
    /\u001b\[32m/g,
    '<span style="color: #00ff00;">'
  );
  // 黄色文本
  processedContent = processedContent.replace(
    /\u001b\[33m/g,
    '<span style="color: #ffff00;">'
  );
  // 蓝色文本
  processedContent = processedContent.replace(
    /\u001b\[34m/g,
    '<span style="color: #0000ff;">'
  );
  // 洋红色文本
  processedContent = processedContent.replace(
    /\u001b\[35m/g,
    '<span style="color: #ff00ff;">'
  );
  // 青色文本
  processedContent = processedContent.replace(
    /\u001b\[36m/g,
    '<span style="color: #00ffff;">'
  );
  // 白色文本
  processedContent = processedContent.replace(
    /\u001b\[37m/g,
    '<span style="color: #ffffff;">'
  );

  // 重置颜色
  processedContent = processedContent.replace(/\u001b\[0m/g, "</span>");

  // 处理其他常见的ANSI代码
  // 加粗
  processedContent = processedContent.replace(/\u001b\[1m/g, "<strong>");
  processedContent = processedContent.replace(/\u001b\[22m/g, "</strong>");

  // 下划线
  processedContent = processedContent.replace(/\u001b\[4m/g, "<u>");
  processedContent = processedContent.replace(/\u001b\[24m/g, "</u>");
  /* eslint-enable no-control-regex */

  return processedContent;
};
