import { describe, expect, it } from "vitest";
import { BRIEF_GENE_CASE } from "@/views/brief-gene-agent/brief-gene-case";

describe("BriefGene static case projection", () => {
  it("keeps the admitted Os01g0177400 report and required sections", () => {
    expect(BRIEF_GENE_CASE.question).toBe("Os01g0177400");
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

  it("projects only public reference fields with stable local IDs", () => {
    const allowedKeys = new Set([
      "file_id",
      "title",
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

    expect(BRIEF_GENE_CASE.references).toHaveLength(4);
    BRIEF_GENE_CASE.references.forEach((reference, index) => {
      expect(reference.file_id).toBe(`bg-case-${index + 1}`);
      expect(Object.keys(reference).every((key) => allowedKeys.has(key))).toBe(
        true
      );
      expect(reference.title).toEqual(expect.any(String));
    });
  });

  it("keeps log-based provenance explicit without internal run identifiers", () => {
    expect(BRIEF_GENE_CASE.provenance).toEqual({
      source: "user-supplied API log",
      sourceModel: "phyto-brief-gene",
      input: "Os01g0177400",
      locale: "en-US",
      sourceEntryPoint: "chat.completion response (as logged)",
    });
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
