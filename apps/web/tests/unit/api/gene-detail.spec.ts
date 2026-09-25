import { describe, expect, it } from "vitest";
import { decodeGeneDetailResponse } from "@/api/types";

const citation = {
  runs: [
    { text: "Gene paper", italic: true },
    { text: " 12", bold: true },
  ],
  links: [{ label: "Article", href: "https://doi.org/10.1000/example" }],
};
const resource = {
  id: "gene-figure-1",
  name: "Figure 1",
  kind: "image",
  markdownHref: "./figure.png",
  displayUrl: "/api/v1/gene-images/Os01/Os01_figure.png",
};
const report = () => ({
  id: 0,
  species_code: "rice",
  gene_id: "Os01",
  file_name: "Os01_result.md",
  content: "# Report\r\n\r\nEvidence [document:1]",
  references: [{ title: "Gene paper", citation }],
  resources: [resource],
  reference_materials: [
    { referenceIndex: 1, excerpt: "Source [2]", resourceIds: [] },
  ],
  report_revision: "a".repeat(64),
});

describe("canonical gene detail response", () => {
  it.each([
    { kind: "cif-text", read: "fake" },
    { kind: "cif-text", read: () => "private" },
  ])("rejects runtime-only render sources from the wire", (renderSource) => {
    expect(() =>
      decodeGeneDetailResponse({
        ...report(),
        resources: [{ ...resource, renderSource }],
      })
    ).toThrow("Invalid gene detail response");
  });
  it("preserves body bytes, canonical styles/links, resource and source associations", () => {
    expect(decodeGeneDetailResponse(report())).toEqual(report());
  });

  it("retains malformed reference slots without creating bibliography or file URLs", () => {
    const decoded = decodeGeneDetailResponse({
      ...report(),
      references: [
        null,
        { title: "Paper", citation, sourcePath: "/internal/paper.pdf" },
        "bad",
      ],
      resources: [],
      reference_materials: [],
      sourcePath: "/internal/secret.md",
    });
    expect(decoded.references).toEqual([
      { citation: null },
      { title: "Paper", citation },
      { citation: null },
    ]);
    expect(JSON.stringify(decoded)).not.toContain("/internal/");
  });

  it.each([
    "references",
    "resources",
    "reference_materials",
    "report_revision",
    "content",
  ])("rejects the obsolete or incomplete DTO missing %s", (field) => {
    const input: Record<string, unknown> = report();
    delete input[field];
    expect(() => decodeGeneDetailResponse(input)).toThrow(
      "Invalid gene detail response"
    );
  });

  it.each([
    { resources: [{ ...resource, displayUrl: "javascript:alert(1)" }] },
    {
      resources: [{ ...resource, displayUrl: "blob:https://example.test/id" }],
    },
    { resources: [resource, resource] },
    { resources: [{ ...resource, kind: "script" }] },
    { resources: [{ ...resource, kind: ["image"] }] },
    {
      reference_materials: [
        { referenceIndex: 0, excerpt: "text", resourceIds: [] },
      ],
    },
    {
      reference_materials: [
        { referenceIndex: 2, excerpt: "text", resourceIds: [] },
      ],
    },
    {
      reference_materials: [
        { referenceIndex: 1, excerpt: "text", resourceIds: ["missing"] },
      ],
    },
    {
      reference_materials: [
        { referenceIndex: 1, excerpt: "x".repeat(65537), resourceIds: [] },
      ],
    },
    { report_revision: "not-a-digest" },
  ])(
    "rejects malformed bounded resource or material metadata: %j",
    (overrides) => {
      expect(() =>
        decodeGeneDetailResponse({ ...report(), ...overrides })
      ).toThrow("Invalid gene detail response");
    }
  );
});
