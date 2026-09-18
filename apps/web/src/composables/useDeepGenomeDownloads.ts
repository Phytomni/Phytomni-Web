import { nextTick } from "vue";
import type { Ref, ComputedRef } from "vue";
import { saveAs } from "file-saver";
import { ElMessage } from "element-plus";
import { normalizePositiveTaskRowId } from "@/api/task";
import i18n from "@/locales";
import { downloadRenderingFile } from "@/utils/download-rendering-file";
import type { DisplayReference } from "@/utils/reference-renderer";
import { referenceListMarkdown } from "@/utils/citation-presentation";

export type DeepGenomeMainContentValue =
  HTMLElement | { $el?: Element | null } | null;

export interface DeepGenomeDownloadsOpts {
  props: {
    markdown: string;
    filename?: string;
    renderingFileId?: string;
  };
  mainContentRef: Ref<DeepGenomeMainContentValue>;
  displayReferences: ComputedRef<DisplayReference[]>;
  printReferencesRoot?: () => HTMLElement | null;
}

function resolveRenderingFileId(value: unknown): string {
  if (value == null || value === "") return "";
  try {
    return normalizePositiveTaskRowId(value as string | number);
  } catch {
    return "";
  }
}

const resolveMainElement = (
  value: DeepGenomeMainContentValue
): HTMLElement | null => {
  const candidate = value instanceof HTMLElement ? value : value?.$el;
  return candidate instanceof HTMLElement ? candidate : null;
};

export function useDeepGenomeDownloads(opts: DeepGenomeDownloadsOpts) {
  const { props, mainContentRef, displayReferences } = opts;

  // Download methods
  const downloadPDF = async () => {
    const renderingFileId = resolveRenderingFileId(props.renderingFileId);
    if (renderingFileId) {
      await downloadRenderingFile(renderingFileId, "PDF", (key) =>
        i18n.global.t(key)
      );
      return;
    }

    // create the print container
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

    // copy the current content
    const contentWrapper = document.createElement("div");
    contentWrapper.style.maxWidth = "210mm";
    contentWrapper.style.margin = "0 auto";
    contentWrapper.style.fontSize = "12pt";
    contentWrapper.style.pageBreakInside = "auto";
    contentWrapper.style.overflow = "visible";
    contentWrapper.style.height = "auto";

    // copy all content blocks
    const contentBlocksCopy = document.createElement("div");
    contentBlocksCopy.style.pageBreakInside = "auto";
    contentBlocksCopy.style.overflow = "visible";
    contentBlocksCopy.style.height = "auto";

    // grab everything inside el-main (excluding el-main itself)
    const originalElMain = resolveMainElement(mainContentRef.value);
    if (!originalElMain) return;
    const contentInsideElMain = document.createElement("div");

    // clone all child nodes inside el-main
    for (let i = 0; i < originalElMain.children.length; i++) {
      const childClone = originalElMain.children[i].cloneNode(true);
      contentInsideElMain.appendChild(childClone);
    }

    // Normalize each complete widget to its current decoded canvas image. The
    // print stylesheet must never expose toolbar or retained dialog markup.
    try {
      const blocks = originalElMain.querySelectorAll<HTMLElement>(
        ".scientific-cif-block"
      );
      const copies = contentInsideElMain.querySelectorAll(
        ".scientific-cif-block"
      );
      const snapshots = Array.from(blocks, (block, index) => {
        const viewers = block.querySelectorAll<HTMLElement>(
          ".scientific-cif-viewer"
        );
        const structure = viewers[0];
        const canvases = structure?.querySelectorAll("canvas");
        const canvas = canvases?.[0];
        const copy = copies[index];
        if (
          viewers.length !== 1 ||
          !structure ||
          canvases?.length !== 1 ||
          structure.dataset.scientificCifReady !== "true" ||
          !canvas ||
          !copy ||
          canvas.width === 0 ||
          canvas.height === 0
        )
          throw new Error("Structure is not ready to print");
        const image = document.createElement("img");
        image.className = "scientific-cif-print-snapshot";
        image.src = canvas.toDataURL("image/png");
        if (!image.src.startsWith("data:image/png;base64,")) {
          throw new Error("Structure snapshot is unavailable");
        }
        image.alt = structure.getAttribute("aria-label") ?? "";
        image.width = canvas.width;
        image.height = canvas.height;
        image.style.maxWidth = "100%";
        image.style.height = "auto";
        copy.replaceWith(image);
        return image;
      });
      if (snapshots.length > 0) {
        await Promise.all(snapshots.map((image) => image.decode()));
      }
    } catch {
      ElMessage.error(i18n.global.t("chat.printFailed"));
      return;
    }

    // Embedded reports display their canonical bibliography in a separate tab.
    // Copy that rendered bibliography, not its material actions, into the print.
    if (!contentInsideElMain.querySelector(".deep-genome-references")) {
      const references = opts.printReferencesRoot?.()?.cloneNode(true);
      if (references instanceof HTMLElement) {
        references
          .querySelectorAll("button, input, select, textarea, [aria-live]")
          .forEach((node) => node.remove());
        references
          .querySelectorAll<HTMLElement>(
            "[tabindex], [aria-current], .is-citation-target"
          )
          .forEach((node) => {
            node.removeAttribute("tabindex");
            node.removeAttribute("aria-current");
            node.classList.remove(
              "is-citation-target",
              "research-evidence-panel__item--active"
            );
          });
        contentInsideElMain.appendChild(references);
      }
    }

    // remove the download button group via its semantic shell hook
    const downloadButtonGroup = contentInsideElMain.querySelector(
      ".deep-genome-toolbar"
    );
    if (downloadButtonGroup) {
      downloadButtonGroup.remove();
    }

    // remove all height/overflow constraints that could affect printing
    const allElements = contentInsideElMain.querySelectorAll("*");
    allElements.forEach((element) => {
      // remove height/overflow limits from inline styles
      (element as HTMLElement).style.height = "auto";
      (element as HTMLElement).style.maxHeight = "none";
      (element as HTMLElement).style.overflow = "visible";
      (element as HTMLElement).style.minHeight = "auto";
      (element as HTMLElement).style.position = "static";
    });

    contentBlocksCopy.appendChild(contentInsideElMain);
    contentWrapper.appendChild(contentBlocksCopy);
    printContainer.appendChild(contentWrapper);

    // append to the document
    document.body.appendChild(printContainer);

    // show the print container
    printContainer.style.display = "block";

    // wait for all content to render
    await nextTick();

    // add print styles
    const style = document.createElement("style");
    style.innerHTML = `
    @media print {
      /* basic print setup */
      html, body { background: #fff !important; }
      body * { display: none; }
      #print-container { display: block !important; position: static !important; }

      /* ensure all elements inside print-container are shown */
      #print-container * {
        display: block !important;
      }

      /* ensure inline elements display normally */
      #print-container span,
      #print-container a,
      #print-container strong,
      #print-container em,
      #print-container sup,
      #print-container sub,
      #print-container code,
      #print-container b {
        display: inline !important;
      }

      #print-container .citation-reference-row {
        display: grid !important;
      }

      #print-container .citation-reference-row__links {
        display: flex !important;
      }

      /* fix table display - ensure correct table layout */
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

      /* remove all height/overflow constraints that could affect printing */
      * {
        height: auto !important;
        max-height: none !important;
        overflow: visible !important;
        min-height: auto !important;
        position: static !important;
      }

      /* forced pagination settings */
      #print-container {
        page-break-before: avoid;
        page-break-after: avoid;
      }

      /* avoid page breaks in unsuitable places */
      h1, h2, h3, h4 {
        page-break-after: avoid;
        page-break-inside: avoid;
      }

      .el-card, .card, table, img, p {
        page-break-inside: avoid;
      }

      /* ensure images display correctly */
      img {
        max-width: 100% !important;
        height: auto !important;
      }

      /* fix reference-number display */
      #print-container a[href*="-ref-"] {
        display: inline-block !important;
      }

      /* ensure content paginates correctly across multiple pages */
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

    // trigger print
    try {
      window.print();
    } catch (error) {
      ElMessage.error(i18n.global.t("chat.printFailed"));
      console.error("Print error:", error);
    } finally {
      printContainer.remove();
      style.remove();
    }
  };

  const downloadMarkdown = () => {
    // Preserve the report source exactly. Resource authorization is a render
    // concern; exports must never invent public paths from report strings.
    let convertedMarkdown = props.markdown;

    // add the references section
    if (displayReferences.value && displayReferences.value.length > 0) {
      convertedMarkdown +=
        "\n\n## References\n\n" +
        referenceListMarkdown(displayReferences.value) +
        "\n";
    }

    // create a Blob and download it
    const blob = new Blob([convertedMarkdown], {
      type: "text/markdown;charset=utf-8",
    });
    const filename = props.filename || "document.md";
    saveAs(blob, filename);
  };

  return { downloadPDF, downloadMarkdown };
}
