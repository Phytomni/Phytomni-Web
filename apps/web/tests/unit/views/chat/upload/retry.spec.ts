import { describe, expect, it, vi } from "vitest";

import {
  isPermanentUploadError,
  isRecreateRequiredError,
  isRetryablePartError,
  needsCapabilityRenewal,
  retryDelayMs,
  uploadErrorShape,
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

  it("classifies Axios-like control errors without projecting provider details", () => {
    const axiosError = (status: unknown) => ({
      message: "private provider message",
      response: {
        status,
        data: {
          code: "private_provider_code",
          message: "private provider detail",
        },
      },
    });

    expect(isRecreateRequiredError(axiosError(409))).toBe(true);
    expect(isPermanentUploadError(axiosError(410))).toBe(true);
    expect(isPermanentUploadError(axiosError(413))).toBe(true);
    expect(needsCapabilityRenewal(axiosError(401))).toBe(true);
    expect(uploadErrorShape(axiosError(409))).toEqual({
      status: 409,
      code: undefined,
      retryAfterSeconds: undefined,
    });

    for (const status of [NaN, Infinity, -Infinity, "409", null]) {
      const error = axiosError(status);
      expect(isRecreateRequiredError(error)).toBe(false);
      expect(isPermanentUploadError(error)).toBe(false);
      expect(needsCapabilityRenewal(error)).toBe(false);
      expect(isRetryablePartError(error)).toBe(true);
      expect(uploadErrorShape(error)).toEqual({
        status: undefined,
        code: undefined,
        retryAfterSeconds: undefined,
      });
    }
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
