import type { ApiEnvelope } from "@/api/types";
import { requestApi } from "@/api/types";
import { isRecord } from "@/api/contracts";

export const RESUMABLE_UPLOAD_PROTOCOL = "obs-multipart-v2";
export const RESUMABLE_UPLOAD_MAX_BYTES = 10 * 1024 * 1024 * 1024;
export const RESUMABLE_UPLOAD_MAX_PART_COUNT = 100_000;
export const RESUMABLE_UPLOAD_MAX_PARALLEL_PARTS = 4;

export interface UploadCreateMetadata {
  filename: string;
  size_bytes: number;
  content_type_hint: string;
  last_modified_ms: number;
}

export interface UploadSession {
  protocol: typeof RESUMABLE_UPLOAD_PROTOCOL;
  asset_id: string;
  status: string;
  part_size_bytes: number;
  part_count: number;
  max_parallel_parts: number;
  upload_url: string;
  capability: string;
  capability_expires_at: string;
  session_expires_at: string;
}

export interface UploadCapabilityRenewal {
  protocol: typeof RESUMABLE_UPLOAD_PROTOCOL;
  asset_id: string;
  status: string;
  upload_url: string;
  capability: string;
  capability_expires_at: string;
  session_expires_at: string;
}

const ASSET_ID_PATTERN = /^file_[A-Za-z0-9_-]{1,123}$/;

function invalid(label: string): never {
  throw new TypeError(`Invalid ${label}`);
}

function requiredString(
  value: Record<string, unknown>,
  key: string,
  label: string
): string {
  const candidate = value[key];
  if (typeof candidate !== "string" || candidate.length === 0) {
    invalid(label);
  }
  return candidate;
}

function requiredSafePositiveInteger(
  value: Record<string, unknown>,
  key: string,
  label: string,
  max = Number.MAX_SAFE_INTEGER
): number {
  const candidate = value[key];
  if (
    typeof candidate !== "number" ||
    !Number.isSafeInteger(candidate) ||
    candidate < 1 ||
    candidate > max
  ) {
    invalid(label);
  }
  return candidate;
}

function requiredAssetId(value: Record<string, unknown>): string {
  const assetId = requiredString(value, "asset_id", "upload response");
  if (!ASSET_ID_PATTERN.test(assetId)) invalid("upload response");
  return assetId;
}

function decodeUploadSession(value: unknown): UploadSession {
  if (!isRecord(value)) invalid("upload response");
  if (value.protocol !== RESUMABLE_UPLOAD_PROTOCOL) invalid("upload response");
  const assetId = requiredAssetId(value);
  const status = requiredString(value, "status", "upload response");
  if (status !== "uploading" && status !== "completed") {
    invalid("upload response");
  }
  const uploadUrl = requiredUploadURL(value, assetId, "upload response");
  const capabilityExpiresAt = requiredTimestamp(
    value,
    "capability_expires_at",
    "upload response"
  );
  const sessionExpiresAt = requiredTimestamp(
    value,
    "session_expires_at",
    "upload response"
  );
  return {
    protocol: RESUMABLE_UPLOAD_PROTOCOL,
    asset_id: assetId,
    status,
    part_size_bytes: requiredSafePositiveInteger(
      value,
      "part_size_bytes",
      "upload response",
      RESUMABLE_UPLOAD_MAX_BYTES
    ),
    part_count: requiredSafePositiveInteger(
      value,
      "part_count",
      "upload response",
      RESUMABLE_UPLOAD_MAX_PART_COUNT
    ),
    max_parallel_parts: requiredSafePositiveInteger(
      value,
      "max_parallel_parts",
      "upload response",
      RESUMABLE_UPLOAD_MAX_PARALLEL_PARTS
    ),
    upload_url: uploadUrl,
    capability: requiredString(value, "capability", "upload response"),
    capability_expires_at: capabilityExpiresAt,
    session_expires_at: sessionExpiresAt,
  };
}

function requiredTimestamp(
  value: Record<string, unknown>,
  key: string,
  label: string
): string {
  const candidate = requiredString(value, key, label);
  if (!Number.isFinite(Date.parse(candidate))) invalid(label);
  return candidate;
}

function requiredUploadURL(
  value: Record<string, unknown>,
  assetId: string,
  label: string
): string {
  const candidate = requiredString(value, "upload_url", label);
  try {
    const parsed = new URL(candidate);
    if (
      (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.search !== "" ||
      parsed.hash !== "" ||
      parsed.pathname !== `/v1/files/${assetId}`
    ) {
      invalid(label);
    }
  } catch {
    invalid(label);
  }
  return candidate;
}

function decodeUploadCapabilityRenewal(
  value: unknown
): UploadCapabilityRenewal {
  if (!isRecord(value)) invalid("upload renewal response");
  if (value.protocol !== RESUMABLE_UPLOAD_PROTOCOL) {
    invalid("upload renewal response");
  }
  const assetId = requiredAssetId(value);
  const status = requiredString(value, "status", "upload renewal response");
  if (status !== "uploading" && status !== "completed") {
    invalid("upload renewal response");
  }
  return {
    protocol: RESUMABLE_UPLOAD_PROTOCOL,
    asset_id: assetId,
    status,
    upload_url: requiredUploadURL(value, assetId, "upload renewal response"),
    capability: requiredString(value, "capability", "upload renewal response"),
    capability_expires_at: requiredTimestamp(
      value,
      "capability_expires_at",
      "upload renewal response"
    ),
    session_expires_at: requiredTimestamp(
      value,
      "session_expires_at",
      "upload renewal response"
    ),
  };
}

export function createUpload(
  metadata: UploadCreateMetadata,
  idempotencyKey: string
): Promise<ApiEnvelope<UploadSession>> {
  if (idempotencyKey.trim().length === 0) {
    throw new TypeError("Invalid upload idempotency key");
  }
  return requestApi(
    {
      url: "/api/v1/files",
      method: "post",
      data: metadata,
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
    },
    decodeUploadSession
  );
}

export function renewUploadCapability(
  assetId: string
): Promise<ApiEnvelope<UploadCapabilityRenewal>> {
  if (!ASSET_ID_PATTERN.test(assetId)) {
    throw new TypeError("Invalid upload asset id");
  }
  return requestApi(
    {
      url: `/api/v1/files/${encodeURIComponent(assetId)}/capability`,
      method: "post",
    },
    decodeUploadCapabilityRenewal
  );
}
