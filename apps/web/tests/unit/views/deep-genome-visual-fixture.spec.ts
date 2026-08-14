import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONTRACT_DEEP_GENOME_MARKDOWN,
  CONTRACT_DEEP_GENOME_RESOURCES,
  REAL_DEEP_GENOME_MARKDOWN,
  REAL_DEEP_GENOME_REFERENCES,
} from "../../visual/research/fixture-data";

const WEB_ROOT = resolve(__dirname, "../../..");
const VIEW_SOURCE = readFileSync(
  resolve(WEB_ROOT, "src/views/deep-genome-agent/DeepGenomeAgentView.vue"),
  "utf8"
);
const VISUAL_FIXTURE_SOURCE = readFileSync(
  resolve(
    WEB_ROOT,
    "tests/visual/research/DeepGenomeArtifactVisualFixtureApp.vue"
  ),
  "utf8"
);
const FIXTURE_DATA_SOURCE = readFileSync(
  resolve(WEB_ROOT, "tests/visual/research/fixture-data.ts"),
  "utf8"
);

const EXPECTED_MEDIA = [
  "Os01g0177400_tree.png",
  "LOC_Os01g08220_tissues.png",
  "LOC_Os01g08220_cultivars.png",
  "LOC_Os01g08220_treatments.png",
  "LOC_Os01g08220_genotypes.png",
  "Os01g0177400_umap.png",
  "Os01g0177400_violin_plot.png",
  "Os01g0177400_promoter_hap.png",
  "motif_all_logo.png",
  "Os01g0177400_6mA_smep.png",
  "Os01g0177400_smoc.png",
  "Os01t0177400-01_seed_101_sample_0.cif",
  "promoter_design.png",
  "psap_scores.png",
].sort();

const caseMediaPaths = Array.from(
  REAL_DEEP_GENOME_MARKDOWN.matchAll(
    /!\[[^\]]*\]\((\.\/\.out\/[^)]+\.(?:png|cif))\)/g
  ),
  (match) => match[1]
);

describe("Deep Genome real-content visual fixture", () => {
  it("uses the complete untrimmed Os01g0177400 report", () => {
    expect(REAL_DEEP_GENOME_MARKDOWN.split("\n")).toHaveLength(770);
    expect(REAL_DEEP_GENOME_MARKDOWN).toContain(
      "# Deep Genome Analysis of Os01g0177400"
    );
    expect(REAL_DEEP_GENOME_MARKDOWN).toContain("[document:5]");
    expect(REAL_DEEP_GENOME_MARKDOWN).toContain("## Reference:");
    expect(REAL_DEEP_GENOME_MARKDOWN).toContain(
      "[256] Physiological and Transcriptome Analyses"
    );
    expect(REAL_DEEP_GENOME_MARKDOWN).not.toContain("{{Promoter_");
    expect(REAL_DEEP_GENOME_MARKDOWN).not.toContain("/logo.png");
  });

  it("retains every original image and CIF marker", () => {
    expect(caseMediaPaths.map((path) => basename(path)).sort()).toEqual(
      EXPECTED_MEDIA
    );
    expect(caseMediaPaths.filter((path) => path.endsWith(".png"))).toHaveLength(
      13
    );
    expect(caseMediaPaths.filter((path) => path.endsWith(".cif"))).toHaveLength(
      1
    );
  });

  it("ships every referenced case asset as a non-empty public attachment", () => {
    for (const mediaPath of caseMediaPaths) {
      const publicPath = resolve(
        WEB_ROOT,
        "public/attachments",
        mediaPath.replace(/^\.\/\.out\//, "")
      );
      expect(existsSync(publicPath), publicPath).toBe(true);
      expect(statSync(publicPath).size, publicPath).toBeGreaterThan(10_000);
    }
  });

  it("derives all 256 evidence entries from the complete report", () => {
    expect(REAL_DEEP_GENOME_REFERENCES).toHaveLength(256);
    expect(
      new Set(REAL_DEEP_GENOME_REFERENCES.map(({ file_id }) => file_id)).size
    ).toBe(256);
    expect(REAL_DEEP_GENOME_REFERENCES.at(-1)?.title).toContain(
      "Physiological and Transcriptome Analyses"
    );
  });

  it("shares one production case source with the route and visual fixture", () => {
    expect(VIEW_SOURCE).toContain('from "./deep-genome-case"');
    expect(VIEW_SOURCE).not.toContain("const deepGenomeAgentResponse = `");
    expect(VISUAL_FIXTURE_SOURCE).toContain(
      'from "@/views/deep-genome-agent/deep-genome-case"'
    );
    expect(FIXTURE_DATA_SOURCE).toContain(
      'from "@/views/deep-genome-agent/deep-genome-case"'
    );
  });

  it("provides the deterministic shared-renderer contract fixture", () => {
    expect(CONTRACT_DEEP_GENOME_MARKDOWN).toContain("| Escaped pipe |");
    expect(CONTRACT_DEEP_GENOME_MARKDOWN).toContain("$$E = mc^2$$");
    expect(CONTRACT_DEEP_GENOME_MARKDOWN).toContain("<sup>[1-2]</sup>");
    expect(CONTRACT_DEEP_GENOME_MARKDOWN).toContain(
      "![Missing result](.out/missing-result.png)"
    );
    expect(CONTRACT_DEEP_GENOME_RESOURCES).toHaveLength(2);
    expect(VISUAL_FIXTURE_SOURCE).toContain('get("case") === "contract"');
    expect(VISUAL_FIXTURE_SOURCE).toContain(':resources="resources"');
  });
});
