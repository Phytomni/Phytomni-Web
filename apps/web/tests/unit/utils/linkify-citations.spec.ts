import { describe, it, expect } from "vitest";
import { linkifyCitations } from "@/utils/linkify-citations";

describe("linkifyCitations", () => {
  it("linkifies a single [N] marker to a #ref-N anchor", () => {
    const out = linkifyCitations("see [1] here");
    expect(out).toContain('<a href="#ref-1" class="citation-ref">1</a>');
  });

  it("linkifies a compound [N,M] marker to one anchor per number", () => {
    const out = linkifyCitations("refs [1,2]");
    expect(out).toContain('<a href="#ref-1" class="citation-ref">1</a>');
    expect(out).toContain('<a href="#ref-2" class="citation-ref">2</a>');
  });

  it("tolerates whitespace in compound markers [1, 2, 3]", () => {
    const out = linkifyCitations("[1, 2, 3]");
    expect(out).toContain("#ref-3");
  });

  it("does not linkify a 4+ digit token like a year [2024]", () => {
    expect(linkifyCitations("year [2024]")).toBe("year [2024]");
  });

  it("leaves an already-escaped tag inside brackets inert (no digit match)", () => {
    const escaped = "[&lt;img onerror=x&gt;]";
    expect(linkifyCitations(escaped)).toBe(escaped);
  });

  it("returns empty / falsy input unchanged", () => {
    expect(linkifyCitations("")).toBe("");
  });
});
