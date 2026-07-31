import { uploadEndpoint, validateUploadURL } from "@/views/chat/upload/url";
import { RESUMABLE_UPLOAD_PROTOCOL } from "@/api/upload";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024 * 1024;
const MAX_HEADER_PARTS = 100_000;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export interface UploadDataPlaneOptions {
  uploadUrl: string;
  expectedOrigin: string;
  assetId: string;
  capability: string;
}

export interface UploadHeadState {
  protocol: typeof RESUMABLE_UPLOAD_PROTOCOL;
  status: string;
  lengthBytes: number;
  partSizeBytes: number;
  partCount: number;
  receivedParts: number[];
  retryAfterSeconds: number | null;
  requestId: string | null;
}

export interface UploadCompletion {
  asset_id: string;
  status: "completed";
  filename: string;
  size_bytes: number;
  completed_at: string;
}

export interface UploadPartProgress {
  loaded: number;
  total: number;
}

export interface UploadRequestOptions {
  signal?: AbortSignal;
}

export interface UploadPartOptions extends UploadRequestOptions {
  onProgress?: (progress: UploadPartProgress) => void;
}

export interface UploadDataPlane {
  head(options?: UploadRequestOptions): Promise<UploadHeadState>;
  putPart(
    partNumber: number,
    body: Blob,
    sha256: string,
    options?: UploadPartOptions
  ): Promise<void>;
  complete(options?: UploadRequestOptions): Promise<UploadCompletion>;
  abort(options?: UploadRequestOptions): Promise<void>;
}

export class UploadTransportError extends Error {
  readonly status: number | null;
  readonly code: string;
  readonly retryAfterSeconds: number | null;

  constructor(
    message: string,
    options: {
      status?: number | null;
      code?: string;
      retryAfterSeconds?: number | null;
    } = {}
  ) {
    super(message);
    this.name = "UploadTransportError";
    this.status = options.status ?? null;
    this.code = options.code ?? "upload_transport_error";
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
  }
}

function responseError(response: Response): UploadTransportError {
  const retryAfter = parseOptionalNonNegativeInteger(
    response.headers.get("Retry-After")
  );
  const codeByStatus: Record<number, string> = {
    400: "invalid_upload_metadata",
    401: "upload_capability_invalid",
    404: "upload_asset_not_found",
    409: "upload_state_conflict",
    410: "upload_session_expired",
    413: "upload_limit_exceeded",
    422: "upload_checksum_mismatch",
    429: "upload_rate_limited",
    502: "obs_outcome_unknown",
    503: "upload_storage_unavailable",
  };
  return new UploadTransportError("Upload request failed", {
    status: response.status,
    code: codeByStatus[response.status] ?? "upload_transport_error",
    retryAfterSeconds: retryAfter,
  });
}

function parseOptionalNonNegativeInteger(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const candidate = Number(value);
  return Number.isSafeInteger(candidate) && candidate >= 0 ? candidate : null;
}

function requiredHeader(response: Response, name: string): string {
  const value = response.headers.get(name);
  if (value === null || value.trim() === "") {
    throw new UploadTransportError("Upload response is incomplete", {
      status: response.status,
      code: "invalid_upload_response",
    });
  }
  return value.trim();
}

function parsePositiveHeader(
  response: Response,
  name: string,
  max = Number.MAX_SAFE_INTEGER
): number {
  const candidate = Number(requiredHeader(response, name));
  if (!Number.isSafeInteger(candidate) || candidate < 1 || candidate > max) {
    throw new UploadTransportError("Upload response is invalid", {
      status: response.status,
      code: "invalid_upload_response",
    });
  }
  return candidate;
}

function parseReceivedParts(response: Response, partCount: number): number[] {
  const raw = response.headers.get("Upload-Received-Parts");
  if (raw === null || raw.trim() === "") return [];
  const received = new Set<number>();
  const ranges = raw.split(",");
  if (ranges.length > MAX_HEADER_PARTS) {
    throw new UploadTransportError("Upload response is invalid", {
      status: response.status,
      code: "invalid_upload_response",
    });
  }
  for (const range of ranges) {
    const pieces = range.trim().split("-");
    if (pieces.length > 2 || pieces.some((piece) => piece.trim() === "")) {
      throw new UploadTransportError("Upload response is invalid", {
        status: response.status,
        code: "invalid_upload_response",
      });
    }
    const start = Number(pieces[0]);
    const end = pieces.length === 1 ? start : Number(pieces[1]);
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 1 ||
      end < start ||
      end > partCount ||
      end - start + 1 > MAX_HEADER_PARTS
    ) {
      throw new UploadTransportError("Upload response is invalid", {
        status: response.status,
        code: "invalid_upload_response",
      });
    }
    for (let part = start; part <= end; part += 1) received.add(part);
  }
  return [...received].sort((left, right) => left - right);
}

function parseCompletion(value: unknown, assetId: string): UploadCompletion {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new UploadTransportError("Upload response is invalid", {
      code: "invalid_upload_response",
    });
  }
  const record = value as Record<string, unknown>;
  if (
    record.asset_id !== assetId ||
    record.status !== "completed" ||
    typeof record.filename !== "string" ||
    record.filename.length === 0 ||
    typeof record.size_bytes !== "number" ||
    !Number.isSafeInteger(record.size_bytes) ||
    record.size_bytes < 1 ||
    record.size_bytes > MAX_UPLOAD_BYTES ||
    typeof record.completed_at !== "string" ||
    record.completed_at.length === 0
  ) {
    throw new UploadTransportError("Upload response is invalid", {
      code: "invalid_upload_response",
    });
  }
  return {
    asset_id: assetId,
    status: "completed",
    filename: record.filename,
    size_bytes: record.size_bytes,
    completed_at: record.completed_at,
  };
}

function assertSuccessfulResponse(response: Response): void {
  if (!response.ok) throw responseError(response);
  if (response.url !== "" && response.redirected) {
    throw new UploadTransportError("Upload redirect rejected", {
      status: response.status,
      code: "upload_redirect_rejected",
    });
  }
}

async function fetchUpload(
  url: string,
  method: "HEAD" | "POST" | "DELETE",
  capability: string,
  options?: UploadRequestOptions
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${capability}` },
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      mode: "cors",
      signal: options?.signal,
    });
  } catch (error) {
    if (error instanceof UploadTransportError) throw error;
    throw error;
  }
  if (response.url !== "" && response.url !== url) {
    throw new UploadTransportError("Upload redirect rejected", {
      status: response.status,
      code: "upload_redirect_rejected",
    });
  }
  assertSuccessfulResponse(response);
  return response;
}

function putPartWithXHR(
  url: string,
  capability: string,
  body: Blob,
  sha256: string,
  options?: UploadPartOptions
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (options?.signal?.aborted) {
      reject(new DOMException("Upload aborted", "AbortError"));
      return;
    }
    const xhr = new XMLHttpRequest();
    let settled = false;
    const finish = (error?: unknown): void => {
      if (settled) return;
      settled = true;
      options?.signal?.removeEventListener("abort", abort);
      if (error === undefined) resolve();
      else reject(error);
    };
    const abort = (): void => {
      xhr.abort();
      finish(new DOMException("Upload aborted", "AbortError"));
    };
    options?.signal?.addEventListener("abort", abort, { once: true });
    xhr.open("PUT", url, true);
    xhr.withCredentials = false;
    xhr.setRequestHeader("Authorization", `Bearer ${capability}`);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.setRequestHeader("X-Phytomni-Part-SHA256", sha256);
    xhr.upload.onprogress = (event): void => {
      if (event.lengthComputable) {
        options?.onProgress?.({ loaded: event.loaded, total: event.total });
      }
    };
    xhr.onload = (): void => {
      if (xhr.responseURL !== url) {
        finish(
          new UploadTransportError("Upload redirect rejected", {
            status: xhr.status,
            code: "upload_redirect_rejected",
          })
        );
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        finish(
          new UploadTransportError("Upload request failed", {
            status: xhr.status,
            code: "upload_transport_error",
          })
        );
        return;
      }
      finish();
    };
    xhr.onerror = (): void =>
      finish(new UploadTransportError("Upload network error"));
    xhr.ontimeout = (): void =>
      finish(new UploadTransportError("Upload request timed out"));
    xhr.onabort = (): void => {
      if (!settled) finish(new DOMException("Upload aborted", "AbortError"));
    };
    try {
      xhr.send(body);
    } catch (error) {
      finish(error);
    }
  });
}

export function createUploadDataPlane(
  options: UploadDataPlaneOptions
): UploadDataPlane {
  if (
    typeof options.capability !== "string" ||
    options.capability.length === 0
  ) {
    throw new TypeError("Invalid upload capability");
  }
  const baseURL = validateUploadURL(
    options.uploadUrl,
    options.expectedOrigin,
    options.assetId
  );

  return {
    async head(requestOptions): Promise<UploadHeadState> {
      const response = await fetchUpload(
        baseURL,
        "HEAD",
        options.capability,
        requestOptions
      );
      const protocol = requiredHeader(response, "Upload-Protocol");
      if (protocol !== RESUMABLE_UPLOAD_PROTOCOL) {
        throw new UploadTransportError("Upload protocol mismatch", {
          status: response.status,
          code: "upload_protocol_mismatch",
        });
      }
      const partCount = parsePositiveHeader(response, "Upload-Part-Count");
      return {
        protocol: RESUMABLE_UPLOAD_PROTOCOL,
        status: requiredHeader(response, "Upload-Status"),
        lengthBytes: parsePositiveHeader(
          response,
          "Upload-Length",
          MAX_UPLOAD_BYTES
        ),
        partSizeBytes: parsePositiveHeader(response, "Upload-Part-Size"),
        partCount,
        receivedParts: parseReceivedParts(response, partCount),
        retryAfterSeconds: parseOptionalNonNegativeInteger(
          response.headers.get("Retry-After")
        ),
        requestId:
          response.headers.get("X-Request-Id") ??
          response.headers.get("X-Request-ID"),
      };
    },

    putPart(partNumber, body, sha256, requestOptions): Promise<void> {
      if (!(body instanceof Blob)) throw new TypeError("Invalid upload part");
      if (!SHA256_PATTERN.test(sha256)) {
        throw new TypeError("Invalid upload part checksum");
      }
      const url = uploadEndpoint(baseURL, "parts", partNumber);
      return putPartWithXHR(
        url,
        options.capability,
        body,
        sha256,
        requestOptions
      );
    },

    async complete(requestOptions): Promise<UploadCompletion> {
      const response = await fetchUpload(
        uploadEndpoint(baseURL, "complete"),
        "POST",
        options.capability,
        requestOptions
      );
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new UploadTransportError("Upload response is invalid", {
          status: response.status,
          code: "invalid_upload_response",
        });
      }
      return parseCompletion(payload, options.assetId);
    },

    async abort(requestOptions): Promise<void> {
      await fetchUpload(
        uploadEndpoint(baseURL, "abort"),
        "DELETE",
        options.capability,
        requestOptions
      );
    },
  };
}
