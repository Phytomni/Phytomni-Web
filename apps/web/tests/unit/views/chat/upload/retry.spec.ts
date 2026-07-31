import { describe, expect, it, vi } from "vitest";

import {
  isPermanentUploadError,
  isRecreateRequiredError,
  isRetryablePartError,
  needsCapabilityRenewal,
  retryDelayMs,
  waitForRetry,
} from "@/views/chat/upload/retry";
import { UploadTransportError } from "@/views/chat/upload/transport";

describe("resumable upload retry policy", () => {
  it("classifies stable server outcomes", () => {
    expect(
      needsCapabilityRenewal(new UploadTransportError("", { status: 401 }))
    ).toBe(true);
    expect(
      isRetryablePartError(new UploadTransportError("", { status: 422 }))
    ).toBe(true);
    expect(
      isRetryablePartError(new UploadTransportError("", { status: 503 }))
    ).toBe(true);
    expect(
      isRecreateRequiredError(new UploadTransportError("", { status: 409 }))
    ).toBe(true);
    expect(
      isPermanentUploadError(new UploadTransportError("", { status: 410 }))
    ).toBe(true);
    expect(
      isPermanentUploadError(new UploadTransportError("", { status: 413 }))
    ).toBe(true);
  });

  it("honors Retry-After and bounds exponential jitter", () => {
    expect(
      retryDelayMs(1, () => 0, { status: 429, retryAfterSeconds: 7 })
    ).toBe(7_000);
    expect(retryDelayMs(20, () => 1)).toBe(30_000);
    expect(retryDelayMs(1, () => 0)).toBe(500);
  });

  it("does not wait or invoke callbacks after cancellation", async () => {
    const wait = vi.fn(async () => undefined);
    const controller = new AbortController();
    controller.abort();

    await waitForRetry(500, controller.signal, wait);
    expect(wait).not.toHaveBeenCalled();
  });
});
