import { describe, expect, it } from "vitest";
import generated from "@/views/agent-cases/citations/generated.json";
import {
  DEEP_GENOME_CASE_MARKDOWN,
  DEEP_GENOME_CASE_QUESTION,
  DEEP_GENOME_CASE_REFERENCES,
  DEEP_GENOME_CASE_RESOURCES,
  readDeepGenomeCaseResource,
} from "@/views/deep-genome-agent/deep-genome-case";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Deep Genome case tape", () => {
  it("keeps the rice gene question and report body", () => {
    expect(DEEP_GENOME_CASE_QUESTION).toBe(
      "Please give me a scientifically rigorous and integrated account of the rice (Oryza sativa) gene Os01g0177400."
    );
    expect(DEEP_GENOME_CASE_MARKDOWN).toContain(
      "# Deep Genome Analysis of Os01g0177400"
    );
    expect(DEEP_GENOME_CASE_MARKDOWN).toContain(
      "GA3ox-2, D18, GA3OX2, dwf15, OsGA3ox-2"
    );
    expect(DEEP_GENOME_CASE_MARKDOWN).not.toContain("GA3ox-2|D18|");
    expect(DEEP_GENOME_CASE_MARKDOWN).toContain("## Discussion");
    expect(DEEP_GENOME_CASE_MARKDOWN).not.toContain("## Disscussion");
    expect(DEEP_GENOME_CASE_MARKDOWN).toContain("![Structure Image]");
    expect(DEEP_GENOME_CASE_MARKDOWN).not.toContain("![Sturcture Image]");
    expect(DEEP_GENOME_CASE_MARKDOWN).toContain("![Single-cell Umap Image]");
  });

  it("preserves all explicit citation tokens for the shared renderer", () => {
    const originalTokens =
      generated.deep_genome.body.match(/\[document:[^\]]+\]/g);
    expect(originalTokens).toHaveLength(94);
    expect(DEEP_GENOME_CASE_MARKDOWN.match(/\[document:[^\]]+\]/g)).toEqual(
      originalTokens
    );
    expect(DEEP_GENOME_CASE_MARKDOWN).not.toMatch(/<sup>\d+<\/sup>/);
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
    expect(DEEP_GENOME_CASE_RESOURCES).toHaveLength(15);
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
    expect(new Set(ids).size).toBe(15);
    expect(new Set(hrefs).size).toBe(15);
  });

  it("opens the registered protocol with the exact existing source bytes", async () => {
    const resource = DEEP_GENOME_CASE_RESOURCES.find(
      ({ kind }) => kind === "markdown"
    );
    expect(resource?.markdownHref).toBe("./Os01g0177400_result-experiments.md");
    if (!resource) throw new Error("Case protocol resource is missing");
    const result = await readDeepGenomeCaseResource(
      resource.id,
      new AbortController().signal
    );
    const source = readFileSync(
      resolve(
        __dirname,
        "../../../src/assets/agentOut/Os01g0177400_result-experiments.md"
      )
    );
    expect(result.bytes).toEqual(new Uint8Array(source));
    expect(result.text).toBe(source.toString("utf8"));
    await expect(
      readDeepGenomeCaseResource("arbitrary.md", new AbortController().signal)
    ).rejects.toThrow();
    const controller = new AbortController();
    controller.abort();
    await expect(
      readDeepGenomeCaseResource(resource.id, controller.signal)
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
