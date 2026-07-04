import { describe, it, expect } from "vitest";
import { renderStreamingMarkdown } from "@/views/chat/streaming/incrementalMarkdown";

describe("renderStreamingMarkdown — safe incremental rendering", () => {
  it("escapes raw HTML in agent text (no live tags)", () => {
    const html = renderStreamingMarkdown('<img src=x onerror="alert(1)">');
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("closes a dangling bold marker so it renders instead of leaking **", () => {
    const html = renderStreamingMarkdown("partial **bold");
    expect(html).toContain("<strong>");
    expect(html).not.toContain("**bold");
  });

  it("does not close bold markers inside an open code span", () => {
    // an unclosed inline-code run must not gain a spurious </strong>
    const html = renderStreamingMarkdown("text `code **still");
    expect(html).not.toContain("<strong>");
  });

  it("renders complete bold normally", () => {
    expect(renderStreamingMarkdown("**done**")).toContain("<strong>done</strong>");
  });

  it("keeps [N] literal when no ns is given (citation scope gate)", () => {
    const html = renderStreamingMarkdown("see [3]");
    expect(html).not.toContain("href");
    expect(html).toContain("[3]");
  });

  it("namespaces [N] anchors when ns is passed (P1 cited streaming)", () => {
    const html = renderStreamingMarkdown("see [3]", "m4");
    expect(html).toContain('href="#m4-ref-3"');
  });
});
