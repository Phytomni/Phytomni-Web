import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createUploadDataPlane,
  UploadTransportError,
} from "@/views/chat/upload/transport";

const origin = "https://upload.example";
const assetId = "file_abc123";
const uploadUrl = `${origin}/v1/files/${assetId}`;
const capability = "opaque-capability";
const digest = "a".repeat(64);

function headResponse(overrides: Record<string, string> = {}): Response {
  return new Response(null, {
    status: 200,
    headers: {
      "Upload-Protocol": "obs-multipart-v2",
      "Upload-Status": "uploading",
      "Upload-Length": "6",
      "Upload-Part-Size": "3",
      "Upload-Part-Count": "3",
      "Upload-Received-Parts": "1-2",
      ...overrides,
    },
  });
}

class FakeXHR {
  static instances: FakeXHR[] = [];
  method = "";
  url = "";
  responseURL = "";
  status = 200;
  responseHeaders: Record<string, string> = {};
  withCredentials = true;
  body: Blob | null = null;
  headers: Record<string, string> = {};
  upload: { onprogress: ((event: ProgressEvent) => void) | null } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;

  constructor() {
    FakeXHR.instances.push(this);
  }

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
    this.responseURL = url;
  }

  setRequestHeader(name: string, value: string): void {
    this.headers[name] = value;
  }

  getResponseHeader(name: string): string | null {
    return this.responseHeaders[name] ?? null;
  }

  send(body: Blob): void {
    this.body = body;
    this.upload.onprogress?.({
      lengthComputable: true,
      loaded: body.size,
      total: body.size,
    } as ProgressEvent);
    queueMicrotask(() => this.onload?.());
  }

  abort(): void {
    this.onabort?.();
  }
}

describe("upload data-plane transport", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    FakeXHR.instances = [];
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("recovers range-compressed parts with only documented request headers", async () => {
    fetchMock.mockResolvedValueOnce(headResponse());
    const plane = createUploadDataPlane({
      uploadUrl,
      expectedOrigin: origin,
      assetId,
      capability,
    });

    await expect(plane.head()).resolves.toMatchObject({
      protocol: "obs-multipart-v2",
      lengthBytes: 6,
      partSizeBytes: 3,
      partCount: 3,
      receivedParts: [1, 2],
    });
    expect(fetchMock).toHaveBeenCalledWith(uploadUrl, {
      method: "HEAD",
      headers: { Authorization: `Bearer ${capability}` },
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      mode: "cors",
      signal: undefined,
    });
  });

  it("uses XHR for real Blob progress without cookies or the Web JWT", async () => {
    const progress: Array<{ loaded: number; total: number }> = [];
    const plane = createUploadDataPlane({
      uploadUrl,
      expectedOrigin: origin,
      assetId,
      capability,
    });
    const part = new Blob(["abc"]);

    await plane.putPart(1, part, digest, {
      onProgress: (value) => progress.push(value),
    });

    const xhr = FakeXHR.instances[0];
    expect(xhr.method).toBe("PUT");
    expect(xhr.url).toBe(`${uploadUrl}/parts/1`);
    expect(xhr.body).toBe(part);
    expect(xhr.withCredentials).toBe(false);
    expect(xhr.headers).toEqual({
      Authorization: `Bearer ${capability}`,
      "Content-Type": "application/octet-stream",
      "X-Phytomni-Part-SHA256": digest,
    });
    expect(progress).toEqual([{ loaded: 3, total: 3 }]);
    expect(xhr.headers).not.toHaveProperty("Cookie");
    expect(xhr.headers).not.toHaveProperty("satoken");
  });

  it("posts completion without submitting ETags or file bytes", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          asset_id: assetId,
          status: "completed",
          filename: "sample.fastq.gz",
          size_bytes: 6,
          completed_at: "2026-08-01T05:00:00+08:00",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    const plane = createUploadDataPlane({
      uploadUrl,
      expectedOrigin: origin,
      assetId,
      capability,
    });

    await expect(plane.complete()).resolves.toMatchObject({
      asset_id: assetId,
      status: "completed",
    });
    expect(fetchMock).toHaveBeenCalledWith(`${uploadUrl}/complete`, {
      method: "POST",
      headers: { Authorization: `Bearer ${capability}` },
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      mode: "cors",
      signal: undefined,
    });
  });

  it("rejects a redirected XHR response", async () => {
    const plane = createUploadDataPlane({
      uploadUrl,
      expectedOrigin: origin,
      assetId,
      capability,
    });
    const pending = plane.putPart(1, new Blob(["abc"]), digest);
    FakeXHR.instances[0].responseURL = "https://evil.example/parts/1";

    await expect(pending).rejects.toMatchObject<Partial<UploadTransportError>>({
      code: "upload_redirect_rejected",
    });
  });

  it("honors Retry-After from an XHR 429 response", async () => {
    const plane = createUploadDataPlane({
      uploadUrl,
      expectedOrigin: origin,
      assetId,
      capability,
    });
    const pending = plane.putPart(1, new Blob(["abc"]), digest);
    FakeXHR.instances[0].status = 429;
    FakeXHR.instances[0].responseHeaders["Retry-After"] = "7";

    await expect(pending).rejects.toMatchObject<Partial<UploadTransportError>>({
      status: 429,
      code: "upload_rate_limited",
      retryAfterSeconds: 7,
    });
  });

  it("rejects protocol or range header drift before returning state", async () => {
    fetchMock.mockResolvedValueOnce(
      headResponse({
        "Upload-Protocol": "other",
      })
    );
    const plane = createUploadDataPlane({
      uploadUrl,
      expectedOrigin: origin,
      assetId,
      capability,
    });

    await expect(plane.head()).rejects.toMatchObject({
      code: "upload_protocol_mismatch",
    });
  });

  it.each([
    ["overlapping ranges", { "Upload-Received-Parts": "1-2,2-3" }],
    ["duplicate ranges", { "Upload-Received-Parts": "1,1" }],
    ["malformed range", { "Upload-Received-Parts": "1-" }],
    ["non-decimal range", { "Upload-Received-Parts": "1e1" }],
  ])("rejects %s in HEAD recovery metadata", async (_name, headers) => {
    fetchMock.mockResolvedValueOnce(headResponse(headers));
    const plane = createUploadDataPlane({
      uploadUrl,
      expectedOrigin: origin,
      assetId,
      capability,
    });

    await expect(plane.head()).rejects.toMatchObject({
      code: "invalid_upload_response",
    });
  });

  it("rejects an oversized part count before expanding ranges", async () => {
    fetchMock.mockResolvedValueOnce(
      headResponse({ "Upload-Part-Count": "100001" })
    );
    const plane = createUploadDataPlane({
      uploadUrl,
      expectedOrigin: origin,
      assetId,
      capability,
    });

    await expect(plane.head()).rejects.toMatchObject({
      code: "invalid_upload_response",
    });
  });

  it("rejects a non-decimal part count header", async () => {
    fetchMock.mockResolvedValueOnce(
      headResponse({ "Upload-Part-Count": "1e2" })
    );
    const plane = createUploadDataPlane({
      uploadUrl,
      expectedOrigin: origin,
      assetId,
      capability,
    });

    await expect(plane.head()).rejects.toMatchObject({
      code: "invalid_upload_response",
    });
  });
});
