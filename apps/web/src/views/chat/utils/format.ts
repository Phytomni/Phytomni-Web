import type { CitationDocument } from "../messageTypes";

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

/** Keep only object-shaped citation rows from an untrusted agent answer. */
export function decodeCitationDocuments(
  value: unknown
): CitationDocument[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is CitationDocument => isRecord(item));
}

// Convert data into Element Plus Table format
export interface TableDataInput {
  headers: readonly string[];
  rows: readonly unknown[][];
}

export interface TableMessagePresentation {
  content: Array<Record<string, unknown>>;
  tableHeaders: Array<{ prop: string; label: string }>;
  original: string;
}

const MAX_VISIBLE_TABLE_JSON_CHARS = 16 * 1024 * 1024;
const MAX_VISIBLE_TABLE_HEADERS = 256;
const MAX_VISIBLE_TABLE_ROWS = 100_000;
const MAX_VISIBLE_TABLE_HEADER_CHARS = 512;
const MAX_VISIBLE_TABLE_CELL_CHARS = 8192;

function isVisibleTableCell(value: unknown): boolean {
  return (
    value === null ||
    typeof value === "boolean" ||
    (typeof value === "number" &&
      Number.isFinite(value) &&
      (!Number.isInteger(value) || Number.isSafeInteger(value))) ||
    (typeof value === "string" &&
      [...value].length <= MAX_VISIBLE_TABLE_CELL_CHARS)
  );
}

/** Decode the complete DataAgent display document from V2 message content. */
export function decodeTableMessagePresentation(
  value: unknown
): TableMessagePresentation | undefined {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_VISIBLE_TABLE_JSON_CHARS
  ) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  const headers = parsed.headers;
  const rows = parsed.rows;
  if (
    !Array.isArray(headers) ||
    headers.length === 0 ||
    headers.length > MAX_VISIBLE_TABLE_HEADERS ||
    !headers.every(
      (header): header is string =>
        typeof header === "string" &&
        header.length > 0 &&
        [...header].length <= MAX_VISIBLE_TABLE_HEADER_CHARS
    ) ||
    !Array.isArray(rows) ||
    rows.length > MAX_VISIBLE_TABLE_ROWS ||
    !rows.every(
      (row): row is unknown[] =>
        Array.isArray(row) &&
        row.length === headers.length &&
        row.every(isVisibleTableCell)
    )
  ) {
    return undefined;
  }
  const table = { headers, rows } satisfies TableDataInput;
  return {
    content: convertToTableData(table),
    tableHeaders: headers.map((header) => ({
      prop: header.replace(/\s+/g, "_").toLowerCase(),
      label: header,
    })),
    original: value,
  };
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
  return {
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

export const formatFileSize = (size: number) => {
  if (size < 1024) {
    return size + " B";
  } else if (size < 1024 * 1024) {
    return (size / 1024).toFixed(2) + " KB";
  } else {
    return (size / (1024 * 1024)).toFixed(2) + " MB";
  }
};
