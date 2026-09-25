import { describe, expect, it } from "vitest";

import {
  executionDetailRenderer,
  safeStructuredRows,
} from "@/views/chat/executionDetailRenderers";

describe("execution detail renderer registry", () => {
  it.each([
    ["text/markdown", "markdown"],
    ["text/plain", "log"],
    ["text/csv", "table"],
    ["application/json", "structured"],
    ["application/pdf", "pdf"],
    ["image/png", "image"],
    ["chemical/x-cif", "cif"],
    ["application/octet-stream", "metadata"],
  ] as const)("maps %s to the finite %s renderer", (mediaType, expected) => {
    expect(
      executionDetailRenderer({ kind: "artifact", id: "opaque" }, mediaType)
    ).toBe(expected);
  });

  it("never treats an upstream URL or HTML label as an executable renderer", () => {
    expect(
      executionDetailRenderer(
        { kind: "preview", id: "https://private.invalid/a" },
        "text/html"
      )
    ).toBe("metadata");
  });

  it.each([
    ["network.JSON", "structured"],
    ["genes.csv", "table"],
    ["genes.TSV", "table"],
    ["report.txt", "log"],
    ["model.pdb", "log"],
    ["sequences.fasta", "log"],
    ["figure.png", "image"],
    ["figure.JPG", "image"],
    ["figure.svg", "image"],
    ["report.PDF", "pdf"],
    ["results.zip", "metadata"],
  ] as const)(
    "falls back from generic binary media to the %s suffix renderer",
    (name, expected) => {
      expect(
        executionDetailRenderer(
          { kind: "artifact", id: "opaque" },
          "application/octet-stream",
          name
        )
      ).toBe(expected);
    }
  );

  it("prefers a specific safe media type and keeps executable suffixes inert", () => {
    expect(
      executionDetailRenderer(
        { kind: "artifact", id: "opaque" },
        "application/json",
        "misleading.png"
      )
    ).toBe("structured");
    expect(
      executionDetailRenderer(
        { kind: "artifact", id: "opaque" },
        "application/octet-stream",
        "unsafe.html"
      )
    ).toBe("metadata");
    expect(
      executionDetailRenderer(
        { kind: "artifact", id: "opaque" },
        "application/octet-stream",
        "unsafe.js"
      )
    ).toBe("metadata");
  });

  it.each([
    ["PNG", "network.png", "image"],
    ["CSV", "top20.csv", "table"],
    ["TSV", "network.txt", "log"],
  ] as const)(
    "falls back from malformed provider media type %s using %s",
    (mediaType, name, expected) => {
      expect(
        executionDetailRenderer(
          { kind: "artifact", id: "opaque" },
          mediaType,
          name
        )
      ).toBe(expected);
    }
  );

  it("accepts only bounded scalar table cells", () => {
    expect(
      safeStructuredRows({
        headers: ["gene", "score"],
        rows: [["AT1G01010", 2.5]],
      })
    ).toEqual({ headers: ["gene", "score"], rows: [["AT1G01010", "2.5"]] });
    expect(
      safeStructuredRows({ headers: ["x"], rows: [[{ html: "<b>x</b>" }]] })
    ).toBeNull();
  });
});
