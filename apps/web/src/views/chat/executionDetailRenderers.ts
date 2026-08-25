import type { ExecutionTarget } from "./streaming/executionEvents";

export type ExecutionDetailRenderer =
  | "event"
  | "todo"
  | "report"
  | "markdown"
  | "log"
  | "table"
  | "structured"
  | "image"
  | "pdf"
  | "cif"
  | "metadata";

const MARKDOWN_TYPES = new Set(["text/markdown", "text/x-markdown"]);
const LOG_TYPES = new Set([
  "text/plain",
  "application/x-ndjson",
  "application/jsonlines",
]);
const TABLE_TYPES = new Set([
  "text/csv",
  "text/tab-separated-values",
  "application/vnd.ms-excel",
]);
const STRUCTURED_TYPES = new Set(["application/json", "application/ld+json"]);
const PDF_TYPES = new Set(["application/pdf"]);
const CIF_TYPES = new Set(["chemical/x-cif", "chemical/x-mmcif", "text/cif"]);
const GENERIC_TYPES = new Set(["", "application/octet-stream"]);

const SUFFIX_RENDERERS = new Map<string, ExecutionDetailRenderer>([
  [".md", "markdown"],
  [".markdown", "markdown"],
  [".txt", "log"],
  [".log", "log"],
  [".pdb", "log"],
  [".fa", "log"],
  [".fasta", "log"],
  [".fna", "log"],
  [".faa", "log"],
  [".fq", "log"],
  [".fastq", "log"],
  [".gff", "log"],
  [".gff3", "log"],
  [".gtf", "log"],
  [".bed", "log"],
  [".vcf", "log"],
  [".nwk", "log"],
  [".newick", "log"],
  [".jsonl", "log"],
  [".ndjson", "log"],
  [".csv", "table"],
  [".tsv", "table"],
  [".json", "structured"],
  [".jsonld", "structured"],
  [".pdf", "pdf"],
  [".png", "image"],
  [".jpg", "image"],
  [".jpeg", "image"],
  [".gif", "image"],
  [".webp", "image"],
  [".svg", "image"],
  [".cif", "cif"],
  [".mmcif", "cif"],
]);

function rendererFromSuffix(rawName?: string): ExecutionDetailRenderer {
  const name = (rawName ?? "").trim().toLowerCase();
  for (const [suffix, renderer] of SUFFIX_RENDERERS) {
    if (name.endsWith(suffix)) return renderer;
  }
  return "metadata";
}

export function executionDetailRenderer(
  target: ExecutionTarget,
  rawMediaType?: string,
  fileName?: string
): ExecutionDetailRenderer {
  if (target.kind === "event") return "event";
  if (target.kind === "todo") return "todo";
  if (target.kind === "report") return "report";
  const mediaType = (rawMediaType ?? "").split(";", 1)[0].trim().toLowerCase();
  if (MARKDOWN_TYPES.has(mediaType)) return "markdown";
  if (LOG_TYPES.has(mediaType)) return "log";
  if (TABLE_TYPES.has(mediaType)) return "table";
  if (STRUCTURED_TYPES.has(mediaType)) return "structured";
  if (PDF_TYPES.has(mediaType)) return "pdf";
  if (mediaType.startsWith("image/")) return "image";
  if (CIF_TYPES.has(mediaType)) return "cif";
  if (GENERIC_TYPES.has(mediaType) || !mediaType.includes("/")) {
    return rendererFromSuffix(fileName);
  }
  return "metadata";
}

export function safeTextPayload(
  payload: Readonly<Record<string, unknown>> | undefined
): string | null {
  if (!payload) return null;
  for (const key of ["markdown", "text", "log", "content"] as const) {
    const value = payload[key];
    if (typeof value === "string" && value.length <= 16_384) return value;
  }
  return null;
}

export function safeStructuredRows(
  payload: Readonly<Record<string, unknown>> | undefined
): { headers: string[]; rows: string[][] } | null {
  if (
    !payload ||
    !Array.isArray(payload.headers) ||
    !Array.isArray(payload.rows)
  )
    return null;
  if (
    payload.headers.length === 0 ||
    payload.headers.length > 64 ||
    payload.rows.length > 200
  )
    return null;
  const headers = payload.headers.every(
    (value) => typeof value === "string" && value.length <= 256
  )
    ? (payload.headers as string[])
    : null;
  if (!headers) return null;
  const rows: string[][] = [];
  for (const rawRow of payload.rows) {
    if (!Array.isArray(rawRow) || rawRow.length !== headers.length) return null;
    const row: string[] = [];
    for (const value of rawRow) {
      if (
        value !== null &&
        typeof value !== "string" &&
        typeof value !== "number" &&
        typeof value !== "boolean"
      )
        return null;
      const cell = value === null ? "" : String(value);
      if (cell.length > 2_048) return null;
      row.push(cell);
    }
    rows.push(row);
  }
  return { headers: [...headers], rows };
}
