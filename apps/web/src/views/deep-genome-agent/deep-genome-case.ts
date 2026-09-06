import type { AuthorizedScientificResource } from "@/utils/scientific-markdown/types";
import generated from "@/views/agent-cases/citations/generated.json";

export const DEEP_GENOME_CASE_QUESTION =
  "Please give me a scientifically rigorous and integrated account of the rice (Oryza sativa) gene Os01g0177400.";

const bodyMarkdown = generated.deep_genome.body;

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

export const DEEP_GENOME_CASE_REFERENCES = generated.deep_genome.references;

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
