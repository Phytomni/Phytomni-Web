import type { ApiEnvelope } from "@/api/types";
import { requestApi } from "@/api/types";
import { isRecord } from "@/api/contracts";

export const RESUMABLE_UPLOAD_PROTOCOL = "obs-multipart-v2";

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
  label: string
): number {
  const candidate = value[key];
  if (
    typeof candidate !== "number" ||
    !Number.isSafeInteger(candidate) ||
    candidate < 1
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
  return {
    protocol: RESUMABLE_UPLOAD_PROTOCOL,
    asset_id: requiredAssetId(value),
    status: requiredString(value, "status", "upload response"),
    part_size_bytes: requiredSafePositiveInteger(
      value,
      "part_size_bytes",
      "upload response"
    ),
    part_count: requiredSafePositiveInteger(
      value,
      "part_count",
      "upload response"
    ),
    max_parallel_parts: requiredSafePositiveInteger(
      value,
      "max_parallel_parts",
      "upload response"
    ),
    upload_url: requiredString(value, "upload_url", "upload response"),
    capability: requiredString(value, "capability", "upload response"),
    capability_expires_at: requiredString(
      value,
      "capability_expires_at",
      "upload response"
    ),
    session_expires_at: requiredString(
      value,
      "session_expires_at",
      "upload response"
    ),
  };
}

function decodeUploadCapabilityRenewal(
  value: unknown
): UploadCapabilityRenewal {
  if (!isRecord(value)) invalid("upload renewal response");
  if (value.protocol !== RESUMABLE_UPLOAD_PROTOCOL) {
    invalid("upload renewal response");
  }
  return {
    protocol: RESUMABLE_UPLOAD_PROTOCOL,
    asset_id: requiredAssetId(value),
    status: requiredString(value, "status", "upload renewal response"),
    upload_url: requiredString(value, "upload_url", "upload renewal response"),
    capability: requiredString(value, "capability", "upload renewal response"),
    capability_expires_at: requiredString(
      value,
      "capability_expires_at",
      "upload renewal response"
    ),
    session_expires_at: requiredString(
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
