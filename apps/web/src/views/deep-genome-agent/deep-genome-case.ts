import rawDeepGenomeCase from "@/assets/agentOut/round1-phytomni_output-Os01g0177400_result.md?raw";

export interface DeepGenomeCaseReference {
  file_id: string;
  title: string;
  [key: string]: unknown;
}

export const DEEP_GENOME_CASE_QUESTION =
  "[Species Name: rice (Oryza sativa) Gene Names: d18h|GA3ox1|OsGA3OX2|OsGA3ox-2|d18-h|GA3OX2|d18-I|d25|dwf15|ga3ox2|d18-dy|OsGA3ox2|d18|d18-k|d18-AD|D18|GA3ox-2] Provide a scientifically rigorous and integrated account of the rice (Oryza sativa) d18h|GA3ox1|OsGA3OX2|OsGA3ox-2|d18-h|GA3OX2|d18-I|d25|dwf15|ga3ox2|d18-dy|OsGA3ox2|d18|d18-k|d18-AD|D18|GA3ox-2 gene. Consolidate data for all gene aliases (separated by '|') as representing identical genetic entities. Maintain strict adherence to evidence-based reporting, excluding unsupported assertions. Prioritize conciseness while preserving informational density comparable to source materials.";

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
