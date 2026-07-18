import { describe, it, expect } from "vitest";
import { renderLegalMarkdown } from "@/legal/renderLegalMarkdown";

describe("renderLegalMarkdown", () => {
  it("escapes raw HTML instead of executing it", () => {
    const html = renderLegalMarkdown('Hello <script>alert(1)</script>');
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("renders headings, paragraphs, lists, and safe links", () => {
    const src = [
      "# Title",
      "",
      "Para with **bold** and [site](https://example.com).",
      "",
      "- item one",
      "- item two",
      "",
      "---",
    ].join("\n");
    const html = renderLegalMarkdown(src);
    expect(html).toContain("<h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain("<ul>");
    expect(html).toContain("<hr");
  });

  it("neutralizes javascript: links", () => {
    const html = renderLegalMarkdown("[x](javascript:alert(1))");
    expect(html).not.toMatch(/href\s*=\s*["']javascript:/i);
  });

  it("does not hang on #### or #without-space lines", () => {
    const html = renderLegalMarkdown("#### Extra\n#NoSpace\nOK paragraph");
    expect(html).toContain("Extra");
    expect(html).toContain("NoSpace");
    expect(html).toContain("OK paragraph");
  });
});
