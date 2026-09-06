import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import rawDeepGenomeCase from "@/assets/agentOut/round1-phytomni_output-Os01g0177400_result.md?raw";
import generated from "@/views/agent-cases/citations/generated.json";
import sources from "@/views/agent-cases/citations/sources.json";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

describe("canonical offline Case citations", () => {
  it("keeps the extracted source corpus byte-for-byte and in source order", () => {
    expect(sha256(JSON.stringify(sources.knowledge.references))).toBe(
      "370de76fd1c9f10c008ac6dc832249c633069637c78a78e25ce998df30803209"
    );
    expect(sha256(JSON.stringify(sources.review.references))).toBe(
      "0bde76a1c61947283b0bcb2a971c046117e91fa08ba93e4b04148e9c3b33d28f"
    );
    expect(sha256(JSON.stringify(sources.brief_gene.references))).toBe(
      "188d78696b9d3d174ccfdf38a138b8d3f29027dc7a6d2aaebd4fa8958e4ff99e"
    );

    expect(sources.deep_genome.body).toBe(rawDeepGenomeCase);
    expect(sha256(rawDeepGenomeCase)).toBe(
      "8d7779e248d7c97c17dd5b34adbb43ca57a72a998cf334d848e1da5ff851287d"
    );
    expect(sha256(generated.deep_genome.body)).toBe(
      "ec1cacb9d051c6f5d99938b660c57f7bcca4cb2fb1114df3cba494d3e33338f5"
    );
    expect(sha256(JSON.stringify(sources.deep_genome.references))).toBe(
      "25580340178039ea6bb38a79ff6fc19d7adc4989d857d6d10cb1c2f80a807f9e"
    );
  });

  it("loads every Case offline with unchanged questions, bodies, and resources", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const xhrOpenSpy = vi.spyOn(XMLHttpRequest.prototype, "open");
    vi.resetModules();

    try {
      const [knowledge, review, briefGene, deepGenome] = await Promise.all([
        import("@/views/knowledge-agent/knowledge-case"),
        import("@/views/review-agent/review-case"),
        import("@/views/brief-gene-agent/brief-gene-case"),
        import("@/views/deep-genome-agent/deep-genome-case"),
      ]);

      expect(knowledge.KNOWLEDGE_CASE.question).toBe(
        "How do epigenetic modifications, such as DNA methylation and histone modifications, regulate adaptive responses to drought stress in crops?"
      );
      expect(review.REVIEW_CASE.question).toBe(
        "How does single-cell RNA sequencing (scRNA-seq) reveal the heterogeneous responses of different cell types within plant organs to biotic/abiotic stresses?"
      );
      expect(briefGene.BRIEF_GENE_CASE.question).toBe(
        "Please give me a brief gene analysis of the rice (Oryza sativa) gene Os01g0177400."
      );
      expect(deepGenome.DEEP_GENOME_CASE_QUESTION).toBe(
        "Please give me a scientifically rigorous and integrated account of the rice (Oryza sativa) gene Os01g0177400."
      );

      expect(sha256(knowledge.KNOWLEDGE_CASE.content)).toBe(
        "416cd9f6aab5e2d526b7ea76bd687354d0c386ac78ad631f7be83b900b0977ba"
      );
      expect(sha256(review.REVIEW_CASE.content)).toBe(
        "f46c9de2c14c31f97726087b1722571e51975db4b5be437d73affea37491d252"
      );
      expect(sha256(briefGene.BRIEF_GENE_CASE.content)).toBe(
        "bacfbb0a4f7eced5cec602ff2c9041dc8cf6084e26085428f152c4067fd1a14d"
      );
      expect(sha256(deepGenome.DEEP_GENOME_CASE_MARKDOWN)).toBe(
        "68f75dc6197c6de9b99eba22fcbaf67a4c68e18ac7395d01fdf8090d591e7901"
      );
      expect(
        sha256(JSON.stringify(deepGenome.DEEP_GENOME_CASE_RESOURCES))
      ).toBe(
        "87d6b97c7593e650377da481e145ed4e80d2ad20b3ab9e53dff26dec7a72f47e"
      );

      expect(knowledge.KNOWLEDGE_CASE.references).toEqual(
        generated.knowledge.references
      );
      expect(review.REVIEW_CASE.references).toEqual(
        generated.review.references
      );
      expect(briefGene.BRIEF_GENE_CASE.references).toEqual(
        generated.brief_gene.references
      );
      expect(deepGenome.DEEP_GENOME_CASE_REFERENCES).toEqual(
        generated.deep_genome.references
      );
      expect(
        knowledge.KNOWLEDGE_CASE.references.map(({ title }) => title)
      ).toEqual(sources.knowledge.references.map(({ title }) => title));
      expect(review.REVIEW_CASE.references.map(({ title }) => title)).toEqual(
        sources.review.references.map(({ title }) => title)
      );
      expect(
        briefGene.BRIEF_GENE_CASE.references.map(({ title }) => title)
      ).toEqual(sources.brief_gene.references.map(({ title }) => title));
      expect(
        deepGenome.DEEP_GENOME_CASE_REFERENCES.map(({ title }) => title)
      ).toEqual(sources.deep_genome.references.map(({ title }) => title));
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(xhrOpenSpy).not.toHaveBeenCalled();
    } finally {
      xhrOpenSpy.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("publishes canonical presentation without internal source identities", () => {
    for (const fixture of Object.values(generated)) {
      for (const reference of fixture.references) {
        expect(reference).not.toHaveProperty("file_id");
        expect(reference).not.toHaveProperty("doi_missing");
        expect(reference.citation.runs).toEqual(expect.any(Array));
        expect(reference.citation.links).toEqual(expect.any(Array));
      }
    }
  });
});
