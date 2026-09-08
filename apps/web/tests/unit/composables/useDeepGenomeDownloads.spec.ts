import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref, computed, nextTick } from "vue";
import { ElMessage } from "element-plus";
import { buildBinaryResponse } from "../../helpers/apiBuilders";
import { mustGet } from "../../helpers/mockFactories";
import { buildDisplayReferences } from "@/utils/reference-renderer";
import contractReferences from "../../fixtures/cited-contract.generated.json";
import contract from "../../../../server/common/document_format/testdata/cited-contract.json";

// file-saver mock — hoisted so the vi.mock factory can reference it
const mockSaveAs = vi.hoisted(() => vi.fn());
const mockGetFileDownUrlApi = vi.hoisted(() => vi.fn());

vi.mock("file-saver", () => ({
  saveAs: mockSaveAs,
}));

vi.mock("element-plus", () => ({
  ElMessage: { error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/api/chat", () => ({
  getFileDownUrlApi: mockGetFileDownUrlApi,
}));

import { useDeepGenomeDownloads } from "@/composables/useDeepGenomeDownloads";
import type { DisplayReference } from "@/utils/reference-renderer";

// ──────────────────────────────────────────────────────────────────────────────
// Characterization test — downloadMarkdown
// ──────────────────────────────────────────────────────────────────────────────

describe("useDeepGenomeDownloads — downloadMarkdown", () => {
  it("produces the reviewed eight-slot Markdown bibliography from the actual Blob", async () => {
    const { downloadMarkdown } = useDeepGenomeDownloads(
      makeOpts(
        contract.content,
        "contract.md",
        buildDisplayReferences(contractReferences, "contract")
      )
    );
    downloadMarkdown();
    const [blob] = mockSaveAs.mock.calls[0];
    const text = await (blob as Blob).text();
    expect(text.startsWith(contract.content + "\n\n## References\n\n")).toBe(
      true
    );
    const bibliography = text.split("\n\n## References\n\n")[1];
    const sentences = bibliography
      .split("\n")
      .filter((line) => /^\d+\. /.test(line))
      .map((line) =>
        line
          .replace(/^\d+\. /, "")
          .replaceAll("*", "")
          .replace(/\\(.)/g, "$1")
      );
    expect(sentences).toEqual(contract.expected.sentences);
    const links = [...bibliography.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)].map(
      (match) => ({ label: match[1], href: match[2].replace(/^<|>$/g, "") })
    );
    expect(links).toEqual(
      contract.expected.links.map(({ label, href }) => ({ label, href }))
    );
    for (const emphasis of contract.expected.emphasis) {
      const row = bibliography
        .split("\n")
        .find((line) => line.startsWith(`${emphasis.index}. `));
      const marker = "bold" in emphasis ? "**" : "*";
      expect(row).toContain(marker + emphasis.text + marker);
    }
  });
  beforeEach(() => {
    mockSaveAs.mockReset();
  });

  function makeOpts(
    markdown: string,
    filename: string | undefined,
    refs: DisplayReference[]
  ) {
    return {
      props: { markdown, filename },
      mainContentRef: ref(null),
      displayReferences: computed(() => refs),
    };
  }

  it("calls saveAs using props.filename as the file name", () => {
    const opts = makeOpts("# Hello", "report.md", []);
    const { downloadMarkdown } = useDeepGenomeDownloads(opts);
    downloadMarkdown();

    expect(mockSaveAs).toHaveBeenCalledOnce();
    const [blob, filename] = mockSaveAs.mock.calls[0];
    expect(filename).toBe("report.md");
    expect(blob).toBeInstanceOf(Blob);
  });

  it("falls back to document.md when filename is undefined", () => {
    const opts = makeOpts("content", undefined, []);
    const { downloadMarkdown } = useDeepGenomeDownloads(opts);
    downloadMarkdown();

    const [, filename] = mockSaveAs.mock.calls[0];
    expect(filename).toBe("document.md");
  });

  it("Blob contains the markdown content", async () => {
    const opts = makeOpts("# Test\nsome content", "out.md", []);
    const { downloadMarkdown } = useDeepGenomeDownloads(opts);
    downloadMarkdown();

    const [blob] = mockSaveAs.mock.calls[0];
    const text = await (blob as Blob).text();
    expect(text).toContain("# Test");
    expect(text).toContain("some content");
  });

  it("serialized output includes ## References and entries when references exist", async () => {
    const refs = [
      {
        citation: {
          runs: [
            { text: "Journal", italic: true },
            { text: " " },
            { text: "12", bold: true },
          ],
          links: [
            { label: "PubMed", href: "https://pubmed.ncbi.nlm.nih.gov/123/" },
          ],
        },
        id: "m-ref-1",
        index: 1,
      },
      { citation: null, id: "m-ref-2", index: 2 },
    ];
    const opts = makeOpts("Body text.", "out.md", refs);
    const { downloadMarkdown } = useDeepGenomeDownloads(opts);
    downloadMarkdown();

    const [blob] = mockSaveAs.mock.calls[0];
    const text = await (blob as Blob).text();

    expect(text).toBe(
      "Body text.\n\n## References\n\n1. *Journal* **12**\n\n   [PubMed](https://pubmed.ncbi.nlm.nih.gov/123/)\n\n2. Reference details unavailable.\n"
    );
  });

  it("does not append a References section when there are no references", async () => {
    const opts = makeOpts("Body.", "out.md", []);
    const { downloadMarkdown } = useDeepGenomeDownloads(opts);
    downloadMarkdown();

    const [blob] = mockSaveAs.mock.calls[0];
    const text = await (blob as Blob).text();
    expect(text).not.toContain("## References");
  });

  it("preserves the original Markdown source and literal backslash text", async () => {
    const opts = makeOpts("line1\\nline2", "out.md", []);
    const { downloadMarkdown } = useDeepGenomeDownloads(opts);
    downloadMarkdown();

    const [blob] = mockSaveAs.mock.calls[0];
    const text = await (blob as Blob).text();
    expect(text).toContain("line1\\nline2");
    expect(text).not.toContain("line1\nline2");
  });

  it("does not rewrite report resource paths during Markdown export", async () => {
    const source = "![Figure](./.out/result.png) [Report](report.md)";
    const opts = makeOpts(source, "out.md", []);
    const { downloadMarkdown } = useDeepGenomeDownloads(opts);
    downloadMarkdown();

    const [blob] = mockSaveAs.mock.calls[0];
    expect(await (blob as Blob).text()).toBe(source);
  });

  it("Blob MIME type is text/markdown", () => {
    const opts = makeOpts("text", "out.md", []);
    const { downloadMarkdown } = useDeepGenomeDownloads(opts);
    downloadMarkdown();

    const [blob] = mockSaveAs.mock.calls[0];
    expect((blob as Blob).type).toBe("text/markdown;charset=utf-8");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// smoke — downloadPDF (DOM/print-heavy: verify it does not throw)
// ──────────────────────────────────────────────────────────────────────────────

describe("useDeepGenomeDownloads — downloadPDF smoke", () => {
  it("does not append a second bibliography when the viewer already renders references", async () => {
    const main = document.createElement("div");
    const references = document.createElement("section");
    references.className = "deep-genome-references";
    main.appendChild(references);
    const printReferencesRoot = vi.fn(() => document.createElement("section"));
    const print = spyOnPrint().mockImplementation(() => undefined);
    const { downloadPDF } = useDeepGenomeDownloads({
      props: { markdown: "# Report" },
      mainContentRef: ref(main),
      displayReferences: computed(() => []),
      printReferencesRoot,
    });
    await downloadPDF();
    expect(printReferencesRoot).not.toHaveBeenCalled();
    expect(print).toHaveBeenCalledOnce();
  });
  function spyOnPrint() {
    if (typeof window.print !== "function") {
      Object.defineProperty(window, "print", {
        configurable: true,
        writable: true,
        value: () => undefined,
      });
    }
    return vi.spyOn(window, "print");
  }

  it("does not wait for the synchronous native print call before cleanup", async () => {
    const fakeEl = document.createElement("div");
    fakeEl.appendChild(document.createElement("p"));
    const mainContentRef = ref({ $el: fakeEl });
    const printPromise = new Promise<void>(() => undefined);
    const printSpy = spyOnPrint().mockReturnValue(
      printPromise as unknown as void
    );

    const { downloadPDF } = useDeepGenomeDownloads({
      props: { markdown: "# PDF test", filename: "report.md" },
      mainContentRef,
      displayReferences: computed(() => []),
    });

    const downloadPromise = downloadPDF();
    await nextTick();
    expect(document.querySelector("#print-container")).toBeNull();
    await downloadPromise;
    printSpy.mockRestore();
  });

  it("excludes the semantic download toolbar from the print clone", async () => {
    const fakeEl = document.createElement("div");
    const toolbar = document.createElement("div");
    toolbar.className = "deep-genome-toolbar";
    toolbar.appendChild(document.createElement("button"));
    fakeEl.append(toolbar, document.createElement("p"));
    const mainContentRef = ref({ $el: fakeEl });

    let toolbarWasCloned = true;
    const printSpy = spyOnPrint().mockImplementation(() => {
      toolbarWasCloned = Boolean(
        document
          .querySelector("#print-container")
          ?.querySelector(".deep-genome-toolbar")
      );
    });

    const { downloadPDF } = useDeepGenomeDownloads({
      props: { markdown: "# PDF test", filename: "report.md" },
      mainContentRef,
      displayReferences: computed(() => []),
    });

    await downloadPDF();
    expect(toolbarWasCloned).toBe(false);
    printSpy.mockRestore();
  });

  it("prints rendered canonical reference links without clipping or leaked print styles", async () => {
    const fakeEl = document.createElement("div");
    const reference = document.createElement("div");
    reference.className = "doc-list-item";
    reference.style.height = "20px";
    reference.style.maxHeight = "20px";
    reference.style.minHeight = "20px";
    reference.style.overflow = "hidden";
    reference.style.position = "relative";
    reference.innerHTML =
      '<div class="citation-reference-row"><span>1.</span><span><em>Journal</em> <strong>12</strong></span><a href="https://pubmed.ncbi.nlm.nih.gov/123/">PubMed</a></div>';
    fakeEl.appendChild(reference);
    const mainContentRef = ref({ $el: fakeEl });
    const originalStyleCount = document.head.querySelectorAll("style").length;
    let printedText = "";
    let printedHref = "";
    let printedStyle = "";
    const printSpy = spyOnPrint().mockImplementation(() => {
      const printReference = document
        .querySelector("#print-container")
        ?.querySelector<HTMLElement>(".doc-list-item");
      printedText = printReference?.textContent ?? "";
      printedHref =
        printReference?.querySelector("a")?.getAttribute("href") ?? "";
      printedStyle = [
        printReference?.style.height,
        printReference?.style.maxHeight,
        printReference?.style.minHeight,
        printReference?.style.overflow,
        printReference?.style.position,
      ].join("|");
    });

    const { downloadPDF } = useDeepGenomeDownloads({
      props: { markdown: "# PDF test", filename: "report.md" },
      mainContentRef,
      displayReferences: computed(() => []),
    });

    await downloadPDF();

    expect(printedText).toBe("1.Journal 12PubMed");
    expect(printedHref).toBe("https://pubmed.ncbi.nlm.nih.gov/123/");
    expect(printedStyle).toBe("auto|none|auto|visible|static");
    expect(document.querySelector("#print-container")).toBeNull();
    expect(document.head.querySelectorAll("style")).toHaveLength(
      originalStyleCount
    );
    printSpy.mockRestore();
  });

  it("cleans up the temporary print surface when native print throws", async () => {
    const fakeEl = document.createElement("div");
    fakeEl.appendChild(document.createElement("p"));
    const originalStyleCount = document.head.querySelectorAll("style").length;
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const printSpy = spyOnPrint().mockImplementation(() => {
      throw new Error("print unavailable");
    });
    const { downloadPDF } = useDeepGenomeDownloads({
      props: { markdown: "# PDF test", filename: "report.md" },
      mainContentRef: ref({ $el: fakeEl }),
      displayReferences: computed(() => []),
    });

    await expect(downloadPDF()).resolves.toBeUndefined();

    expect(document.querySelector("#print-container")).toBeNull();
    expect(document.head.querySelectorAll("style")).toHaveLength(
      originalStyleCount
    );
    expect(consoleError).toHaveBeenCalledWith(
      "Print error:",
      expect.objectContaining({ message: "print unavailable" })
    );
    printSpy.mockRestore();
  });

  it("does not throw given a stub mainContentRef", async () => {
    // Build a minimal stub with $el, simulating an ElMain component instance
    const fakeEl = document.createElement("div");
    fakeEl.appendChild(document.createElement("p"));
    const mainContentRef = ref({ $el: fakeEl });

    // mock window.print to avoid a real print
    const printSpy = spyOnPrint().mockResolvedValue(undefined);

    const opts = {
      props: { markdown: "# PDF test", filename: "report.md" },
      mainContentRef,
      displayReferences: computed(() => []),
    };
    const { downloadPDF } = useDeepGenomeDownloads(opts);

    await expect(downloadPDF()).resolves.toBeUndefined();
    expect(printSpy).toHaveBeenCalledOnce();

    printSpy.mockRestore();
  });

  it("prints from a native embedded main element without requiring an Element Plus $el", async () => {
    const nativeMain = document.createElement("main");
    nativeMain.appendChild(document.createElement("p"));
    const mainContentRef = ref<HTMLElement | null>(nativeMain);
    const printSpy = spyOnPrint().mockResolvedValue(undefined);

    const { downloadPDF } = useDeepGenomeDownloads({
      props: { markdown: "# Embedded PDF", filename: "embedded.md" },
      mainContentRef,
      displayReferences: computed(() => []),
    });

    await expect(downloadPDF()).resolves.toBeUndefined();
    expect(printSpy).toHaveBeenCalledOnce();

    printSpy.mockRestore();
  });

  it("skips printing when the main content ref has no DOM element", async () => {
    const printSpy = spyOnPrint().mockResolvedValue(undefined);

    const { downloadPDF } = useDeepGenomeDownloads({
      props: { markdown: "# Missing content", filename: "missing.md" },
      mainContentRef: ref(null),
      displayReferences: computed(() => []),
    });

    await expect(downloadPDF()).resolves.toBeUndefined();
    expect(printSpy).not.toHaveBeenCalled();

    printSpy.mockRestore();
  });
});

describe("useDeepGenomeDownloads — CIF print snapshots", () => {
  function reportWithStructure(state = "true") {
    const main = document.createElement("main");
    const structure = document.createElement("div");
    structure.className = "scientific-cif-viewer";
    structure.dataset.scientificCifReady = state;
    structure.setAttribute("aria-label", "Scientific structure viewer");
    const canvas = document.createElement("canvas");
    canvas.width = 1480;
    canvas.height = 600;
    structure.appendChild(canvas);
    main.appendChild(structure);
    return { main, structure, canvas };
  }

  function downloads(main: HTMLElement) {
    return useDeepGenomeDownloads({
      props: { markdown: "# Structure" },
      mainContentRef: ref(main),
      displayReferences: computed(() => []),
    });
  }

  beforeEach(() => {
    vi.mocked(ElMessage.error).mockClear();
  });

  it("prints decoded PNG snapshots in source order without altering live canvases or ordinary images", async () => {
    const first = reportWithStructure();
    const second = reportWithStructure();
    second.canvas.width = 400;
    second.canvas.height = 800;
    first.main.appendChild(second.structure);
    const ordinaryImage = document.createElement("img");
    ordinaryImage.src = "/case-figure.png";
    first.main.appendChild(ordinaryImage);
    const unrelatedCanvas = document.createElement("canvas");
    first.main.appendChild(unrelatedCanvas);
    const capture = vi
      .spyOn(HTMLCanvasElement.prototype, "toDataURL")
      .mockReturnValueOnce("data:image/png;base64,Zmlyc3Q=")
      .mockReturnValueOnce("data:image/png;base64,c2Vjb25k");
    const decode = vi
      .spyOn(HTMLImageElement.prototype, "decode")
      .mockResolvedValue(undefined);
    const sourceMarkup = first.main.innerHTML;
    const styleCount = document.head.querySelectorAll("style").length;
    const print = vi.spyOn(window, "print").mockImplementation(() => {
      const printed = mustGet(
        document.querySelector("#print-container"),
        "PDF print container"
      );
      const snapshots = [
        ...printed.querySelectorAll<HTMLImageElement>(
          ".scientific-cif-viewer img"
        ),
      ];
      expect(snapshots.map((item) => item.src)).toEqual([
        "data:image/png;base64,Zmlyc3Q=",
        "data:image/png;base64,c2Vjb25k",
      ]);
      expect(snapshots.map((item) => [item.width, item.height])).toEqual([
        [1480, 600],
        [400, 800],
      ]);
      expect(
        snapshots.every((item) => item.alt === "Scientific structure viewer")
      ).toBe(true);
      expect(snapshots.every((item) => item.style.height === "auto")).toBe(
        true
      );
      expect(
        printed.querySelectorAll(".scientific-cif-viewer canvas")
      ).toHaveLength(0);
      expect(printed.querySelectorAll("canvas")).toHaveLength(1);
      expect(
        printed.querySelector('img[src="/case-figure.png"]')
      ).not.toBeNull();
      expect(decode).toHaveBeenCalledTimes(2);
    });

    await downloads(first.main).downloadPDF();

    expect(print).toHaveBeenCalledOnce();
    expect(capture).toHaveBeenCalledTimes(2);
    expect(capture).toHaveBeenNthCalledWith(1, "image/png");
    expect(first.main.innerHTML).toBe(sourceMarkup);
    expect(first.structure.firstElementChild).toBe(first.canvas);
    expect(document.querySelector("#print-container")).toBeNull();
    expect(document.head.querySelectorAll("style")).toHaveLength(styleCount);
    expect(ElMessage.error).not.toHaveBeenCalled();
  });

  it("waits until the snapshot is decoded before opening print", async () => {
    const { main } = reportWithStructure();
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
      "data:image/png;base64,c25hcHNob3Q="
    );
    let finishDecode!: () => void;
    const decode = vi
      .spyOn(HTMLImageElement.prototype, "decode")
      .mockReturnValue(
        new Promise<void>((resolve) => {
          finishDecode = resolve;
        })
      );
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);

    const pending = downloads(main).downloadPDF();
    await nextTick();
    expect(decode).toHaveBeenCalledOnce();
    expect(print).not.toHaveBeenCalled();
    finishDecode();
    await pending;
    expect(print).toHaveBeenCalledOnce();
  });

  it.each([
    "pending",
    "missing canvas",
    "zero size",
    "empty snapshot",
    "capture throws",
    "decode rejects",
  ])(
    "shows a controlled error without printing a blank structure when %s",
    async (failure) => {
      const { main, structure, canvas } = reportWithStructure();
      const capture = vi
        .spyOn(HTMLCanvasElement.prototype, "toDataURL")
        .mockReturnValue("data:image/png;base64,c25hcHNob3Q=");
      const decode = vi
        .spyOn(HTMLImageElement.prototype, "decode")
        .mockResolvedValue(undefined);
      if (failure === "pending")
        structure.dataset.scientificCifReady = "pending";
      if (failure === "missing canvas") canvas.remove();
      if (failure === "zero size") canvas.width = 0;
      if (failure === "empty snapshot") capture.mockReturnValue("data:,");
      if (failure === "capture throws")
        capture.mockImplementation(() => {
          throw new Error("private source details");
        });
      if (failure === "decode rejects")
        decode.mockRejectedValue(new Error("private source details"));
      const print = vi
        .spyOn(window, "print")
        .mockImplementation(() => undefined);
      const styleCount = document.head.querySelectorAll("style").length;
      const sourceMarkup = main.innerHTML;

      await expect(downloads(main).downloadPDF()).resolves.toBeUndefined();

      expect(print).not.toHaveBeenCalled();
      expect(ElMessage.error).toHaveBeenCalledOnce();
      expect(ElMessage.error).toHaveBeenCalledWith("Print failed");
      expect(main.innerHTML).toBe(sourceMarkup);
      expect(document.querySelector("#print-container")).toBeNull();
      expect(document.head.querySelectorAll("style")).toHaveLength(styleCount);
    }
  );
});

describe("useDeepGenomeDownloads — downloadPDF rendering-file", () => {
  beforeEach(() => {
    mockGetFileDownUrlApi.mockReset();
    mockSaveAs.mockReset();
  });

  function spyOnPrint() {
    if (typeof window.print !== "function") {
      Object.defineProperty(window, "print", {
        configurable: true,
        writable: true,
        value: () => undefined,
      });
    }
    return vi.spyOn(window, "print");
  }

  function stubBlobDownload() {
    const createObjectURL = vi
      .spyOn(window.URL, "createObjectURL")
      .mockReturnValue("blob:deep-genome-pdf");
    const revokeObjectURL = vi
      .spyOn(window.URL, "revokeObjectURL")
      .mockImplementation(() => undefined);
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    return { createObjectURL, revokeObjectURL, clickSpy };
  }

  it("downloads a PDF attachment and never opens the print dialog", async () => {
    const { clickSpy } = stubBlobDownload();
    mockGetFileDownUrlApi.mockResolvedValueOnce(
      buildBinaryResponse("deepgenome_1.pdf", "%PDF-1.4")
    );
    const printSpy = spyOnPrint();
    const capture = vi.spyOn(HTMLCanvasElement.prototype, "toDataURL");

    const { downloadPDF } = useDeepGenomeDownloads({
      props: {
        markdown: "# Deep genome report",
        filename: "report.md",
        renderingFileId: "42",
      },
      mainContentRef: ref(null),
      displayReferences: computed(() => []),
    });

    await downloadPDF();

    expect(printSpy).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
    expect(mockGetFileDownUrlApi).toHaveBeenCalledOnce();
    const [data] = mustGet(
      mockGetFileDownUrlApi.mock.calls[0],
      "DeepGenome rendering-file request"
    );
    expect(data).toBeInstanceOf(FormData);
    expect((data as FormData).get("id")).toBe("42");
    expect((data as FormData).get("document_format")).toBe("PDF");
    expect(clickSpy).toHaveBeenCalledOnce();

    printSpy.mockRestore();
    clickSpy.mockRestore();
  });

  it("does not treat a non-numeric artifact id as a rendering-file row", async () => {
    const printSpy = spyOnPrint().mockImplementation(() => undefined);
    mockGetFileDownUrlApi.mockResolvedValueOnce(
      buildBinaryResponse("should-not-download.pdf")
    );

    const fakeEl = document.createElement("div");
    fakeEl.appendChild(document.createElement("p"));

    const { downloadPDF } = useDeepGenomeDownloads({
      props: {
        markdown: "# Demo report",
        renderingFileId: "deep-genome-demo",
      },
      mainContentRef: ref(fakeEl),
      displayReferences: computed(() => []),
    });

    await downloadPDF();

    expect(mockGetFileDownUrlApi).not.toHaveBeenCalled();
    expect(printSpy).toHaveBeenCalledOnce();
    printSpy.mockRestore();
  });
});
