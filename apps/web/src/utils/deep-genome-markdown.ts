import {
  processInlineMarkdown,
  convertFilePath,
} from "@/utils/markdown-inline";
import { sanitizeHref } from "@/utils/sanitize-markup";

// Markdown parser for the deep_genome agent (relayed via Bot). Extracted verbatim
// from DeepGenomeResultViewer.vue: a pure function that only reads the `text` arg
// and returns { contentBlocks, headings, nestedHeadings }, which the caller writes
// into the corresponding refs. The output is injected into the DOM via v-html, so
// the escapeHtml → processInlineMarkdown sanitization pipeline must be preserved
// verbatim (see the @/utils/sanitize-markup invariant).

// --- Markdown conversion helpers ---
// escapeHtml is inlined verbatim from the component (not byte-identical to the
// exported implementation in @/utils/sanitize-markup; to guarantee zero behavior
// change, the component's original single-pass replace implementation is kept).
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

// Content blocks (for template v-for rendering):
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

// Flat heading item, counter-based id.
export interface Heading {
  id: string;
  text: string;
  level: number;
}

// Nested heading tree (h1 filtered out).
export interface NestedHeading extends Heading {
  children: NestedHeading[];
}

// --- Conversion logic ---
export function parseDeepGenomeMarkdown(
  text: string,
  ns = ""
): {
  contentBlocks: ContentBlock[];
  headings: Heading[];
  nestedHeadings: NestedHeading[];
} {
  const lines = text.split("\\n"); // split into lines
  // ns namespaces the inline [N] citation anchors so they target reference N of the SAME message.
  // All processInlineMarkdown calls below go through this alias so ns threads uniformly.
  const safeNs = ns.replace(/[^A-Za-z0-9-]/g, "");
  const inlineMd = (s: string): string => processInlineMarkdown(s, safeNs);
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

  // --- Convert table rows into an HTML string ---
  const generateTableHtml = (
    headers: string[],
    alignments: string[],
    rows: string[][]
  ) => {
    let html = '<table border="1" class="markdown-table"><thead><tr>';
    headers.forEach((header, index) => {
      // set th styling based on alignments
      let alignStyle = "";
      const align = alignments[index] ? alignments[index].trim() : "";
      if (align.startsWith(":") && align.endsWith(":")) {
        alignStyle = ' style="text-align: center;"';
      } else if (align.endsWith(":")) {
        alignStyle = ' style="text-align: right;"';
      } else if (align.startsWith(":")) {
        // default left-align; usually no explicit setting needed, but we add it
        alignStyle = ' style="text-align: left;"';
      } else {
        // default left-align
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

    // flags whether the current line is a table row already processed
    let isTableRowProcessed = false;

    // --- Table handling logic ---
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
      tableHeaders = headerCells.map((cell) => inlineMd(escapeHtml(cell)));

      i++; // skip the delimiter row
      const alignmentLine = lines[i];
      tableAlignments = alignmentLine
        .split("|")
        .map((cell) => cell.trim())
        .filter((cell) => cell.length > 0);

      tableRows = [];
      isTableRowProcessed = true; // mark the header row as processed
      continue; // Skip to next line
    } else if (isInTable) {
      if (isTableContent(line)) {
        const dataCells = line
          .split("|")
          .map((cell) => cell.trim())
          .filter((cell) => cell.length > 0);
        const processedRow = dataCells.map((cell) =>
          inlineMd(escapeHtml(cell))
        );
        tableRows.push(processedRow);
        isTableRowProcessed = true; // mark the table data row as processed
      } else {
        // table ended
        const tableHtml = generateTableHtml(
          tableHeaders,
          tableAlignments,
          tableRows
        );

        // add the table HTML to the current context
        if (isInH3Card) {
          currentH3CardContent += tableHtml;
        } else if (isInStandaloneContentAfterH2) {
          tempContentAfterH2 += tableHtml;
        } else if (isInStandaloneContentAfterH1) {
          tempContentAfterH1 += tableHtml;
        }

        // reset the table state
        isInTable = false;
        tableHeaders = [];
        tableAlignments = [];
        tableRows = [];

        // continue processing the current line (since it is not a table row)
        // use a flag to track whether the current line has been processed
        let currentLineProcessed = false;

        if (/^####\s(.*)/.test(line)) {
          const match = line.match(/^####\s(.*)/);
          const content = inlineMd(escapeHtml(match?.[1] ?? ""));
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
          const content = inlineMd(escapeHtml(match?.[1] ?? ""));
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
          const content = inlineMd(escapeHtml(match?.[1] ?? ""));
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
          const content = inlineMd(escapeHtml(match?.[1] ?? ""));
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
          // handle a normal text line immediately following the table's end
          const processedLineContent = `<p>${inlineMd(escapeHtml(line))}</p>`;
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
          currentLineProcessed = true; // even an empty line counts as processed
        }

        // if the current line was processed, skip the rest of this iteration
        if (currentLineProcessed) {
          continue;
        }
      }
    }

    // if it is a table row already processed, skip further handling
    if (isTableRowProcessed) {
      continue;
    }
    // --- End of table handling logic ---

    // --- Other content handling logic ---
    if (/^####\s(.*)/.test(line)) {
      const match = line.match(/^####\s(.*)/);
      const content = inlineMd(escapeHtml(match?.[1] ?? ""));
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
      const content = inlineMd(escapeHtml(match?.[1] ?? ""));
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
      const content = inlineMd(escapeHtml(match?.[1] ?? ""));
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

      // before adding a new h2 heading, flush the previous post-h2 standalone content
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
      const content = inlineMd(escapeHtml(match?.[1] ?? ""));
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
      // handle normal paragraphs, images, links, etc.
      const processedLineContent = `<p>${inlineMd(escapeHtml(line))}</p>`;
      const isLineContentEmpty = line.trim() === "";

      // check whether the current line contains an image
      const imageMatch = line.match(/!\[(.*?)\]\((.*?)\)/);

      if (imageMatch) {
        let imageHtml = "";
        const safeAlt = escapeHtml(imageMatch[1]);
        const safeSrc = sanitizeHref(convertFilePath(imageMatch[2]));

        if (line.match(/!\[(.*?)\]\((.*\.cif)\)/)) {
          imageHtml = `<div class="cif-container" data-src="${safeSrc}" data-alt="${safeAlt}"></div>`;
        } else {
          imageHtml = `<div style="text-align: center;width: 100%"><img src="${safeSrc}" alt="${safeAlt}" style="width: 70%; height: auto; cursor: zoom-in;" class="clickable-image" data-src="${safeSrc}" data-alt="${safeAlt}"></div>`;
        }
        // build the image HTML

        let captionHtml = "";

        // check whether the line after the image contains a caption (handling blank lines)
        // find the first non-empty line after the image as the caption
        let j = i + 1;
        while (j < lines.length && lines[j].trim() === "") {
          j++;
        }

        // if a non-empty line is found, treat it as the caption
        if (j < lines.length) {
          const captionLine = lines[j];
          // extract the caption text, keeping everything
          let captionText = captionLine.trim();
          // apply markdown processing to the caption so ** becomes a strong tag.
          // escapeHtml first, then inline processing (same path as headings/paragraphs/table cells),
          // so raw HTML in the agent/RAG caption (e.g. <img onerror>) becomes inert text
          // and does not execute via the v-html sink; legitimate **bold** is still converted to strong.
          captionText = inlineMd(escapeHtml(captionText));
          // build the caption HTML
          captionHtml = `<p style="text-align: center; margin-top: 8px;">${captionText}</p>`;
          // skip all lines from i+1 to j (including blank lines and the caption line)
          i = j;
        }

        // build the el-card structure containing the image and caption
        const imageCardHtml = `<div class="mb-20 image-card" shadow="hover">
              <div class="el-card__body" style="padding: 16px;">
                  <div style="text-align: center;">
                      ${imageHtml}
                      ${captionHtml}
                  </div>
              </div>
          </div>`;

        // add the image card based on the current context
        if (isInStandaloneContentAfterH1) {
          tempContentAfterH1 += imageCardHtml;
        } else if (isInH3Card) {
          currentH3CardContent += imageCardHtml;
        } else if (isInStandaloneContentAfterH2) {
          tempContentAfterH2 += imageCardHtml;
        }
      } else {
        // not an image; handle normally
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

  // --- Handle remaining state after the loop ---
  // handle a possibly unclosed table at the end of the file
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
    // ensure content following each h2 is handled as a separate el-card
    blocks.push({ type: "standalone-content", content: tempContentAfterH2 });
  }

  return {
    contentBlocks: blocks,
    headings: headingsList,
    nestedHeadings: buildNestedHeadings(headingsList),
  };

  // Helper: build the nested heading structure
  function buildNestedHeadings(flatHeadings: Heading[]): NestedHeading[] {
    const nested: NestedHeading[] = [];
    const stack: NestedHeading[] = [];

    flatHeadings.forEach((heading) => {
      // only handle h2, h3, h4 headings
      if (heading.level < 2 || heading.level > 4) {
        return;
      }

      // pop all stack entries at a level >= the current heading's
      while (
        stack.length > 0 &&
        stack[stack.length - 1].level >= heading.level
      ) {
        stack.pop();
      }

      // create a new heading object (copy to avoid mutating the original data)
      const newHeading = { ...heading, children: [] };

      // if the stack is empty, add to the root
      if (stack.length === 0) {
        nested.push(newHeading);
      } else {
        // otherwise add to the parent node's children array
        stack[stack.length - 1].children.push(newHeading);
      }

      // push the current heading onto the stack
      stack.push(newHeading);
    });

    return nested;
  }
}
