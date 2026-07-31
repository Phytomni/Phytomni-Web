import { describe, expect, it } from "vitest";

import {
  RESUMABLE_UPLOAD_LIMITS,
  validateUploadFile,
  type UploadFileMetadata,
} from "@/views/chat/upload/validation";

function metadata(
  name: string,
  overrides: Partial<UploadFileMetadata> = {}
): UploadFileMetadata {
  return {
    name,
    size: 1,
    type: "",
    lastModified: 0,
    ...overrides,
  };
}

describe("validateUploadFile", () => {
  it.each([
    "genome.fasta",
    "reads.fastq.gz",
    "variants.vcf.gz",
    "annotation.gtf",
    "regions.bed",
    "alignment.bam",
    "single_cell.h5ad",
    "extensionless",
    "sample.bin",
  ])("accepts arbitrary biological filename %s", (name) => {
    const result = validateUploadFile(metadata(name));
    expect(result).toEqual({ ok: true, normalizedName: name });
  });

  it("accepts an empty MIME hint", () => {
    expect(validateUploadFile(metadata("sample.data", { type: "" }))).toEqual({
      ok: true,
      normalizedName: "sample.data",
    });
  });

  it("normalizes the create/display filename to NFC without changing the byte source", () => {
    const result = validateUploadFile(metadata("e\u0301.fastq"));
    expect(result).toEqual({ ok: true, normalizedName: "é.fastq" });
  });

  it.each([
    [1, true],
    [RESUMABLE_UPLOAD_LIMITS.maxFileBytes, true],
    [RESUMABLE_UPLOAD_LIMITS.maxFileBytes + 1, false],
  ])("enforces the exact file-size boundary %s", (size, valid) => {
    expect(validateUploadFile(metadata("sample.bin", { size })).ok).toBe(valid);
  });

  it.each([
    "",
    ".",
    "..",
    "../sample.fasta",
    `..\\sample.fasta`,
    "bad\u0000.fasta",
  ])("rejects unsafe filename %s", (name) => {
    expect(validateUploadFile(metadata(name))).toMatchObject({
      ok: false,
      code: "invalid_filename",
    });
  });

  it("rejects a filename over the UTF-8 byte boundary", () => {
    expect(validateUploadFile(metadata("界".repeat(128)))).toMatchObject({
      ok: false,
      code: "invalid_filename",
    });
  });

  it("rejects a non-safe integer size without allocating the file", () => {
    expect(
      validateUploadFile(
        metadata("sample.bin", { size: Number.MAX_SAFE_INTEGER })
      )
    ).toMatchObject({ ok: false, code: "invalid_size" });
  });

  it("enforces the ten-attachment queue boundary", () => {
    expect(
      validateUploadFile(
        metadata("sample.bin"),
        RESUMABLE_UPLOAD_LIMITS.maxAttachments - 1
      )
    ).toMatchObject({ ok: true });
    expect(
      validateUploadFile(
        metadata("sample.bin"),
        RESUMABLE_UPLOAD_LIMITS.maxAttachments
      )
    ).toEqual({ ok: false, code: "too_many_files" });
  });

  it.each([
    ["negative lastModified", { lastModified: -1 }],
    ["non-string MIME", { type: 7 as never }],
    ["oversized MIME", { type: "x".repeat(257) }],
  ])("rejects malformed metadata: %s", (_label, overrides) => {
    expect(validateUploadFile(metadata("sample.bin", overrides))).toMatchObject(
      {
        ok: false,
        code: "invalid_metadata",
      }
    );
  });
});
