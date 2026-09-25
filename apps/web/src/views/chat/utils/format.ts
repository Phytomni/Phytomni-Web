import type { CitationDocument } from "../messageTypes";
import { decodeCitationPresentation } from "@/utils/citation-presentation";

// Check whether a string is valid JSON
export const isValidJSON = (str: string): boolean => {
  try {
    JSON.parse(str);
    return true;
  } catch {
    return false;
  }
};

/** Parse an agent answer into a record without exposing JSON.parse's any type. */
export function parseAgentAnswer(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function optionalStringValue(
  value: Record<string, unknown>,
  key: string
): string | undefined {
  const candidate = value[key];
  return typeof candidate === "string" ? candidate : undefined;
}

/** Preserve source-array positions, including rejected presentation slots. */
export function decodeCitationDocuments(
  value: unknown
): CitationDocument[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return Array.from(value, (item) =>
    isRecord(item)
      ? { ...item, citation: decodeCitationPresentation(item.citation) }
      : { citation: null }
  );
}

// Convert data into Element Plus Table format
export interface TableDataInput {
  title?: string;
  headers: readonly string[];
  rows: readonly unknown[][];
}

/** Decode the table shape before it reaches Element Plus table rendering. */
export function decodeTableDataInput(value: unknown): TableDataInput {
  if (!isRecord(value)) return { headers: [], rows: [] };
  const headers = value.headers;
  const rows = value.rows;
  if (
    !Array.isArray(headers) ||
    !headers.every((item): item is string => typeof item === "string") ||
    !Array.isArray(rows)
  ) {
    return { headers: [], rows: [] };
  }
  const title = optionalStringValue(value, "title")?.trim();
  return {
    ...(title ? { title } : {}),
    headers,
    rows: rows.filter((item): item is unknown[] => Array.isArray(item)),
  };
}

export const convertToTableData = (
  data: TableDataInput
): Array<Record<string, unknown>> => {
  return data.rows.map((row) => {
    const obj: Record<string, unknown> = {};
    data.headers.forEach((header, index) => {
      // replace spaces with underscores to avoid spaces in property names
      const key = header.replace(/\s+/g, "_").toLowerCase();
      obj[key] = row[index];
    });
    return obj;
  });
};

const TABLE_HEADER_ACRONYMS = new Set([
  "aa",
  "bp",
  "cds",
  "dna",
  "fpkm",
  "go",
  "gwas",
  "id",
  "ids",
  "kb",
  "kegg",
  "lncrna",
  "mb",
  "mirna",
  "mrna",
  "ncbi",
  "ncrna",
  "orf",
  "pdb",
  "qtl",
  "rna",
  "snp",
  "tpm",
]);

function formatTableHeaderToken(token: string, isFirst: boolean): string {
  const lower = token.toLowerCase();
  if (TABLE_HEADER_ACRONYMS.has(lower)) {
    if (lower === "id") return "ID";
    if (lower === "ids") return "IDs";
    return lower.toUpperCase();
  }
  if (isFirst) {
    return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
  }
  return lower;
}

/** Turn machine column names into scanable labels. Leaves phrases with spaces. */
export function humanizeTableHeaderLabel(label: string): string {
  const trimmed = label.trim().replace(/\s+/g, " ");
  if (!trimmed) return trimmed;
  if (/\s/u.test(trimmed)) return trimmed;

  const stripped = trimmed.replace(/_t\d+$/iu, "");
  const tokens = stripped.split(/_+/u).filter(Boolean);
  if (tokens.length === 0) return trimmed;

  return tokens
    .map((token, index) => formatTableHeaderToken(token, index === 0))
    .join(" ");
}

export const formatFileSize = (size: number) => {
  if (size < 1024) {
    return size + " B";
  } else if (size < 1024 * 1024) {
    return (size / 1024).toFixed(2) + " KB";
  } else {
    return (size / (1024 * 1024)).toFixed(2) + " MB";
  }
};
