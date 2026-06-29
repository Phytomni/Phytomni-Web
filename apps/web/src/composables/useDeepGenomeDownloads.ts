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

  // Download methods
  const downloadPDF = async () => {
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
    const originalElMain = mainContentRef.value.$el;
    const contentInsideElMain = document.createElement("div");

    // clone all child nodes inside el-main
    for (let i = 0; i < originalElMain.children.length; i++) {
      const childClone = originalElMain.children[i].cloneNode(true);
      contentInsideElMain.appendChild(childClone);
    }

    // remove the download button group (via a more specific selector)
    const downloadButtonGroup = contentInsideElMain.querySelector(
      'div[style*="position: sticky"]'
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
      #print-container code,
      #print-container b {
        display: inline !important;
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
      #print-container a[href^="#ref-"] {
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
      await window.print();
    } catch (error) {
      ElMessage.error("Print failed");
      console.error("Print error:", error);
    }

    // remove the print container
    document.body.removeChild(printContainer);
  };

  const downloadMarkdown = () => {
    // build the converted Markdown content
    let convertedMarkdown = props.markdown;

    // handle line breaks - convert escaped \n into real newlines
    convertedMarkdown = convertedMarkdown.replace(/\\n/g, "\n");

    // convert image paths
    convertedMarkdown = convertedMarkdown.replace(
      /!\[(.*?)\]\((.*?)\)/g,
      (match, alt, src) => {
        const convertedSrc = convertFilePath(src);
        return `![${alt}](${convertedSrc})`;
      }
    );

    // convert link paths
    convertedMarkdown = convertedMarkdown.replace(
      /\[([^\]]+?)\]\(([^)]+?)\)/g,
      (match, text, url) => {
        // skip links that already start with http/https
        if (url.startsWith("http://") || url.startsWith("https://")) {
          return match;
        }
        const convertedUrl = convertFilePath(url);
        return `[${text}](${convertedUrl})`;
      }
    );

    // add the references section
    if (displayReferences.value && displayReferences.value.length > 0) {
      convertedMarkdown += "\n\n## References\n";

      displayReferences.value.forEach((ref, index) => {
        const refIndex = index + 1;
        let refText = "";

        // extract plain text from HTML, stripping HTML tags
        if (ref.html) {
          // create a temporary element to parse the HTML
          const tempElement = document.createElement("div");
          tempElement.innerHTML = ref.html;

          // get plain text and drop the reference number (we add it manually)
          let plainText = tempElement.textContent || tempElement.innerText || "";
          plainText = plainText.trim();

          // remove the leading number and dot (e.g. "1. ")
          plainText = plainText.replace(/^\d+\.\s+/, "");

          refText = plainText;
        }

        // add the formatted reference entry
        convertedMarkdown += `${refIndex}. ${refText}\n`;
      });
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
