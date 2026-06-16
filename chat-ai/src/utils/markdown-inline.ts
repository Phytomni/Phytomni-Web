import {
  sanitizeAnchorAttributes,
  sanitizeHref,
} from "@/utils/sanitize-markup";

// AnalystAgent 返回的 markdown 把图片/链接写成 ./.out/xxxx,前端转换为可
// 访问的 attachment URL。base prefix 走 Vite env (VITE_ATTACHMENTS_BASE_URL),
// 默认相对路径 /attachments/ —— dev 时让 vite proxy / 同源 nginx 接管,
// production 想跨域指向独立 attachments 服务,在 .env.production 改 key 即可,
// 不要把 prod host 硬编进源码。
const attachmentsBaseUrl =
  import.meta.env.VITE_ATTACHMENTS_BASE_URL || "/attachments/";

export const convertFilePath = (path: string): string => {
  if (!path) return path;
  if (path.includes(".out/")) {
    return path.replace(/\.?\/?\.out\//g, attachmentsBaseUrl);
  }
  return path;
};

// processInlineMarkdown 不做 escapeHtml —— 这是契约:调用方在传入前先 escapeHtml
// (processInlineMarkdown(escapeHtml(text))),本函数对裸字符串做内联处理,绝不
// 自行转义(转义归调用方所有,见 v-html 消毒不变量 / @/utils/sanitize-markup)。
export const processInlineMarkdown = (line: string): string => {
  if (!line) return line;

  // 先恢复被转义的 HTML <a> 标签（支持各种属性组合）
  // 匹配模式：&lt;a href=&quot;...&quot; ... &gt;...&lt;/a&gt;
  // 使用更宽松的匹配模式来处理包含HTML实体的属性
  line = line.replace(
    /&lt;a\s+(.*?)&gt;(.*?)&lt;\/a&gt;/g,
    function (match: string, attributes: string, text: string) {
      // 恢复属性中的转义字符
      attributes = attributes
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&amp;/g, "&");

      // 转换路径（如果 href 属性存在）
      attributes = attributes.replace(
        /href=["']([^"']+)["']/g,
        function (attrMatch: string, url: string) {
          const convertedUrl = convertFilePath(url);
          return `href="${convertedUrl}"`;
        }
      );

      // XSS 防护：复活的 <a> 属性是原样透传的，注入 v-html 前先剥掉事件处理器
      // 属性并中和 javascript:/data: 等危险协议 href（详见 @/utils/sanitize-markup）。
      attributes = sanitizeAnchorAttributes(attributes);

      const result = `<a ${attributes}>${text}</a>`;
      return result;
    }
  );

  // 先处理.cif格式的图片
  line = line.replace(
    /!\[(.*?)\]\((.*?\.cif)\)/g,
    function (match: string, alt: string, src: string) {
      const convertedSrc = convertFilePath(src);
      return (
        '<div class="cif-container" data-src="' +
        convertedSrc +
        '" data-alt="' +
        alt +
        '"></div>'
      );
    }
  );
  // 处理其他格式的图片
  line = line.replace(
    /!\[(.*?)\]\((?!.*\.cif)(.*?)\)/g,
    function (match: string, alt: string, src: string) {
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
    function (match: string, text: string, url: string) {
      const convertedUrl = convertFilePath(url);
      return (
        '<a href="' +
        sanitizeHref(convertedUrl) +
        '" target="_blank" download>' +
        text +
        "</a>"
      );
    }
  );
  // 处理 .cif 链接
  line = line.replace(
    /\[([^\]]+?)\]\(([^)]+?\.cif)\)/g,
    (_: string, text: string, url: string) => {
      // 转换路径
      const cleanUrl = convertFilePath(url);
      return `<div class="cif-container" data-src="${cleanUrl}" data-alt="${text}">${text} (CIF 文件)</div>`;
    }
  );
  // 处理参考文献引用，确保引用不单独占行
  line = line.replace(
    /\[(\d{1,2})\]/g,
    '<a href="#ref-$1" @click.prevent="jumpTo(\'ref-$1\')" style="display: inline-block;">[$1]</a>'
  );
  // 处理粗体
  line = line.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  line = line.replace(/\*(.*?)\*/g, "<em>$1</em>");
  // 处理斜体 (改进版，避免与列表混淆)
  line = line.replace(/(^|\s)\*([^*]+?)\*(?=\s|$|[.,;:!?])/g, "$1<em>$2</em>");
  // 处理行内代码
  line = line.replace(/`(.*?)`/g, "<code>$1</code>");

  return line;
};
