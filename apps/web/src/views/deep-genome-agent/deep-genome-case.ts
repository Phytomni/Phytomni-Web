import rawDeepGenomeCase from "@/assets/agentOut/round1-phytomni_output-Os01g0177400_result.md?raw";

export interface DeepGenomeCaseReference {
  file_id: string;
  title: string;
  [key: string]: unknown;
}

export const DEEP_GENOME_CASE_QUESTION =
  "Please give me a scientifically rigorous and integrated account of the rice (Oryza sativa) gene Os01g0177400.";

// Preserve the complete checked-in report and its Bot-authored citation tokens.
export const DEEP_GENOME_CASE_MARKDOWN = rawDeepGenomeCase.trimEnd();

const referenceSection = DEEP_GENOME_CASE_MARKDOWN.slice(
  DEEP_GENOME_CASE_MARKDOWN.indexOf("\n## Reference:\n")
);

export const DEEP_GENOME_CASE_REFERENCES: readonly DeepGenomeCaseReference[] =
  Array.from(
    referenceSection.matchAll(/^\[(\d{1,3})\]\s+(.+)$/gm),
    ([, number, title]) => ({
      file_id: `deep-genome-case-reference-${number.padStart(3, "0")}`,
      title,
    })
  );
