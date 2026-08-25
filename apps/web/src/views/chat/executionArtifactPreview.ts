import { getExecutionTargetFile } from "@/api/chat";
import type { ExecutionDetailRenderer } from "./executionDetailRenderers";
import { safeStructuredRows } from "./executionDetailRenderers";
import { executionTargetBlob } from "./executionTargetContent";

const MAX_TEXT_PREVIEW_BYTES = 1_048_576;
const MAX_IMAGE_PREVIEW_BYTES = 10_485_760;
const MAX_PDF_PREVIEW_BYTES = 25_165_824;
const IMAGE_SUFFIX_MEDIA_TYPES = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".svg", "image/svg+xml"],
]);

function safeImageMediaType(name: string): string | null {
  const normalized = name.trim().toLowerCase();
  for (const [suffix, mediaType] of IMAGE_SUFFIX_MEDIA_TYPES) {
    if (normalized.endsWith(suffix)) return mediaType;
  }
  return null;
}

export type ExecutionArtifactPreview =
  | { kind: "text"; text: string }
  | { kind: "structured"; text: string }
  | {
      kind: "table";
      table: { headers: string[]; rows: string[][] };
    }
  | { kind: "image"; blob: Blob }
  | { kind: "pdf"; blob: Blob }
  | {
      kind: "unavailable";
      reason: "unsupported" | "too_large" | "invalid_content";
    };

export interface ExecutionArtifactPreviewRequest {
  deliveryUrl: string;
  renderer: ExecutionDetailRenderer;
  name: string;
  sizeBytes?: number;
  requestId: string;
}

function previewLimit(renderer: ExecutionDetailRenderer): number | null {
  if (renderer === "image") return MAX_IMAGE_PREVIEW_BYTES;
  if (renderer === "pdf") return MAX_PDF_PREVIEW_BYTES;
  if (
    renderer === "markdown" ||
    renderer === "log" ||
    renderer === "table" ||
    renderer === "structured"
  ) {
    return MAX_TEXT_PREVIEW_BYTES;
  }
  return null;
}

function parseDelimited(text: string, delimiter: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"' && cell.length === 0) {
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell.endsWith("\r") ? cell.slice(0, -1) : cell);
      rows.push(row);
      row = [];
      cell = "";
      if (rows.length > 201) return null;
    } else {
      cell += char;
    }
  }
  if (quoted) return null;
  if (cell.length > 0 || row.length > 0) {
    row.push(cell.endsWith("\r") ? cell.slice(0, -1) : cell);
    rows.push(row);
  }
  const [headers, ...body] = rows;
  if (!headers) return null;
  return safeStructuredRows({ headers, rows: body });
}

export async function loadExecutionArtifactPreview(
  request: ExecutionArtifactPreviewRequest
): Promise<ExecutionArtifactPreview> {
  const limit = previewLimit(request.renderer);
  if (limit === null) return { kind: "unavailable", reason: "unsupported" };
  if (
    typeof request.sizeBytes === "number" &&
    (request.sizeBytes < 0 || request.sizeBytes > limit)
  ) {
    return { kind: "unavailable", reason: "too_large" };
  }

  const response = await getExecutionTargetFile(request.deliveryUrl, {
    requestId: request.requestId,
  });
  const blob = executionTargetBlob(response);
  if (!blob) {
    return { kind: "unavailable", reason: "invalid_content" };
  }
  if (blob.size > limit) return { kind: "unavailable", reason: "too_large" };
  if (request.renderer === "image") {
    const mediaType = safeImageMediaType(request.name);
    if (!mediaType) {
      return { kind: "unavailable", reason: "invalid_content" };
    }
    return {
      kind: "image",
      blob:
        blob.type === mediaType ? blob : new Blob([blob], { type: mediaType }),
    };
  }
  if (request.renderer === "pdf") {
    if ((await blob.slice(0, 5).text()) !== "%PDF-") {
      return { kind: "unavailable", reason: "invalid_content" };
    }
    return {
      kind: "pdf",
      blob:
        blob.type === "application/pdf"
          ? blob
          : new Blob([blob], { type: "application/pdf" }),
    };
  }

  const text = await blob.text();
  if (request.renderer === "structured") {
    try {
      const formatted = JSON.stringify(JSON.parse(text), null, 2);
      if (formatted.length > MAX_TEXT_PREVIEW_BYTES) {
        return { kind: "unavailable", reason: "too_large" };
      }
      return { kind: "structured", text: formatted };
    } catch {
      return { kind: "unavailable", reason: "invalid_content" };
    }
  }
  if (request.renderer === "table") {
    const table = parseDelimited(
      text,
      request.name.toLowerCase().endsWith(".tsv") ? "\t" : ","
    );
    return table
      ? { kind: "table", table }
      : { kind: "unavailable", reason: "invalid_content" };
  }
  return { kind: "text", text };
}
