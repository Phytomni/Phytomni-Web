import { describe, it, expect } from "vitest";
import {
  processInlineMarkdown,
  convertFilePath,
} from "@/utils/markdown-inline";
import { escapeHtml } from "@/utils/sanitize-markup";

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

  it("neutralizes dangerous image and CIF schemes after caller escaping", () => {
    const imageOut = processInlineMarkdown(
      escapeHtml("![photo](javascript:evil.png)")
    );
    const cifOut = processInlineMarkdown(
      escapeHtml("![model](javascript:evil.cif)")
    );

    const host = document.createElement("div");
    host.innerHTML = imageOut + cifOut;
    expect(host.querySelector("img")?.getAttribute("src")).toBe("#");
    expect(
      host.querySelector(".cif-container")?.getAttribute("data-src")
    ).toBe("#");
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

describe("processInlineMarkdown citation namespacing", () => {
  it("namespaces the [N] anchor with ns when provided", () => {
    const out = processInlineMarkdown("see [1] and [2]", "m4");
    expect(out).toContain('href="#m4-ref-1"');
    expect(out).toContain('href="#m4-ref-2"');
  });

  it("falls back to #ref-N when ns is absent (back-compat)", () => {
    const out = processInlineMarkdown("see [1]");
    expect(out).toContain('href="#ref-1"');
  });

  it("widens the citation match to three digits", () => {
    const out = processInlineMarkdown("see [123]", "m4");
    expect(out).toContain('href="#m4-ref-123"');
  });

  it("does not emit the inert @click attribute", () => {
    const out = processInlineMarkdown("see [1]", "m4");
    expect(out).not.toContain("@click");
    expect(out).not.toContain("jumpTo");
  });

  it("sanitizes illegal characters out of ns", () => {
    const out = processInlineMarkdown("see [1]", 'a b"<x');
    expect(out).toContain('href="#abx-ref-1"');
  });
});

// Regex-reentrancy guard (emitted-HTML vault). The inline passes run in
// sequence over the whole line; without the vault, a later image/citation pass
// re-scans the <a href="..."> markup the resurrection pass just produced and
// can splice a tag INSIDE the href value whose " breaks out of the attribute,
// letting the browser's tag-soup parser recover an on*-handler (a real,
// executable XSS at the v-html sink). The sink escapes first, so these mirror
// the real pipeline: escapeHtml -> processInlineMarkdown.
describe("processInlineMarkdown — regex-reentrancy XSS guard", () => {
  const renderInline = (raw: string, ns = ""): string =>
    processInlineMarkdown(escapeHtml(raw), ns);

  it("does not break out of a resurrected href via image-markdown (onclick)", () => {
    const out = renderInline(
      '<a href="![x](onclick=window.__poc=1//)">click</a>'
    );
    // The image pass must NOT re-enter the anchor's href: no live <img>, and
    // above all no attribute the browser could parse as an event handler.
    expect(/<[^>]*\sonclick=/i.test(out)).toBe(false);
    expect(out).not.toContain("<img");
  });

  it("does not break out of a resurrected href via image-markdown (onmouseover)", () => {
    const out = renderInline('<a href="![x](onmouseover=alert(1)//)">x</a>');
    expect(/<[^>]*\sonmouseover=/i.test(out)).toBe(false);
    expect(out).not.toContain("<img");
  });

  it("does not re-enter a resurrected href via citation-markdown", () => {
    // A [N]-shaped payload inside a resurrected href must stay literal text in
    // the attribute, not spawn a second nested anchor.
    const out = renderInline('<a href="/x?q=[1]">link</a>');
    expect((out.match(/<a\s/g) ?? []).length).toBe(1);
  });

  // Regression: legitimate markdown outside any resurrected tag still renders.
  it("still renders a standalone image", () => {
    const out = renderInline("![photo](/attachments/pic.png)");
    expect(out).toContain("<img");
    expect(out).toContain('alt="photo"');
    expect(out).toContain("clickable-image");
  });

  it("still renders a standalone citation and a resurrected anchor together", () => {
    const out = renderInline('<a href="/docs/x.pdf">doc</a> see [3]', "m4");
    expect(out).toContain('href="/docs/x.pdf"');
    expect(out).toContain(">doc</a>");
    expect(out).toContain('href="#m4-ref-3"');
  });

  it("expands nested tokens fully - a clickable image leaves no sentinel", () => {
    // The .md-link pass stashes an anchor whose inner text is the image
    // pass's token; a single-pass expand would leak the inner sentinel.
    // expandVault must reach a fixed point.
    const out = renderInline("[![alt](/p.png)](/doc.md)");
    expect(out).toContain('href="/doc.md"');
    expect(out).toContain("<img");
    expect(out).toContain('alt="alt"');
    expect(out).not.toContain(String.fromCharCode(0xe000));
    expect(out).not.toMatch(/MD\d+/);
  });

  it("leaves no vault sentinel or token in the output (nested)", () => {
    // Nested constructs (image inside link) are the case that can leak; a
    // flat sibling input cannot, so this must exercise nesting.
    const out = renderInline("[![i](/b.png)](/c.md) and [1] **bold**", "m1");
    expect(out).not.toContain(String.fromCharCode(0xe000));
    expect(out).not.toMatch(/MD\d+/);
  });
});
