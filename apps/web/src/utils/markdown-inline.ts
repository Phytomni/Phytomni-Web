import {
  sanitizeAnchorAttributes,
  sanitizeHref,
} from "@/utils/sanitize-markup";

// AnalystAgent returns markdown that writes images/links as ./.out/xxxx; the
// frontend rewrites them into accessible attachment URLs. The base prefix comes
// from a Vite env (VITE_ATTACHMENTS_BASE_URL), defaulting to the relative path
// /attachments/ — in dev the vite proxy / same-origin nginx takes over; for a
// production cross-origin pointing at a standalone attachments service, change the
// key in .env.production. Do not hard-code the prod host into the source.
const attachmentsBaseUrl =
  import.meta.env.VITE_ATTACHMENTS_BASE_URL || "/attachments/";

export const convertFilePath = (path: string): string => {
  if (!path) return path;
  if (path.includes(".out/")) {
    return path.replace(/\.?\/?\.out\//g, attachmentsBaseUrl);
  }
  return path;
};

// processInlineMarkdown does NOT escapeHtml — this is the contract: the caller
// escapeHtml-s before passing in (processInlineMarkdown(escapeHtml(text))). This
// function does inline processing on the bare string and never escapes itself
// (escaping belongs to the caller; see the v-html sanitization invariant /
// @/utils/sanitize-markup).
export const processInlineMarkdown = (line: string): string => {
  if (!line) return line;

  // First restore the escaped HTML <a> tags (supports various attribute combinations)
  // Match pattern: &lt;a href=&quot;...&quot; ... &gt;...&lt;/a&gt;
  // Use a looser match to handle attributes that contain HTML entities
  line = line.replace(
    /&lt;a\s+(.*?)&gt;(.*?)&lt;\/a&gt;/g,
    function (match: string, attributes: string, text: string) {
      // restore escaped characters in the attributes
      attributes = attributes
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&amp;/g, "&");

      // convert the path (if the href attribute exists)
      attributes = attributes.replace(
        /href=["']([^"']+)["']/g,
        function (attrMatch: string, url: string) {
          const convertedUrl = convertFilePath(url);
          return `href="${convertedUrl}"`;
        }
      );

      // XSS protection: resurrected <a> attributes are passed through verbatim; before
      // v-html injection, strip event-handler attributes and neutralize dangerous-scheme
      // hrefs like javascript:/data: (see @/utils/sanitize-markup).
      attributes = sanitizeAnchorAttributes(attributes);

      const result = `<a ${attributes}>${text}</a>`;
      return result;
    }
  );

  // handle .cif images first
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
  // handle other image formats
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
  // handle .md links
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
  // handle .cif links
  line = line.replace(
    /\[([^\]]+?)\]\(([^)]+?\.cif)\)/g,
    (_: string, text: string, url: string) => {
      // convert the path
      const cleanUrl = convertFilePath(url);
      return `<div class="cif-container" data-src="${cleanUrl}" data-alt="${text}">${text} (CIF 文件)</div>`;
    }
  );
  // handle reference citations, ensuring a citation does not sit on its own line
  line = line.replace(
    /\[(\d{1,2})\]/g,
    '<a href="#ref-$1" @click.prevent="jumpTo(\'ref-$1\')" style="display: inline-block;">[$1]</a>'
  );
  // handle bold
  line = line.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  line = line.replace(/\*(.*?)\*/g, "<em>$1</em>");
  // handle italics (improved, avoids confusion with lists)
  line = line.replace(/(^|\s)\*([^*]+?)\*(?=\s|$|[.,;:!?])/g, "$1<em>$2</em>");
  // handle inline code
  line = line.replace(/`(.*?)`/g, "<code>$1</code>");

  return line;
};
