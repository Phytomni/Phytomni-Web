import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref, computed } from "vue";

// file-saver mock — hoisted 以便 vi.mock factory 引用
const mockSaveAs = vi.hoisted(() => vi.fn());

vi.mock("file-saver", () => ({
  saveAs: mockSaveAs,
}));

vi.mock("element-plus", () => ({
  ElMessage: { error: vi.fn() },
}));

// convertFilePath: 透传原始路径（单元测试不测路径转换逻辑）
vi.mock("@/utils/markdown-inline", () => ({
  processInlineMarkdown: vi.fn((s: string) => s),
  convertFilePath: vi.fn((s: string) => s),
}));

import { useDeepGenomeDownloads } from "@/composables/useDeepGenomeDownloads";

// ──────────────────────────────────────────────────────────────────────────────
// 特征(characterization)测试 — downloadMarkdown
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

  it("调用 saveAs 并使用 props.filename 作为文件名", () => {
    const opts = makeOpts("# Hello", "report.md", []);
    const { downloadMarkdown } = useDeepGenomeDownloads(opts);
    downloadMarkdown();

    expect(mockSaveAs).toHaveBeenCalledOnce();
    const [blob, filename] = mockSaveAs.mock.calls[0];
    expect(filename).toBe("report.md");
    expect(blob).toBeInstanceOf(Blob);
  });

  it("filename 未定义时回退到 document.md", () => {
    const opts = makeOpts("content", undefined, []);
    const { downloadMarkdown } = useDeepGenomeDownloads(opts);
    downloadMarkdown();

    const [, filename] = mockSaveAs.mock.calls[0];
    expect(filename).toBe("document.md");
  });

  it("Blob 包含 markdown 内容", async () => {
    const opts = makeOpts("# Test\nsome content", "out.md", []);
    const { downloadMarkdown } = useDeepGenomeDownloads(opts);
    downloadMarkdown();

    const [blob] = mockSaveAs.mock.calls[0];
    const text = await (blob as Blob).text();
    expect(text).toContain("# Test");
    expect(text).toContain("some content");
  });

  it("有参考文献时序列化输出包含 ## References 和条目", async () => {
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
    // 编号从 1 开始，移除了原有 HTML 中的编号前缀
    expect(text).toContain("1. Smith et al. 2023");
    expect(text).toContain("2. Jones 2022");
  });

  it("无参考文献时不追加 References 节", async () => {
    const opts = makeOpts("Body.", "out.md", []);
    const { downloadMarkdown } = useDeepGenomeDownloads(opts);
    downloadMarkdown();

    const [blob] = mockSaveAs.mock.calls[0];
    const text = await (blob as Blob).text();
    expect(text).not.toContain("## References");
  });

  it("转义的 \\n 被展开为实际换行符", async () => {
    const opts = makeOpts("line1\\nline2", "out.md", []);
    const { downloadMarkdown } = useDeepGenomeDownloads(opts);
    downloadMarkdown();

    const [blob] = mockSaveAs.mock.calls[0];
    const text = await (blob as Blob).text();
    expect(text).toContain("line1\nline2");
  });

  it("Blob MIME type 为 text/markdown", () => {
    const opts = makeOpts("text", "out.md", []);
    const { downloadMarkdown } = useDeepGenomeDownloads(opts);
    downloadMarkdown();

    const [blob] = mockSaveAs.mock.calls[0];
    expect((blob as Blob).type).toBe("text/markdown;charset=utf-8");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// smoke — downloadPDF（DOM/print-heavy: 验证不抛异常）
// ──────────────────────────────────────────────────────────────────────────────

describe("useDeepGenomeDownloads — downloadPDF smoke", () => {
  it("给定 stub mainContentRef 时不抛异常", async () => {
    // 构造一个带 $el 的最小 stub，模拟 ElMain 组件实例
    const fakeEl = document.createElement("div");
    fakeEl.appendChild(document.createElement("p"));
    const mainContentRef = ref({ $el: fakeEl });

    // mock window.print 避免真实打印
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
