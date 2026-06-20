import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock factory must expose `default` because src/api/chat.ts imports as
// `import request from "@/utils/request"`. Named side-exports
// (createAbortableRequest etc.) are preserved as no-ops so unrelated
// imports inside src/api/chat.ts do not crash module init.
vi.mock("@/utils/request", () => ({
  default: vi.fn(),
  createAbortableRequest: vi.fn(),
  abortRequest: vi.fn(),
  abortAllRequests: vi.fn(),
  download: vi.fn(),
  isRelogin: { show: false },
}));

import request from "@/utils/request";
import { getReactionType } from "@/api/chat";

describe("getReactionType — wire contract", () => {
  beforeEach(() => {
    (request as any).mockReset();
  });

  it("puts to /api/v1/conversations/:id/reaction with the supplied payload", async () => {
    (request as any).mockResolvedValueOnce({ code: 0, msg: "ok" });
    await getReactionType({ id: "abc", reaction_type: "dislike" });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({
      url: "/api/v1/conversations/abc/reaction",
      method: "put",
      data: { id: "abc", reaction_type: "dislike" },
    });
  });

  it("resolves with the backend payload on success", async () => {
    (request as any).mockResolvedValueOnce({ code: 0, msg: "ok" });
    const result = await getReactionType({ id: "abc", reaction_type: "like" });
    expect(result).toEqual({ code: 0, msg: "ok" });
  });

  it("propagates errors from the underlying request without transformation", async () => {
    const err = new Error("Network error");
    (request as any).mockRejectedValueOnce(err);
    await expect(
      getReactionType({ id: "abc", reaction_type: "like" })
    ).rejects.toBe(err);
  });
});
