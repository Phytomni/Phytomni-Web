import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref, computed, nextTick } from "vue";
import { buildBinaryResponse } from "../../helpers/apiBuilders";
import { mustGet } from "../../helpers/mockFactories";

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

// ──────────────────────────────────────────────────────────────────────────────
// Characterization test — downloadMarkdown
// ──────────────────────────────────────────────────────────────────────────────

describe("useDeepGenomeDownloads — downloadMarkdown", () => {
  beforeEach(() => {
    mockSaveAs.mockReset();
  });

  function makeOpts(
    markdown: string,
    filename: string | undefined,
    refs: Array<{ html?: string; id?: string }>
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
      { html: "<div>1. Smith et al. 2023</div>", id: "ref-1" },
      { html: "<div>2. Jones 2022</div>", id: "ref-2" },
    ];
    const opts = makeOpts("Body text.", "out.md", refs);
    const { downloadMarkdown } = useDeepGenomeDownloads(opts);
    downloadMarkdown();

    const [blob] = mockSaveAs.mock.calls[0];
    const text = await (blob as Blob).text();

    expect(text).toContain("## References");
    // Numbering starts at 1, with the original numbering prefix in the HTML removed
    expect(text).toContain("1. Smith et al. 2023");
    expect(text).toContain("2. Jones 2022");
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
