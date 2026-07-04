import { describe, it, expect, vi } from "vitest";

vi.mock("@/utils/auth", () => ({ getToken: () => "tok" }));

import { registerAbortController, abortRequest } from "@/utils/request";

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
});
