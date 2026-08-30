import { describe, expect, it } from "vitest";
import {
  DEEP_GENOME_CASE_MARKDOWN,
  DEEP_GENOME_CASE_QUESTION,
  DEEP_GENOME_CASE_REFERENCES,
  DEEP_GENOME_CASE_RESOURCES,
} from "@/views/deep-genome-agent/deep-genome-case";

describe("Deep Genome case tape", () => {
  it("keeps the rice gene question and report body", () => {
    expect(DEEP_GENOME_CASE_QUESTION).toBe(
      "Please give me a scientifically rigorous and integrated account of the rice (Oryza sativa) gene Os01g0177400."
    );
    expect(DEEP_GENOME_CASE_MARKDOWN).toContain(
      "# Deep Genome Analysis of Os01g0177400"
    );
    expect(DEEP_GENOME_CASE_MARKDOWN).toContain(
      "GA3ox-2|D18|GA3OX2|dwf15|OsGA3ox-2"
    );
  });

  it("uses superscript citation numbers instead of [document:N] tokens", () => {
    expect(DEEP_GENOME_CASE_MARKDOWN).toContain("<sup>5</sup>");
    expect(DEEP_GENOME_CASE_MARKDOWN).toContain("<sup>14</sup>");
    expect(DEEP_GENOME_CASE_MARKDOWN).toContain("<sup>18</sup>");
    expect(DEEP_GENOME_CASE_MARKDOWN).not.toMatch(/\[document\s*:/i);
  });

  it("does not repeat the Reference list in the report body", () => {
    expect(DEEP_GENOME_CASE_MARKDOWN).not.toContain("## Reference:");
    expect(DEEP_GENOME_CASE_MARKDOWN).not.toContain(
      "[256] Physiological and Transcriptome Analyses"
    );
    expect(DEEP_GENOME_CASE_REFERENCES).toHaveLength(256);
    expect(DEEP_GENOME_CASE_REFERENCES.at(-1)?.title).toContain(
      "Physiological and Transcriptome Analyses"
    );
  });

  it("authorizes every case figure against the public attachment files", () => {
    expect(DEEP_GENOME_CASE_RESOURCES).toHaveLength(14);
    expect(
      DEEP_GENOME_CASE_RESOURCES.filter(({ kind }) => kind === "image")
    ).toHaveLength(13);
    expect(
      DEEP_GENOME_CASE_RESOURCES.filter(({ kind }) => kind === "cif")
    ).toHaveLength(1);

    const tree = DEEP_GENOME_CASE_RESOURCES.find(
      ({ markdownHref }) =>
        markdownHref === "./.out/Os01g0177400/Os01g0177400_tree.png"
    );
    expect(tree).toMatchObject({
      kind: "image",
      displayUrl: "/attachments/Os01g0177400/Os01g0177400_tree.png",
    });

    const structure = DEEP_GENOME_CASE_RESOURCES.find(
      ({ kind }) => kind === "cif"
    );
    expect(structure).toMatchObject({
      markdownHref: "./.out/Os01g0177400/Os01t0177400-01_seed_101_sample_0.cif",
      displayUrl:
        "/attachments/Os01g0177400/Os01t0177400-01_seed_101_sample_0.cif",
    });

    const ids = DEEP_GENOME_CASE_RESOURCES.map(({ id }) => id);
    const hrefs = DEEP_GENOME_CASE_RESOURCES.map(
      ({ markdownHref }) => markdownHref
    );
    expect(new Set(ids).size).toBe(14);
    expect(new Set(hrefs).size).toBe(14);
  });
});
