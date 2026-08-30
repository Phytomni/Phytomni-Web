import rawDeepGenomeCase from "@/assets/agentOut/round1-phytomni_output-Os01g0177400_result.md?raw";

export interface DeepGenomeCaseReference {
  file_id: string;
  title: string;
  [key: string]: unknown;
}

export const DEEP_GENOME_CASE_QUESTION =
  "Please give me a scientifically rigorous and integrated account of the rice (Oryza sativa) gene Os01g0177400.";

const RAW_DEEP_GENOME_CASE = rawDeepGenomeCase.trimEnd();
const REFERENCE_HEADING = "\n## Reference:\n";
const referenceHeadingIndex = RAW_DEEP_GENOME_CASE.indexOf(REFERENCE_HEADING);
const referenceSection =
  referenceHeadingIndex >= 0
    ? RAW_DEEP_GENOME_CASE.slice(referenceHeadingIndex)
    : "";
const bodyMarkdown =
  referenceHeadingIndex >= 0
    ? RAW_DEEP_GENOME_CASE.slice(0, referenceHeadingIndex).trimEnd()
    : RAW_DEEP_GENOME_CASE;

function documentTokensToSuperscripts(markdown: string): string {
  return markdown.replace(
    /\[document\s*:\s*(\d{1,3}(?:\s*-\s*\d{1,3})?(?:\s*,\s*\d{1,3}(?:\s*-\s*\d{1,3})?)*)\]/gi,
    (_match, body: string) => `<sup>${body.replace(/\s+/g, "")}</sup>`
  );
}

export const DEEP_GENOME_CASE_MARKDOWN =
  documentTokensToSuperscripts(bodyMarkdown);

export const DEEP_GENOME_CASE_REFERENCES: readonly DeepGenomeCaseReference[] =
  Array.from(
    referenceSection.matchAll(/^\[(\d{1,3})\]\s+(.+)$/gm),
    ([, number, title]) => ({
      file_id: `deep-genome-case-reference-${number.padStart(3, "0")}`,
      title,
    })
  );
