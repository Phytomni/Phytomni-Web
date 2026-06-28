import { describe, it, expect } from "vitest";
import { formatDetailedCitation } from "@/utils/citation";

describe("formatDetailedCitation", () => {
  it("full doc: au + ti with embedded HTML tag + so + vl + bp + ep + py", () => {
    const doc = {
      au: "Smith J, Doe A",
      ti: "Plant <b>Genomics</b> Review",
      so: "Nature Plants",
      vl: "12",
      bp: "100",
      ep: "110",
      py: "2023",
    };
    // Expected: au. "cleanTitle". so. vl, bp-ep, (py)
    expect(formatDetailedCitation(doc)).toBe(
      'Smith J, Doe A. "Plant Genomics Review". Nature Plants. 12, 100-110, (2023)'
    );
  });

  it("only au", () => {
    expect(formatDetailedCitation({ au: "Zhang L" })).toBe("Zhang L");
  });

  it("only ti (with HTML tag stripped)", () => {
    expect(formatDetailedCitation({ ti: "<i>Rice</i> Proteomics" })).toBe(
      '"Rice Proteomics"'
    );
  });

  it("bp + ep without vl", () => {
    const doc = { bp: "45", ep: "60" };
    expect(formatDetailedCitation(doc)).toBe("45-60");
  });

  it("vl + bp without ep", () => {
    const doc = { vl: "5", bp: "200" };
    expect(formatDetailedCitation(doc)).toBe("5, 200");
  });

  it("vl without bp or ep", () => {
    const doc = { vl: "7" };
    expect(formatDetailedCitation(doc)).toBe("7");
  });

  it("py only (no vl/bp/ep)", () => {
    const doc = { py: "2021" };
    expect(formatDetailedCitation(doc)).toBe("(2021)");
  });

  it("py combined with vl + bp + ep", () => {
    const doc = { vl: "3", bp: "10", ep: "20", py: "2020" };
    expect(formatDetailedCitation(doc)).toBe("3, 10-20, (2020)");
  });

  it("py combined with bp + ep (no vl)", () => {
    const doc = { bp: "10", ep: "20", py: "2020" };
    expect(formatDetailedCitation(doc)).toBe("10-20, (2020)");
  });

  it("empty doc returns empty string", () => {
    expect(formatDetailedCitation({})).toBe("");
  });

  it("au + ti only, joins with period-space", () => {
    const doc = { au: "Wang Y", ti: "Gene Expression" };
    expect(formatDetailedCitation(doc)).toBe('Wang Y. "Gene Expression"');
  });
});
