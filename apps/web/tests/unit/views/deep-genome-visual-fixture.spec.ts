import { describe, expect, it } from "vitest";
import {
  REAL_DEEP_GENOME_MARKDOWN,
  REAL_DEEP_GENOME_REFERENCES,
} from "../../visual/research/fixture-data";

describe("Deep Genome real-content visual fixture", () => {
  it("retains the shipped Os01g0177400 report density", () => {
    expect(REAL_DEEP_GENOME_MARKDOWN).toContain(
      "# Deep Genome Analysis of Os01g0177400"
    );
    expect(REAL_DEEP_GENOME_MARKDOWN).toContain("| d18-k | Kotaketamanishiki");
    expect(REAL_DEEP_GENOME_MARKDOWN).toContain(
      "![Representative rice gene expression figure](/logo.png)"
    );
  });

  it("uses sanitized stable reference identifiers", () => {
    expect(REAL_DEEP_GENOME_REFERENCES).toHaveLength(8);
    expect(
      REAL_DEEP_GENOME_REFERENCES.every((reference) =>
        reference.file_id.startsWith("visual-real-reference-")
      )
    ).toBe(true);
  });
});
