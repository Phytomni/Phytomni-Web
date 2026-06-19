import { describe, it, expect } from "vitest";
import {
  parseDeepGenomeMarkdown,
  type ContentBlock,
} from "@/utils/deep-genome-markdown";

// parseDeepGenomeMarkdown is the ~515-line stateful markdown parser extracted
// VERBATIM from DeepGenomeResultViewer.vue's convertMarkdown. It is PURE on its
// `text` argument and returns { contentBlocks, headings, nestedHeadings } that
// the component writes into its v-html-bound refs. Two invariants are locked
// here:
//   1. Golden-master block/heading shapes (so the extraction can't silently
//      drift the parse output the template renders).
//   2. The LOAD-BEARING v-html XSS pipeline: every agent/RAG-influenced text
//      path runs escapeHtml -> processInlineMarkdown before reaching a v-html
//      sink. The XSS specs below would go RED if escapeHtml were removed from
//      the pipeline (raw <img onerror>/<script> would survive live).
//
// IMPORTANT: the parser splits its input on the LITERAL two-char sequence "\n"
// (text.split("\\n")), NOT on real newlines — so every fixture below uses
// literal backslash-n ("\\n" in a JS string literal) as the line separator.

const NL = "\\n";
const join = (...lines: string[]) => lines.join(NL);

const findType = (blocks: ContentBlock[], type: string) =>
  blocks.find((b) => b.type === type);

describe("parseDeepGenomeMarkdown — block-type golden master", () => {
  it("emits an h1 block with id + processed content", () => {
    const { contentBlocks } = parseDeepGenomeMarkdown("# Main Title");
    const h1 = findType(contentBlocks, "h1");
    expect(h1).toBeDefined();
    expect(h1?.id).toBe("h1-1");
    expect(h1?.content).toBe("Main Title");
  });

  it("emits an h2 block with id + processed content", () => {
    const { contentBlocks } = parseDeepGenomeMarkdown("## Section");
    const h2 = findType(contentBlocks, "h2");
    expect(h2).toBeDefined();
    expect(h2?.id).toBe("h2-1");
    expect(h2?.content).toBe("Section");
  });

  it("emits an h4 block (outside an h3 card) with id + content", () => {
    // Standalone h4 with no enclosing h3 card pushes a top-level h4 block.
    const { contentBlocks } = parseDeepGenomeMarkdown("#### Detail");
    const h4 = findType(contentBlocks, "h4");
    expect(h4).toBeDefined();
    expect(h4?.id).toBe("h4-1");
    expect(h4?.content).toBe("Detail");
  });

  it("emits an h3-card block carrying header + body", () => {
    const md = join("### Card Heading", "Body paragraph with **bold** text.");
    const { contentBlocks } = parseDeepGenomeMarkdown(md);
    const card = findType(contentBlocks, "h3-card");
    expect(card).toBeDefined();
    expect(card?.id).toBe("h3-1");
    expect(card?.header).toBe("Card Heading");
    // Body is accumulated as <p>...</p> with inline markdown processed.
    expect(card?.body).toContain("<p>");
    expect(card?.body).toContain("<strong>bold</strong>");
  });

  it("emits a standalone-content block for paragraphs after an h2", () => {
    const md = join("## Intro", "Just a plain paragraph.");
    const { contentBlocks } = parseDeepGenomeMarkdown(md);
    const standalone = findType(contentBlocks, "standalone-content");
    expect(standalone).toBeDefined();
    expect(standalone?.content).toContain("<p>Just a plain paragraph.</p>");
  });

  it("renders a markdown table into the surrounding block body", () => {
    const md = join(
      "## Data",
      "| Gene | Score |",
      "| --- | --- |",
      "| BRCA1 | 9.5 |"
    );
    const { contentBlocks } = parseDeepGenomeMarkdown(md);
    const standalone = findType(contentBlocks, "standalone-content");
    expect(standalone).toBeDefined();
    expect(standalone?.content).toContain('<table border="1"');
    expect(standalone?.content).toContain("<th");
    expect(standalone?.content).toContain(">Gene</th>");
    expect(standalone?.content).toContain(">BRCA1</td>");
  });

  it("renders an image into a clickable-image standalone block", () => {
    const md = join("## Figures", "![diagram](https://example.com/a.png)");
    const { contentBlocks } = parseDeepGenomeMarkdown(md);
    const standalone = findType(contentBlocks, "standalone-content");
    expect(standalone).toBeDefined();
    expect(standalone?.content).toContain("image-card");
    expect(standalone?.content).toContain(
      '<img src="https://example.com/a.png"'
    );
    expect(standalone?.content).toContain('class="clickable-image"');
  });
});

describe("parseDeepGenomeMarkdown — headings + nested tree", () => {
  it("returns flat headings as { id, text, level } with a global counter", () => {
    const md = join("# Title", "## Section", "### Card", "#### Detail");
    const { headings } = parseDeepGenomeMarkdown(md);
    expect(headings).toEqual([
      { id: "h1-1", text: "Title", level: 1 },
      { id: "h2-2", text: "Section", level: 2 },
      { id: "h3-3", text: "Card", level: 3 },
      { id: "h4-4", text: "Detail", level: 4 },
    ]);
  });

  it("resets the id counter per call (deterministic)", () => {
    const md = "# Title";
    const first = parseDeepGenomeMarkdown(md).headings;
    const second = parseDeepGenomeMarkdown(md).headings;
    expect(first[0].id).toBe("h1-1");
    expect(second[0].id).toBe("h1-1"); // not h1-2 — counter is per call
    expect(first).toEqual(second);
  });

  it("builds an h2>h3>h4 nested tree and excludes h1", () => {
    const md = join("# Top", "## Sec", "### Sub", "#### Leaf");
    const { nestedHeadings } = parseDeepGenomeMarkdown(md);
    // h1 ("Top") is excluded from the nested tree.
    expect(nestedHeadings).toHaveLength(1);
    const sec = nestedHeadings[0];
    expect(sec.level).toBe(2);
    expect(sec.text).toBe("Sec");
    expect(sec.children).toHaveLength(1);
    const sub = sec.children[0];
    expect(sub.level).toBe(3);
    expect(sub.children).toHaveLength(1);
    expect(sub.children[0].level).toBe(4);
    expect(sub.children[0].text).toBe("Leaf");
  });
});

describe("parseDeepGenomeMarkdown — v-html XSS invariant (escapeHtml pipeline)", () => {
  it("escapes a raw <img onerror> smuggled into a paragraph", () => {
    const md = join("## Sec", '<img src=x onerror="alert(1)">');
    const { contentBlocks } = parseDeepGenomeMarkdown(md);
    const standalone = findType(contentBlocks, "standalone-content");
    const body = standalone?.content ?? "";
    // The dangerous tag is escaped to inert text — would be live if escapeHtml
    // were removed from the pipeline.
    expect(body).toContain("&lt;img");
    expect(body).not.toContain('onerror="alert(1)">');
  });

  it("escapes a raw <script> in a heading", () => {
    const { contentBlocks } = parseDeepGenomeMarkdown(
      "## <script>alert(1)</script>"
    );
    const h2 = findType(contentBlocks, "h2");
    const content = h2?.content ?? "";
    expect(content).toContain("&lt;script&gt;");
    expect(content).not.toContain("<script>");
  });

  it("escapes a raw tag smuggled into a table cell", () => {
    const md = join(
      "## Data",
      "| Gene | Note |",
      "| --- | --- |",
      '| BRCA1 | <img src=x onerror="alert(1)"> |'
    );
    const { contentBlocks } = parseDeepGenomeMarkdown(md);
    const body = findType(contentBlocks, "standalone-content")?.content ?? "";
    expect(body).toContain("&lt;img");
    expect(body).not.toContain('onerror="alert(1)">');
  });

  it("escapes a raw tag smuggled into an image caption", () => {
    const md = join(
      "## Figures",
      "![fig](https://example.com/a.png)",
      '<img src=x onerror="alert(1)">'
    );
    const { contentBlocks } = parseDeepGenomeMarkdown(md);
    const body = findType(contentBlocks, "standalone-content")?.content ?? "";
    // Caption text path is escapeHtml'd like every other block path.
    expect(body).toContain("&lt;img");
    expect(body).not.toContain('onerror="alert(1)">');
  });

  it("neutralizes a javascript: href in a .md link inside a paragraph", () => {
    // The .md-link path in processInlineMarkdown routes the URL through
    // sanitizeHref, which scheme-rejects javascript: -> href="#". NOTE the .md
    // URL regex is /\(([^)]+?\.md)\)/ — it cannot span a ")" inside the URL, so
    // the payload deliberately carries no inner parens.
    const md = join("## Refs", "See [doc](javascript:alert//evil.md).");
    const { contentBlocks } = parseDeepGenomeMarkdown(md);
    const body = findType(contentBlocks, "standalone-content")?.content ?? "";
    expect(body).not.toContain('href="javascript:');
    expect(body).toContain('href="#"');
  });

  it("does not resurrect a generic [x](javascript:...) link into a live anchor", () => {
    const md = join("## Refs", "Click [x](javascript:alert(1)) now.");
    const { contentBlocks } = parseDeepGenomeMarkdown(md);
    const body = findType(contentBlocks, "standalone-content")?.content ?? "";
    // No generic markdown-link regex exists, so it stays inert escaped text —
    // certainly no live anchor carrying a javascript: scheme.
    expect(body).not.toContain('href="javascript:');
    expect(body).not.toContain('<a href="javascript:');
  });
});
