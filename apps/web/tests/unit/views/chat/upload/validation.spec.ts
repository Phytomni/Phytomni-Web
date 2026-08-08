import { describe, expect, it } from "vitest";

import {
  validateUploadFile,
  type UploadFileMetadata,
  type UploadValidationLimits,
} from "@/views/chat/upload/validation";

const NEGOTIATED_LIMITS: UploadValidationLimits = Object.freeze({
  maxFileBytes: 10 * 1024 ** 3,
  maxAttachments: 64,
});

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
    const result = validateUploadFile(metadata(name), 0, NEGOTIATED_LIMITS);
    expect(result).toEqual({ ok: true, normalizedName: name });
  });

  it("accepts an empty MIME hint", () => {
    expect(
      validateUploadFile(
        metadata("sample.data", { type: "" }),
        0,
        NEGOTIATED_LIMITS
      )
    ).toEqual({ ok: true, normalizedName: "sample.data" });
  });

  it("accepts slash-separated MIME hints without restricting formats", () => {
    expect(
      validateUploadFile(
        metadata("sample.data", { type: "application/vnd.custom+binary" }),
        0,
        NEGOTIATED_LIMITS
      )
    ).toEqual({ ok: true, normalizedName: "sample.data" });
  });

  it("normalizes the create/display filename to NFC without changing the byte source", () => {
    const result = validateUploadFile(
      metadata("e\u0301.fastq"),
      0,
      NEGOTIATED_LIMITS
    );
    expect(result).toEqual({ ok: true, normalizedName: "é.fastq" });
  });

  it.each([
    [1, true],
    [NEGOTIATED_LIMITS.maxFileBytes, true],
    [NEGOTIATED_LIMITS.maxFileBytes + 1, false],
  ])("enforces the exact file-size boundary %s", (size, valid) => {
    expect(
      validateUploadFile(metadata("sample.bin", { size }), 0, NEGOTIATED_LIMITS)
        .ok
    ).toBe(valid);
  });

  it("uses a lower negotiated file-size boundary", () => {
    const limits = Object.freeze({
      maxFileBytes: 2,
      maxAttachments: 64,
    });

    expect(
      validateUploadFile(metadata("sample.bin", { size: 2 }), 0, limits).ok
    ).toBe(true);
    expect(
      validateUploadFile(metadata("sample.bin", { size: 3 }), 0, limits)
    ).toEqual({ ok: false, code: "invalid_size" });
  });

  it.each([
    "",
    ".",
    "..",
    "../sample.fasta",
    `..\\sample.fasta`,
    "bad\u0000.fasta",
  ])("rejects unsafe filename %s", (name) => {
    expect(
      validateUploadFile(metadata(name), 0, NEGOTIATED_LIMITS)
    ).toMatchObject({
      ok: false,
      code: "invalid_filename",
    });
  });

  it("rejects a filename over the UTF-8 byte boundary", () => {
    expect(
      validateUploadFile(metadata("界".repeat(128)), 0, NEGOTIATED_LIMITS)
    ).toMatchObject({
      ok: false,
      code: "invalid_filename",
    });
  });

  it("rejects a non-safe integer size without allocating the file", () => {
    expect(
      validateUploadFile(
        metadata("sample.bin", { size: Number.MAX_SAFE_INTEGER }),
        0,
        NEGOTIATED_LIMITS
      )
    ).toMatchObject({ ok: false, code: "invalid_size" });
  });

  it("enforces the negotiated 64-attachment queue boundary", () => {
    expect(
      validateUploadFile(metadata("sample.bin"), 63, NEGOTIATED_LIMITS)
    ).toMatchObject({ ok: true });
    expect(
      validateUploadFile(metadata("sample.bin"), 64, NEGOTIATED_LIMITS)
    ).toEqual({ ok: false, code: "too_many_files" });
  });

  it.each([
    ["negative lastModified", { lastModified: -1 }],
    ["non-string MIME", { type: 7 as never }],
    ["oversized MIME", { type: "x".repeat(257) }],
  ])("rejects malformed metadata: %s", (_label, overrides) => {
    expect(
      validateUploadFile(
        metadata("sample.bin", overrides),
        0,
        NEGOTIATED_LIMITS
      )
    ).toMatchObject({
      ok: false,
      code: "invalid_metadata",
    });
  });
});
