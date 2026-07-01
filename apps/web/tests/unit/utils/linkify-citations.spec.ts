import { describe, it, expect } from "vitest";
import { linkifyCitations } from "@/utils/linkify-citations";

describe("linkifyCitations", () => {
  it("linkifies a single [N] marker to a #ns-ref-N anchor when ns is set", () => {
    const out = linkifyCitations("see [1] here", "m3");
    expect(out).toContain('<a href="#m3-ref-1" class="citation-ref">1</a>');
  });

  it("linkifies a compound [N,M] marker to one namespaced anchor per number", () => {
    const out = linkifyCitations("refs [1,2]", "m3");
    expect(out).toContain('<a href="#m3-ref-1" class="citation-ref">1</a>');
    expect(out).toContain('<a href="#m3-ref-2" class="citation-ref">2</a>');
  });

  it("tolerates whitespace in compound markers [1, 2, 3]", () => {
    const out = linkifyCitations("[1, 2, 3]", "m3");
    expect(out).toContain("#m3-ref-3");
  });

  it("does not linkify a 4+ digit token like a year [2024]", () => {
    expect(linkifyCitations("year [2024]", "m3")).toBe("year [2024]");
  });

  it("leaves an already-escaped tag inside brackets inert (no digit match)", () => {
    const escaped = "[&lt;img onerror=x&gt;]";
    expect(linkifyCitations(escaped, "m3")).toBe(escaped);
  });

  it("returns empty / falsy input unchanged", () => {
    expect(linkifyCitations("", "m3")).toBe("");
  });

  it("SCOPE GATE: returns input unchanged when ns is empty or absent (no dead #ref-N links)", () => {
    expect(linkifyCitations("see [1] here")).toBe("see [1] here");
    expect(linkifyCitations("see [1] here", "")).toBe("see [1] here");
  });

  it("sanitizes illegal characters out of ns before building the href", () => {
    const out = linkifyCitations("see [1]", 'a b"<x');
    expect(out).toContain('<a href="#abx-ref-1" class="citation-ref">1</a>');
  });
});
