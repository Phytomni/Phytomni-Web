import { afterEach, describe, it, expect, vi } from "vitest";
import type { AxiosInstance } from "axios";

vi.mock("@/utils/auth", () => ({ getToken: () => "tok" }));

import {
  abortAllRequests,
  abortRequest,
  createAbortableRequest,
  registerAbortController,
} from "@/utils/request";
import request from "@/utils/request";

const service = request as unknown as AxiosInstance;
const originalAdapter = service.defaults.adapter;

afterEach(() => {
  service.defaults.adapter = originalAdapter;
});

describe("registerAbortController", () => {
  it("makes abortRequest(id) abort a fetch-path controller", () => {
    const controller = new AbortController();
    const onAbort = vi.fn();
    controller.signal.addEventListener("abort", onAbort);
    registerAbortController("req-1", controller);
    const ok = abortRequest("req-1");
    expect(ok).toBe(true);
    expect(controller.signal.aborted).toBe(true);
    expect(onAbort).toHaveBeenCalled();
  });

  it("returns false for an unknown id", () => {
    expect(abortRequest("nope")).toBe(false);
  });

  it("aborts every registered stream controller and clears the registry", () => {
    const first = new AbortController();
    const second = new AbortController();
    registerAbortController("stream-1", first);
    registerAbortController("stream-2", second);

    abortAllRequests();

    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(true);
    expect(abortRequest("stream-1")).toBe(false);
    expect(abortRequest("stream-2")).toBe(false);
  });

  it("cleans an abortable request controller after the unwrapped response settles", async () => {
    service.defaults.adapter = async (config) => ({
      data: { code: 200, data: { ok: true } },
      status: 200,
      statusText: "OK",
      headers: {},
      config,
      request: { responseType: "" },
    });

    await expect(
      createAbortableRequest<{ code: number; data: { ok: boolean } }>({
        url: "/api/v1/probe",
        method: "get",
        requestId: "abortable-1",
      })
    ).resolves.toEqual({ code: 200, data: { ok: true } });
    expect(abortRequest("abortable-1")).toBe(false);
  });
});
