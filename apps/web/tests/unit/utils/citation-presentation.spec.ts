import { describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { mountWithApp } from "../../helpers/test-app-context";
import ScientificMarkdown from "@/components/ScientificMarkdown.vue";
import {
  citationPlainText,
  citationMarkdown,
  decodeCitationPresentation,
  referenceListPlainText,
  referenceListMarkdown,
} from "@/utils/citation-presentation";
import { decodeCitationDocuments } from "@/views/chat/utils/format";

const p = {
  runs: [
    { text: "Journal", italic: true },
    { text: " " },
    { text: "12", bold: true },
  ],
  links: [{ label: "PubMed", href: "https://pubmed.ncbi.nlm.nih.gov/123/" }],
};

async function render(source: string) {
  const wrapper = mountWithApp(ScientificMarkdown, { props: { source } });
  await vi.dynamicImportSettled();
  await nextTick();
  await Promise.resolve();
  await nextTick();
  return wrapper;
}

describe("canonical citation presentation", () => {
  it("serializes the same emphasis and external target", () => {
    expect(citationPlainText(p)).toBe("Journal 12");
    expect(citationMarkdown(p)).toBe(
      "*Journal* **12**\n\n[PubMed](https://pubmed.ncbi.nlm.nih.gov/123/)"
    );
  });
  it.each([
    "https://example.org/?q=&copy;",
    "https://example.org/?q=&#169;",
    "https://example.org/?q=&#xA9;",
    "https://example.org/a(b)?q=&copy;&next=&#169;",
  ])("preserves the exact decoded Markdown destination %s", async (href) => {
    const wrapper = await render(
      citationMarkdown({
        runs: [{ text: "Title" }],
        links: [{ label: "Article", href }],
      })
    );
    expect(wrapper.get("a").attributes("href")).toBe(href);
    wrapper.unmount();
  });
  it.each([
    {
      name: "punctuation-adjacent italic",
      runs: [
        { text: "gene" },
        { text: "(ABC)", italic: true },
        { text: "marker" },
      ],
      paragraphs: ["gene(ABC)marker"],
      italic: ["(ABC)"],
      bold: [],
    },
    {
      name: "punctuation-adjacent bold",
      runs: [
        { text: "gene" },
        { text: "(ABC)", bold: true },
        { text: "marker" },
      ],
      paragraphs: ["gene(ABC)marker"],
      italic: [],
      bold: ["(ABC)"],
    },
    {
      name: "punctuation-adjacent both",
      runs: [
        { text: "gene" },
        { text: "(ABC)", bold: true, italic: true },
        { text: "marker" },
      ],
      paragraphs: ["gene(ABC)marker"],
      italic: ["(ABC)"],
      bold: ["(ABC)"],
    },
    {
      name: "italic across paragraphs",
      runs: [{ text: "Alpha\n\nBeta", italic: true }],
      paragraphs: ["Alpha", "Beta"],
      italic: ["Alpha", "Beta"],
      bold: [],
    },
    {
      name: "both across paragraphs",
      runs: [{ text: "Alpha\n\nBeta", italic: true, bold: true }],
      paragraphs: ["Alpha", "Beta"],
      italic: ["Alpha", "Beta"],
      bold: ["Alpha", "Beta"],
    },
    {
      name: "adjacent different emphasis",
      runs: [
        { text: "Alpha", italic: true },
        { text: "(Beta)", bold: true },
        { text: "Gamma", italic: true, bold: true },
      ],
      paragraphs: ["Alpha(Beta)Gamma"],
      italic: ["Alpha", "Gamma"],
      bold: ["(Beta)", "Gamma"],
    },
    {
      name: "punctuation-only span",
      runs: [{ text: "gene" }, { text: "!", italic: true }, { text: "marker" }],
      paragraphs: ["gene!marker"],
      italic: ["!"],
      bold: [],
    },
    {
      name: "Unicode neighbors",
      runs: [{ text: "α" }, { text: "(ABC)", italic: true }, { text: "β" }],
      paragraphs: ["α(ABC)β"],
      italic: ["(ABC)"],
      bold: [],
    },
    {
      name: "literal delimiters with both flags",
      runs: [
        { text: "pre" },
        { text: "*x_[y]", italic: true, bold: true },
        { text: "post" },
      ],
      paragraphs: ["pre*x_[y]post"],
      italic: ["*x_[y]"],
      bold: ["*x_[y]"],
    },
    {
      name: "paragraph and word boundaries",
      runs: [
        { text: "pre" },
        { text: "(Alpha)\n\n(Beta)", italic: true },
        { text: "post" },
      ],
      paragraphs: ["pre(Alpha)", "(Beta)post"],
      italic: ["(Alpha)", "(Beta)"],
      bold: [],
    },
    {
      name: "alternate marker before plain word",
      runs: [
        { text: "Alpha", italic: true },
        { text: "Beta", bold: true },
        { text: "Gamma" },
      ],
      paragraphs: ["AlphaBetaGamma"],
      italic: ["Alpha"],
      bold: ["Beta"],
    },
    {
      name: "both flags adjacent to punctuation-only style",
      runs: [
        { text: "A", italic: true, bold: true },
        { text: "!", italic: true },
        { text: "B" },
      ],
      paragraphs: ["A!B"],
      italic: ["A", "!"],
      bold: ["A"],
    },
    {
      name: "non-BMP letter neighbors",
      runs: [{ text: "𐐀" }, { text: "!", italic: true }, { text: "𐐁" }],
      paragraphs: ["𐐀!𐐁"],
      italic: ["!"],
      bold: [],
    },
  ])(
    "preserves parsed scientific text and emphasis: $name",
    async ({ runs, paragraphs, italic, bold }) => {
      const wrapper = await render(citationMarkdown({ runs, links: [] }));
      expect(
        wrapper.findAll("p").map((node) => node.element.textContent)
      ).toEqual(paragraphs);
      expect(
        wrapper.findAll("em").map((node) => node.element.textContent)
      ).toEqual(italic);
      expect(
        wrapper.findAll("strong").map((node) => node.element.textContent)
      ).toEqual(bold);
      expect(wrapper.find("img, code, pre").exists()).toBe(false);
      wrapper.unmount();
    }
  );
  it("validates runs, flags, link labels and URLs without recovering metadata", () => {
    expect(decodeCitationPresentation(p)).toEqual(p);
    for (const value of [
      null,
      [],
      {},
      { runs: [], links: [] },
      { runs: [{ text: 2 }], links: [] },
      { runs: [{ text: "T", bold: "yes" }], links: [] },
      {
        runs: [{ text: "T" }],
        links: [{ label: "<img>", href: "https://example.org" }],
      },
    ])
      expect(decodeCitationPresentation(value)).toBeNull();
  });
  it.each([
    "javascript:alert(1)",
    "data:text/html,x",
    "mailto:test@example.org",
    "//example.org",
    "https://user:pass@example.org",
    "https://@example.org",
    "https:example.org",
    "https://example.org/%0a",
    "https://example.org/?x=%7f",
    "https://example.org/\n",
  ])("rejects unsafe destinations: %s", (href) => {
    expect(
      decodeCitationPresentation({ ...p, links: [{ label: "Article", href }] })
    ).toBeNull();
  });
  it("preserves malformed array slots in the shared chat decoder", () => {
    expect(
      decodeCitationDocuments([
        { citation: p, title: "Original" },
        null,
        42,
        { citation: p },
      ])
    ).toEqual([
      { citation: p, title: "Original" },
      { citation: null },
      { citation: null },
      { citation: p },
    ]);
    expect(decodeCitationDocuments(null)).toBeUndefined();
  });
  it("serializes numbered rows and fixed link labels without dropping rejected positions", () => {
    const rows = [
      { id: "m-ref-1", index: 1, citation: p },
      { id: "m-ref-2", index: 2, citation: null },
    ];
    expect(referenceListPlainText(rows)).toBe(
      "1. Journal 12\nPubMed: https://pubmed.ncbi.nlm.nih.gov/123/\n\n2. Reference details unavailable."
    );
    expect(referenceListMarkdown(rows)).toBe(
      "1. *Journal* **12**\n\n   [PubMed](https://pubmed.ncbi.nlm.nih.gov/123/)\n\n2. Reference details unavailable."
    );
  });
  it("protects literal delimiters, HTML, entities and block syntax in rendered Markdown", async () => {
    const text =
      "<img src=x onerror=x> &copy; *literal* _literal_ [1](x) `code`\n# heading\n1. list\n> quote\n---\n    indented";
    const markdown = citationMarkdown({ runs: [{ text }], links: [] });
    expect(markdown).toBe(
      "\\<img src=x onerror=x\\> \\&copy; \\*literal\\* \\_literal\\_ \\[1\\]\\(x\\) \\`code\\`\n\\# heading\n1\\. list\n\\> quote\n\\---\n&#32;   indented"
    );
    const wrapper = await render(markdown);
    expect(
      wrapper.find("img, h1, ol, blockquote, hr, pre, code, a, em").exists()
    ).toBe(false);
    // mdast-util-to-hast trims line-prefix spaces in paragraph text nodes.
    // Source escaping stays exact; indentation must not become a code block.
    expect(wrapper.get("p").element.textContent).toBe(
      "<img src=x onerror=x> &copy; *literal* _literal_ [1](x) `code`\n# heading\n1. list\n> quote\n---\nindented"
    );
    wrapper.unmount();
  });
  it("protects Markdown block syntax split across canonical runs", async () => {
    const wrapper = await render(
      citationMarkdown({
        runs: [{ text: "1" }, { text: ". list\n" }, { text: "# heading" }],
        links: [],
      })
    );
    expect(wrapper.find("ol, h1").exists()).toBe(false);
    expect(wrapper.text()).toBe("1. list\n# heading");
    wrapper.unmount();
  });
  it("preserves combined emphasis, edge whitespace and unusual safe link targets", async () => {
    const wrapper = await render(
      citationMarkdown({
        runs: [{ text: " Both ", bold: true, italic: true }],
        links: [{ label: "Article", href: "https://example.org/a(b)?x=1&y=2" }],
      })
    );
    expect(wrapper.get("em strong, strong em").text()).toBe("Both");
    expect(wrapper.get("a").attributes("href")).toBe(
      "https://example.org/a(b)?x=1&y=2"
    );
    wrapper.unmount();
  });
});
