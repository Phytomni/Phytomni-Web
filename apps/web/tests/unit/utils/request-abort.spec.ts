import { describe, it, expect, vi } from "vitest";

vi.mock("@/utils/auth", () => ({ getToken: () => "tok" }));

import {
  abortAllRequests,
  abortRequest,
  registerAbortController,
} from "@/utils/request";

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
});
