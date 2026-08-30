import rawDeepGenomeCase from "@/assets/agentOut/round1-phytomni_output-Os01g0177400_result.md?raw";
import type { AuthorizedScientificResource } from "@/utils/scientific-markdown/types";

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

function polishDeepGenomeReport(markdown: string): string {
  return markdown
    .replace(/^## Disscussion$/m, "## Discussion")
    .replace(/!\[Sturcture Image\]/g, "![Structure Image]")
    .replace(/!\[Single_cell /g, "![Single-cell ")
    .replace(/^[^\n]*\|[^\n]*Os01g0177400 in rice/m, (line) => {
      const marker = " in rice";
      const splitAt = line.indexOf(marker);
      if (splitAt < 0) return line;
      return `${line.slice(0, splitAt).split("|").join(", ")}${line.slice(splitAt)}`;
    });
}

export const DEEP_GENOME_CASE_MARKDOWN = polishDeepGenomeReport(
  documentTokensToSuperscripts(bodyMarkdown)
);

export const DEEP_GENOME_CASE_REFERENCES: readonly DeepGenomeCaseReference[] =
  Array.from(
    referenceSection.matchAll(/^\[(\d{1,3})\]\s+(.+)$/gm),
    ([, number, title]) => ({
      file_id: `deep-genome-case-reference-${number.padStart(3, "0")}`,
      title,
    })
  );

const CASE_ATTACHMENT_ROOT = "/attachments";

export const DEEP_GENOME_CASE_RESOURCES: readonly AuthorizedScientificResource[] =
  Array.from(
    DEEP_GENOME_CASE_MARKDOWN.matchAll(
      /!\[([^\]]*)\]\((\.\/\.out\/([^)]+\.(png|cif)))\)/g
    ),
    ([, alt, href, relative, ext], index) => ({
      id: `deep-genome-case-resource-${String(index + 1).padStart(2, "0")}`,
      name: alt,
      kind: ext === "cif" ? ("cif" as const) : ("image" as const),
      markdownHref: href,
      displayUrl: `${CASE_ATTACHMENT_ROOT}/${relative}`,
    })
  );
