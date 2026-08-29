import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildDisplayReferences } from "@/utils/reference-renderer";
import { invalidInput } from "../../helpers/invalidInput";

const REFERENCE_SOURCE = readFileSync(
  resolve(__dirname, "../../../src/utils/reference-renderer.ts"),
  "utf8"
);
const buildReferences = (references: readonly unknown[]) =>
  buildDisplayReferences(references, "test");

// Direct unit tests for the reference renderer extracted from
// DeepGenomeResultViewer. references come from the Bot `formatted.references`
// reshape (attacker-influenceable via agent output / RAG) and each entry's
// `html` is fed straight to a v-html sink. This locks the XSS invariant:
// every agent text field is escapeHtml'd and DOI/PubMed hrefs are
// sanitizeHref scheme-checked.

describe("buildDisplayReferences — XSS invariant", () => {
  it("keeps URL interpolation routed through the shared href sanitizer", () => {
    expect(REFERENCE_SOURCE).toContain("sanitizeHref");
  });

  it("returns [] for empty / runtime-invalid nullish input", () => {
    expect(buildReferences([])).toEqual([]);
    expect(buildReferences(invalidInput<readonly unknown[]>(null))).toEqual([]);
    expect(
      buildReferences(invalidInput<readonly unknown[]>(undefined))
    ).toEqual([]);
  });

  it("escapes a raw tag in the title-only branch", () => {
    const [ref] = buildReferences([{ title: "<img onerror=x>foo" }]);
    expect(ref.id).toBe("test-ref-1");
    // tag is inert text, not a live element
    expect(ref.html).toContain("&lt;img onerror=x&gt;foo");
    expect(ref.html).not.toContain("<img");
  });

  it("escapes a raw tag smuggled through the citation author field", () => {
    const [ref] = buildReferences([
      {
        au: "<img src=x onerror=alert(1)>",
        ti: "Title",
        so: "Nature",
        py: 2020,
      },
    ]);
    expect(ref.id).toBe("test-ref-1");
    // the citation branch wraps in .doc-citation; the raw tag must be escaped
    expect(ref.html).toContain('<div class="doc-citation">');
    expect(ref.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(ref.html).not.toContain("<img");
  });

  it("renders a real scheme-checked DOI anchor for a benign citation", () => {
    const [ref] = buildReferences([
      {
        au: "Smith J",
        ti: "Gene study",
        so: "Nature",
        py: 2020,
        dl: "https://doi.org/10.1/x",
      },
    ]);
    expect(ref.html).toContain(
      '<a href="https://doi.org/10.1/x" target="_blank" class="doi-link">https://doi.org/10.1/x</a>'
    );
  });

  it("neutralizes a malicious DOI href (javascript:) while escaping its text", () => {
    const [ref] = buildReferences([
      {
        au: "Smith J",
        ti: "T",
        so: "S",
        dl: 'javascript:alert(1)"onmouseover="x',
      },
    ]);
    // scheme-rejected href collapses to "#"
    expect(ref.html).toContain('<a href="#" target="_blank" class="doi-link">');
    // no live javascript: scheme survives in an href, and the breakout quote
    // in the displayed text is entity-escaped
    expect(ref.html).not.toContain('href="javascript:');
    expect(ref.html).not.toContain('onmouseover="x"');
    expect(ref.html).toContain("javascript:alert(1)&quot;onmouseover=&quot;x");
  });

  it("renders a real PubMed anchor for a benign pm id", () => {
    const [ref] = buildReferences([
      { au: "Smith J", ti: "T", so: "S", pm: "12345" },
    ]);
    expect(ref.html).toContain(
      '<a href="https://pubmed.ncbi.nlm.nih.gov/12345" target="_blank" class="pmid-link">12345</a>'
    );
  });

  it("escapes a malicious pm value in both href and text", () => {
    const [ref] = buildReferences([
      { au: "Smith J", ti: "T", so: "S", pm: '"><img onerror=x>' },
    ]);
    // the pm is concatenated onto the pubmed base, which keeps the http(s)
    // scheme, but quotes / tag chars must be entity-escaped so no breakout
    expect(ref.html).not.toContain('"><img');
    expect(ref.html).toContain("&quot;&gt;&lt;img onerror=x&gt;");
  });

  it("renders both DOI and PubMed with a separator", () => {
    const [ref] = buildReferences([
      {
        au: "Smith J",
        ti: "T",
        so: "S",
        dl: "https://doi.org/10.1/x",
        pm: "999",
      },
    ]);
    expect(ref.html).toContain("doi-link");
    expect(ref.html).toContain("pmid-link");
    expect(ref.html).toContain("<span>; </span>");
  });

  it("escapes a plain-string reference", () => {
    const [ref] = buildReferences(["<svg onload=alert(3)>"]);
    expect(ref.id).toBe("test-ref-1");
    expect(ref.html).toContain("&lt;svg onload=alert(3)&gt;");
    expect(ref.html).not.toContain("<svg");
  });

  it("escapes the JSON fallback for an object with no recognized fields", () => {
    const [ref] = buildReferences([{ foo: "<b>x</b>" }]);
    expect(ref.id).toBe("test-ref-1");
    // serialized then escaped — no live tag
    expect(ref.html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(ref.html).not.toContain("<b>");
  });

  it("indexes entries 1-based and preserves shape across a mixed list", () => {
    const out = buildReferences([
      { title: "A" },
      "plain",
      { au: "X", ti: "Y", so: "Z" },
    ]);
    expect(out).toHaveLength(3);
    expect(out.map((r) => r.id)).toEqual([
      "test-ref-1",
      "test-ref-2",
      "test-ref-3",
    ]);
    out.forEach((r) => {
      expect(typeof r.html).toBe("string");
      expect(typeof r.id).toBe("string");
    });
    expect(out[0].html).toContain("1. A");
    expect(out[1].html).toContain("2. plain");
    expect(out[2].html).toContain("3. ");
  });

  it("prefers Bot formatted_citation over reconstructed au/ti or title", () => {
    const [ref] = buildReferences([
      {
        title: "file.pdf",
        au: "Smith J",
        ti: "Gene study",
        so: "Nature",
        formatted_citation:
          "Smith J. Gene study. *Nature* **1**, (2020). [https://doi.org/10.1/x](https://doi.org/10.1/x)",
      },
    ]);
    expect(ref.html).toContain('<div class="doc-citation">');
    expect(ref.html).toContain("<em>Nature</em>");
    expect(ref.html).toContain("<strong>1</strong>");
    expect(ref.html).toContain(
      '<a href="https://doi.org/10.1/x" target="_blank" class="doi-link">https://doi.org/10.1/x</a>'
    );
    expect(ref.html).not.toContain("file.pdf");
  });

  it("escapes a raw tag in formatted_citation", () => {
    const [ref] = buildReferences([
      { title: "T", formatted_citation: "<img onerror=x>foo" },
    ]);
    expect(ref.html).toContain("&lt;img onerror=x&gt;foo");
    expect(ref.html).not.toContain("<img");
  });

  it("does not double-escape Bot entity-escaped italics in formatted_citation", () => {
    const [ref] = buildReferences([
      {
        formatted_citation:
          "Liu, Q. et al. Manipulating &lt;i&gt;osa-MIR156f&lt;/i&gt;.",
      },
    ]);
    expect(ref.html).toContain("&lt;i&gt;osa-MIR156f&lt;/i&gt;");
    expect(ref.html).not.toContain("&amp;lt;i&amp;gt;");
  });

  it("neutralizes a javascript: markdown DOI in formatted_citation", () => {
    const [ref] = buildReferences([
      {
        formatted_citation: "Paper. [x](javascript:alert(1))",
      },
    ]);
    expect(ref.html).toContain('<a href="#" target="_blank" class="doi-link">');
    expect(ref.html).not.toContain('href="javascript:');
  });

  it("renders the rich branch when a doc carries BOTH title and au/ti (flip)", () => {
    const [ref] = buildReferences([
      {
        title: "file.pdf",
        au: "Smith J",
        ti: "Gene study",
        so: "Nature",
        py: 2020,
      },
    ]);
    // rich branch fired (doc-citation wrapper), title-only branch did NOT
    expect(ref.html).toContain('<div class="doc-citation">');
    expect(ref.html).toContain("Smith J");
    expect(ref.html).not.toContain("file.pdf");
    expect(ref.id).toBe("test-ref-1");
  });

  it("neutralizes a javascript: DOI even when the enriched doc also has a title", () => {
    const [ref] = buildReferences([
      {
        title: "file.pdf",
        au: "A",
        ti: "T",
        so: "S",
        dl: "javascript:alert(1)",
      },
    ]);
    expect(ref.html).toContain('<a href="#" target="_blank" class="doi-link">');
    expect(ref.html).not.toContain('href="javascript:');
  });

  it("namespaces ids with ns when provided", () => {
    const out = buildDisplayReferences(
      [{ title: "A" }, { au: "X", ti: "Y", so: "Z" }],
      "m3"
    );
    expect(out.map((r) => r.id)).toEqual(["m3-ref-1", "m3-ref-2"]);
  });

  it("rejects a missing namespace when reference rows exist", () => {
    expect(() => buildDisplayReferences([{ title: "A" }], "")).toThrowError(
      "citation namespace is invalid"
    );
  });

  it("preserves valid namespace characters without rewriting", () => {
    const [ref] = buildDisplayReferences([{ title: "A" }], "artifact_under");
    expect(ref.id).toBe("artifact_under-ref-1");
  });

  it("rejects namespaces that would require lossy rewriting", () => {
    expect(() =>
      buildDisplayReferences([{ title: "A" }], 'a b"<x')
    ).toThrowError("citation namespace is invalid");
  });
});
