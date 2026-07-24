import type { CitationDocument } from "../messageTypes";

// Check whether a string is valid JSON
export const isValidJSON = (str: string): boolean => {
  try {
    JSON.parse(str);
    return true;
  } catch (e) {
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
