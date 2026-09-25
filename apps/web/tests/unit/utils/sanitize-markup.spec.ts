import { describe, expect, it } from "vitest";
import {
  sanitizeHref,
  safeHrefValue,
  escapeHtml,
} from "@/utils/sanitize-markup";

describe("sanitizeHref — scheme allow-list for reviewed HTML URLs", () => {
  it.each([
    "https://doi.org/10.1234/abc",
    "https://pubmed.ncbi.nlm.nih.gov/12345",
    "mailto:research@example.org",
    "/attachments/report.md",
    "#ref-3",
  ])("keeps a safe URL and escapes it for HTML: %s", (url) => {
    expect(sanitizeHref(url)).toBe(url);
  });

  it.each([
    "",
    "javascript:alert(1)",
    "javascript:alert(1)//.md",
    "data:text/html,nope",
    "vbscript:msgbox(1)",
  ])("neutralizes an unsafe URL: %s", (url) => {
    expect(sanitizeHref(url)).toBe("#");
  });

  it("escapes a quote/angle-bracket breakout in a safe URL", () => {
    const out = sanitizeHref(
      'https://pubmed.ncbi.nlm.nih.gov/\"><img onerror=x>'
    );
    expect(out).not.toContain('\"><img');
    expect(out).toContain("&quot;");
    expect(out).toContain("&lt;");
  });
});

describe("safeHrefValue — Vue-bound href values", () => {
  it.each([
    "/attachments/report.md",
    "#ref-3",
    "http://example.org/report",
    "https://example.org/report",
    "mailto:research@example.org",
  ])("keeps a safe URL value unchanged: %s", (url) => {
    expect(safeHrefValue(url)).toBe(url);
  });

  it.each([
    "",
    "javascript:alert(1)",
    "data:text/html,nope",
    "vbscript:msgbox(1)",
    "java&Tab;script:alert(1)",
    "java\nscript:alert(1)",
  ])("rejects an unsafe URL value: %s", (url) => {
    expect(safeHrefValue(url)).toBeNull();
  });
});

describe("escapeHtml — reviewed text boundaries", () => {
  it("encodes the five HTML-significant characters", () => {
    expect(escapeHtml(`& < > \" '`)).toBe("&amp; &lt; &gt; &quot; &#039;");
  });

  it("neutralizes an onerror image payload into inert text", () => {
    const out = escapeHtml('<img src=x onerror="alert(1)">');
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
    expect(out).toContain("&quot;");
  });

  it("encodes ampersands once and coerces unknown input", () => {
    expect(escapeHtml("a&b")).toBe("a&amp;b");
    expect(escapeHtml(123 as unknown as string)).toBe("123");
    expect(escapeHtml(null as unknown as string)).toBe("");
    expect(escapeHtml(undefined as unknown as string)).toBe("");
  });
});
