import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref, computed } from "vue";

// file-saver mock — hoisted so the vi.mock factory can reference it
const mockSaveAs = vi.hoisted(() => vi.fn());

vi.mock("file-saver", () => ({
  saveAs: mockSaveAs,
}));

vi.mock("element-plus", () => ({
  ElMessage: { error: vi.fn() },
}));

// convertFilePath: pass through the original path (the unit test does not exercise path-conversion logic)
vi.mock("@/utils/markdown-inline", () => ({
  processInlineMarkdown: vi.fn((s: string) => s),
  convertFilePath: vi.fn((s: string) => s),
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

  it("escaped \\n is expanded into an actual newline", async () => {
    const opts = makeOpts("line1\\nline2", "out.md", []);
    const { downloadMarkdown } = useDeepGenomeDownloads(opts);
    downloadMarkdown();

    const [blob] = mockSaveAs.mock.calls[0];
    const text = await (blob as Blob).text();
    expect(text).toContain("line1\nline2");
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
  it("excludes the semantic download toolbar from the print clone", async () => {
    const fakeEl = document.createElement("div");
    const toolbar = document.createElement("div");
    toolbar.className = "deep-genome-toolbar";
    toolbar.appendChild(document.createElement("button"));
    fakeEl.append(toolbar, document.createElement("p"));
    const mainContentRef = ref({ $el: fakeEl });

    let toolbarWasCloned = true;
    const printSpy = vi.spyOn(window, "print").mockImplementation(async () => {
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
    const printSpy = vi.spyOn(window, "print").mockResolvedValue(undefined);

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
});
