export {
  DEEP_GENOME_CASE_MARKDOWN as REAL_DEEP_GENOME_MARKDOWN,
  DEEP_GENOME_CASE_REFERENCES as REAL_DEEP_GENOME_REFERENCES,
} from "@/views/deep-genome-agent/deep-genome-case";

import authorizedFigureUrl from "./fixtures/authorized-figure.svg?url&no-inline";
import authorizedStructureUrl from "./fixtures/authorized-structure.cif?url";
import type { AuthorizedScientificResource } from "@/utils/scientific-markdown/types";

export const CONTRACT_DEEP_GENOME_MARKDOWN = [
  "# Scientific rendering contract",
  "",
  "## Evidence table",
  "",
  "| Feature | Value |",
  "| --- | ---: |",
  String.raw`| Escaped pipe | alpha \| beta |`,
  "| Math | $x^2$ |",
  "",
  "$$E = mc^2$$",
  "",
  "Citation [1-2].",
  "",
  "<sup>1</sup> <sup>[1-2]</sup>",
  "",
  '<img src="/private/report.png" onerror="alert(1)">',
  "",
  "![Authorized figure](figures/authorized-figure.svg)",
  "",
  "![Authorized structure](structures/authorized-structure.cif)",
  "",
  "![Missing result](.out/missing-result.png)",
].join("\n");

export const CONTRACT_DEEP_GENOME_RESOURCES: readonly AuthorizedScientificResource[] =
  [
    {
      id: "contract-figure",
      name: "Authorized figure",
      kind: "image",
      markdownHref: "figures/authorized-figure.svg",
      displayUrl: authorizedFigureUrl,
    },
    {
      id: "contract-structure",
      name: "Authorized structure",
      kind: "cif",
      markdownHref: "structures/authorized-structure.cif",
      displayUrl: authorizedStructureUrl,
    },
  ];
