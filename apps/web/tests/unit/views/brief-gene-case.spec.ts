import { describe, expect, it } from "vitest";
import { BRIEF_GENE_CASE } from "@/views/brief-gene-agent/brief-gene-case";

describe("BriefGene static case projection", () => {
  it("keeps the admitted Os01g0177400 report and required sections", () => {
    expect(BRIEF_GENE_CASE.question).toBe(
      "Please give me a brief gene analysis of the rice (Oryza sativa) gene Os01g0177400."
    );
    expect(BRIEF_GENE_CASE.content).toContain(
      "# Brief Gene Analysis of Os01g0177400"
    );
    expect(BRIEF_GENE_CASE.content).toContain("## Gene Profiles");
    for (const section of [
      "### 1. Gene Discovery",
      "### 2. Gene Cloning",
      "### 3. Functional Analysis",
      "### 4. Application and Evolutionary",
    ]) {
      expect(BRIEF_GENE_CASE.content).toContain(section);
    }
  });

  it("projects Bot formatted.references rows onto demo doc_list", () => {
    const allowedKeys = new Set([
      "file_id",
      "title",
      "formatted_citation",
      "doi_missing",
      "ar",
      "au",
      "ti",
      "so",
      "vl",
      "bp",
      "ep",
      "py",
      "di",
      "dl",
      "pm",
    ]);

    expect(BRIEF_GENE_CASE.references.length).toBeGreaterThan(0);
    BRIEF_GENE_CASE.references.forEach((reference) => {
      expect(Object.keys(reference).every((key) => allowedKeys.has(key))).toBe(
        true
      );
      expect(reference.title).toEqual(expect.any(String));
      expect(reference.formatted_citation).toEqual(expect.any(String));
    });
  });

  it("binds provenance to the committed public BriefGene workflow", () => {
    expect(BRIEF_GENE_CASE.provenance).toMatchObject({
      botCommit: "1278384920e9a806d44b5a46ac62397531215bc6",
      input: "Os01g0177400",
      locale: "en-US",
      entryPoint: "POST /v1/chat/completions model=phyto-brief-gene",
    });
    expect(BRIEF_GENE_CASE.provenance.capturedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/
    );
    expect(Object.keys(BRIEF_GENE_CASE.provenance)).not.toEqual(
      expect.arrayContaining([
        "run_id",
        "task_id",
        "server_id",
        "obs",
        "bucket",
        "object_key",
        "local_path",
        "authorization",
        "bearer",
        "password",
        "secret",
      ])
    );
  });
});
