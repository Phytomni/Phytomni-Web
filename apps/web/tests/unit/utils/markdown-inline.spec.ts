import { describe, it, expect } from "vitest";
import {
  processInlineMarkdown,
  convertFilePath,
} from "@/utils/markdown-inline";

// processInlineMarkdown is the inline-markdown processor extracted from
// DeepGenomeResultViewer. It carries the LOAD-BEARING v-html XSS invariant: the
// agent/RAG markdown it processes is attacker-influenceable (Bot-relayed), and
// its output is fed straight into v-html sinks. Resurrected <a> tags route
// through sanitizeAnchorAttributes and interpolated .md hrefs through
// sanitizeHref. These specs lock that invariant — coverage the component spec
// (which only exercised displayReferences) lacked.
describe("processInlineMarkdown — XSS-critical paths", () => {
  // Escaped-anchor resurrection: a benign escaped <a> comes back as a live
  // anchor with its safe href intact.
  it("resurrects a benign escaped <a> into a live anchor", () => {
    const out = processInlineMarkdown(
      "&lt;a href=&quot;https://example.com&quot;&gt;link&lt;/a&gt;"
    );
    expect(out).toContain('<a href="https://example.com"');
    expect(out).toContain(">link</a>");
  });

  // Dangerous-href neutralization: a resurrected anchor with a javascript:
  // href must have it neutralized by sanitizeAnchorAttributes (href -> #).
  it("neutralizes a javascript: href in a resurrected anchor", () => {
    const out = processInlineMarkdown(
      "&lt;a href=&quot;javascript:alert(1)&quot;&gt;x&lt;/a&gt;"
    );
    expect(out).not.toMatch(/javascript:/i);
    expect(out).toContain('href="#"');
    expect(out).toContain(">x</a>");
  });

  // Glued event-handler drop: HTML lets an attribute start right after the
  // previous value's closing quote with NO separating space — the exact bypass
  // the attribute-NAME allow-list (not an on* denylist) defends against.
  it("drops an onmouseover handler glued to href with no separating space", () => {
    const out = processInlineMarkdown(
      "&lt;a href=&quot;x&quot;onmouseover=&quot;y&quot;&gt;t&lt;/a&gt;"
    );
    expect(out).not.toMatch(/onmouseover/i);
    expect(out).toContain('href="x"');
    expect(out).toContain(">t</a>");
  });

  // .md links interpolate a converted URL into a fixed <a href="...">; the URL
  // routes through sanitizeHref (scheme allow-list + attribute escaping).
  it("renders a sanitized .md download link", () => {
    const out = processInlineMarkdown("[doc](path/file.md)");
    expect(out).toContain('<a href="path/file.md"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain("download");
    expect(out).toContain(">doc</a>");
  });

  it("neutralizes a javascript: scheme smuggled past a .md suffix", () => {
    // A .md-suffixed URL carrying a dangerous scheme matches the .md link regex
    // (the URL group is [^)]+? so it must not contain a literal ")"); sanitizeHref
    // must reject the scheme and emit href="#".
    const out = processInlineMarkdown("[x](javascript:alert1//.md)");
    expect(out).not.toMatch(/javascript:/i);
    expect(out).toContain('href="#"');
  });
});

describe("processInlineMarkdown — markdown rendering", () => {
  it("converts a markdown image to an <img> with convertFilePath applied", () => {
    const out = processInlineMarkdown("![alt](https://x/p.png)");
    expect(out).toContain('<img src="https://x/p.png"');
    expect(out).toContain('alt="alt"');
    expect(out).toContain('class="clickable-image"');
    expect(out).toContain('data-src="https://x/p.png"');
  });

  it("applies convertFilePath to image .out/ paths", () => {
    const out = processInlineMarkdown("![alt](./.out/figure.png)");
    expect(out).toContain('<img src="/attachments/figure.png"');
  });

  it("converts bold, italic and inline code", () => {
    expect(processInlineMarkdown("**b**")).toContain("<strong>b</strong>");
    expect(processInlineMarkdown("`c`")).toContain("<code>c</code>");
  });

  it("converts a .cif image to a cif-container div", () => {
    const out = processInlineMarkdown("![mol](structure.cif)");
    expect(out).toContain('<div class="cif-container"');
    expect(out).toContain('data-src="structure.cif"');
    expect(out).toContain('data-alt="mol"');
  });

  it("converts a bracketed numeric reference into an anchor", () => {
    const out = processInlineMarkdown("see [3]");
    expect(out).toContain('href="#ref-3"');
    expect(out).toContain(">[3]</a>");
  });

  it("returns falsy input unchanged", () => {
    expect(processInlineMarkdown("")).toBe("");
  });
});

// Raw-HTML passthrough CONTRACT: processInlineMarkdown does NOT escape raw HTML.
// By design, its CALLERS escape first (processInlineMarkdown(escapeHtml(text))),
// so a raw <img onerror=...> passed in directly (i.e. WITHOUT prior escaping)
// comes back UNCHANGED — it is not a markdown construct the processor touches.
// This is the contract the caption-XSS fix relies on: the component escapeHtml's
// every block path before calling this util; if the util silently escaped raw
// HTML itself, callers could grow complacent and the invariant would be diffuse.
describe("processInlineMarkdown — raw-HTML passthrough contract (callers escape first)", () => {
  it("returns raw, non-markdown HTML unchanged (does NOT escape it)", () => {
    const raw = "<img src=x onerror=y>";
    expect(processInlineMarkdown(raw)).toBe(raw);
  });
});

describe("convertFilePath", () => {
  it("rewrites a ./.out/ path to the attachments base URL", () => {
    expect(convertFilePath("./.out/report.png")).toBe(
      "/attachments/report.png"
    );
  });

  it("leaves a path without .out/ unchanged", () => {
    expect(convertFilePath("https://example.com/p.png")).toBe(
      "https://example.com/p.png"
    );
  });

  it("returns falsy input unchanged", () => {
    expect(convertFilePath("")).toBe("");
  });
});
