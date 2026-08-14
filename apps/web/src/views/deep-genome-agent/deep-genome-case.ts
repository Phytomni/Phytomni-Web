import rawDeepGenomeCase from "@/assets/agentOut/round1-phytomni_output-Os01g0177400_result.md?raw";

export interface DeepGenomeCaseReference {
  file_id: string;
  title: string;
}

// Preserve the complete checked-in report while translating the agent's
// document citation tokens into the viewer's native [N] anchor syntax.
export const DEEP_GENOME_CASE_MARKDOWN = rawDeepGenomeCase
  .trimEnd()
  .replace(/\[document:(\d{1,3})\]/g, "[$1]");

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
