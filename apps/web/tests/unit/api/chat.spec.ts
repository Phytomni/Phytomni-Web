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
import { getReactionType, getUserTool } from "@/api/chat";
import { feedback } from "@/api/feedback";

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

// Regression guard: these two wrappers were missed in the first sweep of the
// /api/v1 migration and kept calling deleted /v1 paths. Pin their new paths so a
// future revert fails here (the build/type-check cannot catch a wrong URL string).
describe("getUserTool — wire contract", () => {
  beforeEach(() => {
    (request as any).mockReset();
  });

  it("gets /api/v1/users/me/tool-permissions", async () => {
    (request as any).mockResolvedValueOnce({ code: 0 });
    await getUserTool();
    expect(request).toHaveBeenCalledWith({
      url: "/api/v1/users/me/tool-permissions",
      method: "get",
    });
  });
});

describe("feedback — wire contract", () => {
  beforeEach(() => {
    (request as any).mockReset();
  });

  it("posts to /api/v1/user-feedback with the supplied payload", async () => {
    (request as any).mockResolvedValueOnce({ code: 0 });
    const data = { feedback_type: "bug", feedback_content: "x" };
    await feedback(data);
    expect(request).toHaveBeenCalledWith({
      url: "/api/v1/user-feedback",
      method: "post",
      data,
    });
  });
});
