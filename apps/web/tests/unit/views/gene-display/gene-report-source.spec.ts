import { describe, it, expect } from "vitest";
import { decodeGeneDetailResponse } from "@/api/types";

function decodeBody(content: string): string {
  return decodeGeneDetailResponse({
    id: 0,
    species_code: "rice",
    gene_id: "Os01",
    file_name: "Os01_result.md",
    content,
    references: [],
    resources: [],
    reference_materials: [],
    report_revision: "a".repeat(64),
  }).content;
}

describe("canonical gene report source preservation", () => {
  it("preserves a DOC TITLES literal owned by a code block", () => {
    const body =
      "# Gene\n\n```text\n--- DOC TITLES ---\n1. Example\n```\n\nBody after code";
    expect(decodeBody(body)).toBe(body);
  });
  it("preserves source CRLF and LF instead of a second client normalization", () => {
    const body = "line1\r\nline2\nline3";
    expect(decodeBody(body)).toBe(body);
  });
  it("preserves literal backslash-n text", () => {
    const body = String.raw`line1\nline2`;
    expect(decodeBody(body)).toBe(body);
  });
  it("does not rewrite registered backend image URLs", () => {
    const body =
      "![tree](/api/v1/gene-images/Os01g0107900/Os01g0107900_tree.png)";
    expect(decodeBody(body)).toBe(body);
  });
  it("preserves an empty report body", () => {
    expect(decodeBody("")).toBe("");
  });
});
