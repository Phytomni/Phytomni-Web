import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/utils/request", () => ({ default: vi.fn() }));

import request from "@/utils/request";
import {
  createUpload,
  renewUploadCapability,
  RESUMABLE_UPLOAD_PROTOCOL,
} from "@/api/upload";

const mockRequest = vi.mocked(request);

const createData = {
  protocol: RESUMABLE_UPLOAD_PROTOCOL,
  asset_id: "file_abc123",
  status: "uploading",
  part_size_bytes: 128 * 1024 * 1024,
  part_count: 2,
  max_parallel_parts: 4,
  upload_url: "https://upload.example/v1/files/file_abc123",
  capability: "opaque-capability",
  capability_expires_at: "2026-08-01T05:15:00+08:00",
  session_expires_at: "2026-08-08T05:00:00+08:00",
};

describe("upload control API", () => {
  beforeEach(() => {
    mockRequest.mockReset();
  });

  it("keeps metadata control calls on the authenticated Web request client", async () => {
    mockRequest.mockResolvedValueOnce({ code: 200, data: createData });

    await expect(
      createUpload(
        {
          filename: "sample.fastq.gz",
          size_bytes: 42,
          content_type_hint: "application/gzip",
          last_modified_ms: 123,
        },
        "1c2d3e4f-5061-4789-8abc-def012345678"
      )
    ).resolves.toMatchObject({ code: 200, data: createData });

    expect(mockRequest).toHaveBeenCalledWith({
      url: "/api/v1/files",
      method: "post",
      data: {
        filename: "sample.fastq.gz",
        size_bytes: 42,
        content_type_hint: "application/gzip",
        last_modified_ms: 123,
      },
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "1c2d3e4f-5061-4789-8abc-def012345678",
      },
    });
  });

  it("rejects malformed create responses instead of widening the DTO", async () => {
    mockRequest.mockResolvedValueOnce({
      code: 200,
      data: { ...createData, part_count: Number.MAX_SAFE_INTEGER + 1 },
    });

    await expect(
      createUpload(
        {
          filename: "sample",
          size_bytes: 1,
          content_type_hint: "",
          last_modified_ms: 0,
        },
        "1c2d3e4f-5061-4789-8abc-def012345678"
      )
    ).rejects.toThrow("Invalid upload response");
  });

  it.each([
    ["wrong status", { status: "aborted" }],
    [
      "path mismatch",
      { upload_url: "https://upload.example/other/file_abc123" },
    ],
    ["query token", { upload_url: `${createData.upload_url}?token=secret` }],
    ["oversized part count", { part_count: 100_001 }],
    ["oversized parallelism", { max_parallel_parts: 5 }],
    ["malformed expiry", { session_expires_at: "not-a-timestamp" }],
  ])("rejects %s in a create response", async (_name, override) => {
    mockRequest.mockResolvedValueOnce({
      code: 200,
      data: { ...createData, ...override },
    });

    await expect(
      createUpload(
        {
          filename: "sample",
          size_bytes: 1,
          content_type_hint: "",
          last_modified_ms: 0,
        },
        "1c2d3e4f-5061-4789-8abc-def012345678"
      )
    ).rejects.toThrow("Invalid upload response");
  });

  it("renews a capability without sending browser authority or a request body", async () => {
    mockRequest.mockResolvedValueOnce({
      code: 200,
      data: {
        protocol: RESUMABLE_UPLOAD_PROTOCOL,
        asset_id: "file_abc123",
        status: "uploading",
        upload_url: createData.upload_url,
        capability: "fresh-capability",
        capability_expires_at: createData.capability_expires_at,
        session_expires_at: createData.session_expires_at,
      },
    });

    await expect(renewUploadCapability("file_abc123")).resolves.toMatchObject({
      code: 200,
      data: { capability: "fresh-capability" },
    });
    expect(mockRequest).toHaveBeenCalledWith({
      url: "/api/v1/files/file_abc123/capability",
      method: "post",
    });
  });

  it("rejects malformed asset IDs before making a control request", () => {
    expect(() => renewUploadCapability("../other")).toThrow(
      "Invalid upload asset id"
    );
    expect(mockRequest).not.toHaveBeenCalled();
  });
});
