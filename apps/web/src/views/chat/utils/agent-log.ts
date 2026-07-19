import { escapeHtml } from "@/utils/sanitize-markup";

// Process image paths in a Markdown file
export const processImagePaths = (
  content: string,
  filePath: string
): string => {
  // get the file's directory
  const fileDir = filePath.substring(0, filePath.lastIndexOf("/"));

  // handle relative-path image references
  // match the ![alt text](./path/to/image.png) format
  const imageRegex = /!\[([^\]]*)\]\(\.\/([^)]+)\)/g;

  return content.replace(imageRegex, (match, altText, imagePath) => {
    // build the full image path
    const fullImagePath = `/${fileDir}/${imagePath}`;
    return `![${altText}](${fullImagePath})`;
  });
};

// Read the contents of a server file
export const readServerFile = async (filePath: string): Promise<string> => {
  try {
    // convert the absolute path to a project-relative path
    let relativePath = filePath;
    if (
      filePath.includes("src\\assets\\agentOut\\") ||
      filePath.includes("src/assets/agentOut/")
    ) {
      // extract the relative path part
      const pathParts = filePath.split(/[\\/]/);
      const srcIndex = pathParts.findIndex((part) => part === "src");
      if (srcIndex !== -1) {
        relativePath = pathParts.slice(srcIndex).join("/");
      }
    }

    // read the file contents via fetch
    const response = await fetch(`/${relativePath}`);
    if (response.ok) {
      let content = await response.text();

      // process image paths in the Markdown file
      content = processImagePaths(content, relativePath);

      return content;
    } else {
      console.error(
        "Failed to read file:",
        response.status,
        response.statusText
      );
      return "";
    }
  } catch (error) {
    console.error("Failed to read server file:", error);
    return "";
  }
};

// Format log content (preserving ANSI color codes)
export const formatLogContent = (logContent: string) => {
  if (!logContent) return "";

  // handle special characters while preserving ANSI color codes
  const processedContent = logContent
    .replace(/\u0026\u0026/g, "&&") // convert\u0026\u0026 to &&
    .replace(/\n/g, "\n") // keep line breaks
    .trim();

  return processedContent;
};

// Format log content and convert ANSI color codes into HTML styles
export const formatLogContentWithColors = (logContent: string) => {
  if (!logContent) return "";

  // handle special characters
  let processedContent = logContent
    .replace(/\u0026\u0026/g, "&&") // convert\u0026\u0026 to &&
    .replace(/\n/g, "\n") // keep line breaks
    .trim();

  // ANSI ESC (\u001b) is a control char by design; this contiguous block
  // converts terminal escape sequences to HTML tags. no-control-regex is
  // meant to catch accidental control chars in human regex, not ANSI
  // parsing, so we disable it for the block only.

  // XSS protection: the log body is analyst-agent output (relayed via the
  // backend/EIHealth/Bot, influenced by agent/tool/RAG) and is ultimately injected
  // into the DOM via index.vue's v-html. Before the ANSI→HTML conversion we
  // HTML-escape it, neutralizing malicious HTML in the body (<img onerror>,
  // <script>, etc.) into entities. ANSI control chars (ESC) and [31m etc. are not
  // among the & < > " ' that escapeHtml encodes, so they survive verbatim and the
  // ANSI regexes below still match — the color/bold/underline tags (trusted
  // literals this function inserts itself) are generated as usual, so legitimate
  // colored output renders unchanged.
  processedContent = escapeHtml(processedContent);

  /* eslint-disable no-control-regex */
  // convert ANSI color codes into HTML styles
  // red text
  processedContent = processedContent.replace(
    /\u001b\[31m/g,
    '<span style="color: #ff0000;">'
  );
  // green text
  processedContent = processedContent.replace(
    /\u001b\[32m/g,
    '<span style="color: #00ff00;">'
  );
  // yellow text
  processedContent = processedContent.replace(
    /\u001b\[33m/g,
    '<span style="color: #ffff00;">'
  );
  // blue text
  processedContent = processedContent.replace(
    /\u001b\[34m/g,
    '<span style="color: #0000ff;">'
  );
  // magenta text
  processedContent = processedContent.replace(
    /\u001b\[35m/g,
    '<span style="color: #ff00ff;">'
  );
  // cyan text
  processedContent = processedContent.replace(
    /\u001b\[36m/g,
    '<span style="color: #00ffff;">'
  );
  // white text
  processedContent = processedContent.replace(
    /\u001b\[37m/g,
    '<span style="color: #ffffff;">'
  );

  // reset color
  processedContent = processedContent.replace(/\u001b\[0m/g, "</span>");

  // handle other common ANSI codes
  // bold
  processedContent = processedContent.replace(/\u001b\[1m/g, "<strong>");
  processedContent = processedContent.replace(/\u001b\[22m/g, "</strong>");

  // underline
  processedContent = processedContent.replace(/\u001b\[4m/g, "<u>");
  processedContent = processedContent.replace(/\u001b\[24m/g, "</u>");
  /* eslint-enable no-control-regex */

  return processedContent;
};
