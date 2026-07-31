import type { ResumableUploadItem } from "./types";

export const RESUMABLE_UPLOAD_LIMITS = Object.freeze({
  maxFileBytes: 10 * 1024 * 1024 * 1024,
  maxAttachments: 10,
  maxFilenameBytes: 255,
  maxContentTypeBytes: 256,
});

export type UploadFileMetadata = Pick<
  File,
  "name" | "size" | "type" | "lastModified"
>;

export type UploadValidationErrorCode =
  "too_many_files" | "invalid_filename" | "invalid_size" | "invalid_metadata";

export type UploadValidationResult =
  | {
      ok: true;
      normalizedName: string;
    }
  | {
      ok: false;
      code: UploadValidationErrorCode;
    };

function utf8ByteLength(value: string): number {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(value).byteLength;
  }
  return encodeURIComponent(value).replace(/%[0-9A-F]{2}|./g, "x").length;
}

function hasUnsafeFilenameRune(value: string): boolean {
  for (const rune of value) {
    const codePoint = rune.codePointAt(0) ?? 0;
    if (
      codePoint < 0x20 ||
      codePoint === 0x7f ||
      rune === "/" ||
      rune === "\\"
    ) {
      return true;
    }
  }
  return false;
}

function hasUnsafeControlRune(value: string): boolean {
  for (const rune of value) {
    const codePoint = rune.codePointAt(0) ?? 0;
    if (codePoint < 0x20 || codePoint === 0x7f) return true;
  }
  return false;
}

function isSafeFilename(name: unknown): name is string {
  if (typeof name !== "string") return false;
  let normalized: string;
  try {
    normalized = name.normalize("NFC");
  } catch {
    return false;
  }
  return (
    normalized.length > 0 &&
    normalized !== "." &&
    normalized !== ".." &&
    utf8ByteLength(normalized) <= RESUMABLE_UPLOAD_LIMITS.maxFilenameBytes &&
    !hasUnsafeFilenameRune(normalized)
  );
}

function normalizedFilename(name: string): string {
  return name.normalize("NFC");
}

function isSafeContentType(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return (
    utf8ByteLength(value) <= RESUMABLE_UPLOAD_LIMITS.maxContentTypeBytes &&
    !hasUnsafeControlRune(value)
  );
}

/** Validate browser metadata without reading or allocating file bytes. */
export function validateUploadFile(
  file: UploadFileMetadata,
  existingCount = 0
): UploadValidationResult {
  if (
    !Number.isSafeInteger(existingCount) ||
    existingCount < 0 ||
    existingCount >= RESUMABLE_UPLOAD_LIMITS.maxAttachments
  ) {
    return { ok: false, code: "too_many_files" };
  }
  if (!isSafeFilename(file?.name)) {
    return { ok: false, code: "invalid_filename" };
  }
  if (
    !Number.isSafeInteger(file?.size) ||
    file.size < 1 ||
    file.size > RESUMABLE_UPLOAD_LIMITS.maxFileBytes
  ) {
    return { ok: false, code: "invalid_size" };
  }
  if (
    !isSafeContentType(file?.type) ||
    !Number.isSafeInteger(file?.lastModified) ||
    file.lastModified < 0
  ) {
    return { ok: false, code: "invalid_metadata" };
  }
  return { ok: true, normalizedName: normalizedFilename(file.name) };
}

/** Return only items that are fully completed and safe to submit. */
export function completedUploadItems(
  items: readonly ResumableUploadItem[]
): ResumableUploadItem[] {
  return items.filter(
    (item) =>
      item.status === "completed" &&
      typeof item.assetId === "string" &&
      item.assetId.startsWith("file_")
  );
}
