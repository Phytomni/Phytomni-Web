import { UploadTransportError } from "@/views/chat/upload/transport";

export interface RetryErrorShape {
  status?: number;
  code?: string;
  retryAfterSeconds?: number | null;
}

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_UPLOAD_RETRY_POLICY: RetryPolicy = Object.freeze({
  maxAttempts: 5,
  baseDelayMs: 500,
  maxDelayMs: 30_000,
});

export function uploadErrorShape(error: unknown): RetryErrorShape {
  if (error instanceof UploadTransportError) {
    return {
      status: error.status ?? undefined,
      code: error.code,
      retryAfterSeconds: error.retryAfterSeconds,
    };
  }
  if (typeof error !== "object" || error === null || Array.isArray(error)) {
    return {};
  }
  const record = error as Record<string, unknown>;
  return {
    status:
      typeof record.status === "number" && Number.isFinite(record.status)
        ? record.status
        : undefined,
    code: typeof record.code === "string" ? record.code : undefined,
    retryAfterSeconds:
      typeof record.retryAfterSeconds === "number" &&
      Number.isFinite(record.retryAfterSeconds)
        ? record.retryAfterSeconds
        : undefined,
  };
}

export function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

export function needsCapabilityRenewal(error: unknown): boolean {
  return uploadErrorShape(error).status === 401;
}

export function isRetryablePartError(error: unknown): boolean {
  if (isAbortError(error)) return false;
  const { status, code } = uploadErrorShape(error);
  if (status === 422 || status === 429 || status === 502 || status === 503) {
    return true;
  }
  if (status !== undefined) return false;
  return code === undefined || code === "upload_transport_error";
}

export function isRecreateRequiredError(error: unknown): boolean {
  const { status } = uploadErrorShape(error);
  return status === 409;
}

export function isPermanentUploadError(error: unknown): boolean {
  const { status } = uploadErrorShape(error);
  return status === 410 || status === 413;
}

export function retryDelayMs(
  attempt: number,
  random: () => number,
  error?: unknown,
  policy: RetryPolicy = DEFAULT_UPLOAD_RETRY_POLICY
): number {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  const retryAfter = uploadErrorShape(error).retryAfterSeconds;
  if (
    typeof retryAfter === "number" &&
    Number.isFinite(retryAfter) &&
    retryAfter >= 0
  ) {
    return Math.min(policy.maxDelayMs, retryAfter * 1000);
  }
  const exponential = Math.min(
    policy.maxDelayMs,
    policy.baseDelayMs * 2 ** (safeAttempt - 1)
  );
  const jitter =
    Math.max(0, Math.min(1, random())) * Math.min(250, exponential);
  return Math.min(policy.maxDelayMs, Math.round(exponential + jitter));
}

export async function waitForRetry(
  delayMs: number,
  signal: AbortSignal | undefined,
  wait: (delayMs: number) => Promise<void> = (delay) =>
    new Promise((resolve) => setTimeout(resolve, delay))
): Promise<void> {
  if (signal?.aborted) return;
  await wait(Math.max(0, delayMs));
  if (signal?.aborted) return;
}
