import { describe, it, expect } from "vitest";
import { sanitizeAnchorAttributes, sanitizeHref } from "@/utils/sanitizeMarkup";

// Locks the AF-001 fix: the <a> tags that DeepGenomeResultViewer resurrects
// from agent markdown and feeds to v-html must never carry an executable
// event handler or a dangerous-scheme href. The sanitizer is an attribute-NAME
// allow-list over a proper tokenizer, so any non-allowed attribute (every on*,
// style, formaction, ...) is dropped by construction.
describe("sanitizeAnchorAttributes — XSS hardening for resurrected <a> tags", () => {
  it("drops onclick handlers but keeps a benign href", () => {
    const out = sanitizeAnchorAttributes(
      'href="#" onclick="alert(document.cookie)"'
    );
    expect(out).not.toMatch(/onclick/i);
    expect(out).toContain('href="#"');
  });

  it("drops onmouseover (hover-triggered, zero-click) handlers", () => {
    const out = sanitizeAnchorAttributes(
      'href="https://example.org" onmouseover="steal()"'
    );
    expect(out).not.toMatch(/onmouseover/i);
    expect(out).toContain('href="https://example.org"');
  });

  it("drops a handler even when it is the FIRST attribute (no leading space)", () => {
    const out = sanitizeAnchorAttributes('onclick="x()" class="doi-link"');
    expect(out).not.toMatch(/onclick/i);
    expect(out).toContain('class="doi-link"');
  });

  // The boundary bypass the denylist regex missed: HTML lets an attribute start
  // right after the previous value's closing quote, with NO whitespace.
  it("drops a handler glued to the previous value with no separating space", () => {
    const out = sanitizeAnchorAttributes(
      'href="x"onmouseover="alert(document.cookie)"'
    );
    expect(out).not.toMatch(/onmouseover/i);
    expect(out).toContain('href="x"');
  });

  it("drops multiple no-space-glued handlers and neutralizes a glued javascript href", () => {
    const out = sanitizeAnchorAttributes(
      'class="c"href="javascript:alert(1)"onclick="y()"'
    );
    expect(out).not.toMatch(/onclick/i);
    expect(out).not.toMatch(/javascript:/i);
    expect(out).toContain('class="c"');
    expect(out).toContain('href="#"');
  });

  it("drops unquoted event handlers", () => {
    const out = sanitizeAnchorAttributes("onerror=alert(1)");
    expect(out).not.toMatch(/onerror/i);
  });

  it("drops case-mixed handlers (OnClick / ONMOUSEOVER)", () => {
    expect(sanitizeAnchorAttributes('OnClick="x()"')).not.toMatch(/onclick/i);
    expect(sanitizeAnchorAttributes('ONMOUSEOVER="x()"')).not.toMatch(
      /onmouseover/i
    );
  });

  it("drops attributes outside the allow-list (style, formaction)", () => {
    const out = sanitizeAnchorAttributes(
      'href="#" style="position:fixed" formaction="javascript:x()"'
    );
    expect(out).toBe('href="#"');
  });

  it("neutralizes a javascript: href to #", () => {
    expect(sanitizeAnchorAttributes('href="javascript:alert(1)"')).toBe(
      'href="#"'
    );
  });

  it("neutralizes data: and vbscript: hrefs", () => {
    expect(sanitizeAnchorAttributes('href="data:text/html,<b>x</b>"')).toBe(
      'href="#"'
    );
    expect(sanitizeAnchorAttributes("href='vbscript:msgbox(1)'")).toBe(
      'href="#"'
    );
  });

  it("neutralizes javascript: with leading whitespace and mixed case", () => {
    expect(sanitizeAnchorAttributes('href="  JaVaScRiPt:alert(1)"')).toBe(
      'href="#"'
    );
  });

  // A scheme obfuscated with a named entity (&Tab;) or numeric entities must
  // still be decoded and rejected, not slip through as an "unknown scheme".
  it("neutralizes an entity-obfuscated javascript scheme (&Tab; / &#58; / &#x3a;)", () => {
    expect(sanitizeAnchorAttributes('href="java&Tab;script:alert(1)"')).toBe(
      'href="#"'
    );
    expect(sanitizeAnchorAttributes('href="javascript&#58;alert(1)"')).toBe(
      'href="#"'
    );
    expect(sanitizeAnchorAttributes('href="javascript&#x3a;alert(1)"')).toBe(
      'href="#"'
    );
  });

  it("preserves legitimate https href plus benign attributes", () => {
    const out = sanitizeAnchorAttributes(
      'href="https://pubmed.ncbi.nlm.nih.gov/123" target="_blank" class="pmid-link"'
    );
    expect(out).toContain('href="https://pubmed.ncbi.nlm.nih.gov/123"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('class="pmid-link"');
  });

  it("preserves a mailto href and a title attribute", () => {
    const out = sanitizeAnchorAttributes(
      'href="mailto:a@b.org" title="contact"'
    );
    expect(out).toContain('href="mailto:a@b.org"');
    expect(out).toContain('title="contact"');
  });

  it("preserves relative / #anchor hrefs and the download boolean attribute", () => {
    const out = sanitizeAnchorAttributes('href="#ref-3" download');
    expect(out).toContain('href="#ref-3"');
    expect(out).toContain("download");
  });

  it("preserves a converted attachment path href (unquoted relative value)", () => {
    const out = sanitizeAnchorAttributes(
      "href=/attachments/report.md download"
    );
    expect(out).toContain('href="/attachments/report.md"');
    expect(out).toContain("download");
  });

  it("escapes a quote inside a kept value to prevent attribute breakout", () => {
    const out = sanitizeAnchorAttributes("title='a\"b' href='#'");
    expect(out).toContain("&quot;");
    expect(out).not.toContain('"b"'); // no raw breakout
  });

  it("drops the handler while keeping a safe href on the same tag", () => {
    const out = sanitizeAnchorAttributes('href="https://x" onclick="bad()"');
    expect(out).toContain('href="https://x"');
    expect(out).not.toMatch(/onclick/i);
  });

  it("returns an empty string for empty input", () => {
    expect(sanitizeAnchorAttributes("")).toBe("");
  });
});

// Defense-in-depth for the doi/pmid/.md links that interpolate a URL straight
// into a fixed <a href="..."> rendered through v-html.
describe("sanitizeHref — scheme allow-list for interpolated href URLs", () => {
  it("passes through a legitimate https URL unchanged", () => {
    expect(sanitizeHref("https://doi.org/10.1234/abc")).toBe(
      "https://doi.org/10.1234/abc"
    );
  });

  it("passes through a pubmed URL built from a numeric pmid", () => {
    expect(sanitizeHref("https://pubmed.ncbi.nlm.nih.gov/12345")).toBe(
      "https://pubmed.ncbi.nlm.nih.gov/12345"
    );
  });

  it("neutralizes a javascript: URL to #", () => {
    expect(sanitizeHref("javascript:alert(1)")).toBe("#");
  });

  it("neutralizes a javascript: scheme smuggled past a .md suffix", () => {
    // [x](javascript:alert(1)//.md) would otherwise match the .md link regex.
    expect(sanitizeHref("javascript:alert(1)//.md")).toBe("#");
  });

  it("escapes a quote/angle-bracket breakout in an otherwise-safe URL", () => {
    const out = sanitizeHref(
      'https://pubmed.ncbi.nlm.nih.gov/"><img onerror=x>'
    );
    expect(out).not.toContain('"><img');
    expect(out).toContain("&quot;");
    expect(out).toContain("&lt;");
  });

  it("returns # for an empty URL", () => {
    expect(sanitizeHref("")).toBe("#");
  });
});
