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
import {
  decodeQueryData,
  getReactionType,
  getUserTool,
  type QueryData,
} from "@/api/chat";
import { decodeConversationContextNotice } from "@/api/types";
import { feedback } from "@/api/feedback";

const mockRequest = vi.mocked(request);

describe("getReactionType — wire contract", () => {
  beforeEach(() => {
    mockRequest.mockReset();
  });

  it("puts to /api/v1/conversations/:id/reaction with the supplied payload", async () => {
    mockRequest.mockResolvedValueOnce({ code: 0, msg: "ok" });
    await getReactionType({ id: "abc", reaction_type: "dislike" });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({
      url: "/api/v1/conversations/abc/reaction",
      method: "put",
      data: { id: "abc", reaction_type: "dislike" },
    });
  });

  it("resolves with the backend payload on success", async () => {
    mockRequest.mockResolvedValueOnce({ code: 0, msg: "ok" });
    const result = await getReactionType({ id: "abc", reaction_type: "like" });
    expect(result).toEqual({ code: 0, msg: "ok" });
  });

  it("propagates errors from the underlying request without transformation", async () => {
    const err = new Error("Network error");
    mockRequest.mockRejectedValueOnce(err);
    await expect(
      getReactionType({ id: "abc", reaction_type: "like" })
    ).rejects.toBe(err);
  });
});

describe("QueryData — interop wire contract", () => {
  it("keeps the gateway provenance fields bounded and snake_case", () => {
    const data: QueryData = {
      tool_name: "InSilicoResearchAgent",
      interop: {
        mode: "auto",
        status: "delegated",
        target_id: "mcp-peer",
        kind: "mcp",
        code: "no_evidence",
      },
    };
    expect(data.interop?.target_id).toBe("mcp-peer");
  });

  it("accepts follow-up questions as either JSON text or a string array", () => {
    expect(
      decodeQueryData({
        id: 1,
        follow_up_questions: '["one", "two"]',
      }).follow_up_questions
    ).toBe('["one", "two"]');
    expect(
      decodeQueryData({
        id: 2,
        follow_up_questions: ["one", "two"],
      }).follow_up_questions
    ).toEqual(["one", "two"]);
  });

  it("preserves numeric wire IDs and nullable Bot run IDs", () => {
    const result = decodeQueryData({ id: 41, bot_run_id: null });

    expect(result.id).toBe("41");
    expect(result.bot_run_id).toBeNull();
  });

  it("rejects missing IDs and malformed follow-up values without echoing them", () => {
    expect(() => decodeQueryData({ answer: "missing id" })).toThrow(
      "Invalid chat response"
    );
    expect(() =>
      decodeQueryData({
        id: 3,
        follow_up_questions: { token: "secret-token" },
      })
    ).toThrow("Invalid chat response");
  });

  it("accepts only boolean context notice fields", () => {
    expect(
      decodeConversationContextNotice({
        context_rebuilt: true,
        context_degraded: false,
      })
    ).toEqual({ context_rebuilt: true, context_degraded: false });

    for (const key of ["context_rebuilt", "context_degraded"] as const) {
      for (const value of ["true", 1, [], {}]) {
        expect(
          decodeConversationContextNotice({ [key]: value })
        ).toBeUndefined();
      }
    }
  });

  it("keeps a successful answer when the context notice is malformed", () => {
    const result = decodeQueryData({
      id: 5,
      answer: "saved answer",
      context_degraded: "true",
      context_version: "internal-v9",
      context_summary: "private summary",
    });

    expect(result.answer).toBe("saved answer");
    expect(result.context_degraded).toBeUndefined();
    expect("context_version" in result).toBe(false);
    expect("context_summary" in result).toBe(false);
  });
});

// Regression guard: these two wrappers were missed in the first sweep of the
// /api/v1 migration and kept calling deleted /v1 paths. Pin their new paths so a
// future revert fails here (the build/type-check cannot catch a wrong URL string).
describe("getUserTool — wire contract", () => {
  beforeEach(() => {
    mockRequest.mockReset();
  });

  it("gets /api/v1/users/me/tool-permissions", async () => {
    mockRequest.mockResolvedValueOnce({ code: 0 });
    await getUserTool();
    expect(request).toHaveBeenCalledWith({
      url: "/api/v1/users/me/tool-permissions",
      method: "get",
    });
  });
});

describe("feedback — wire contract", () => {
  beforeEach(() => {
    mockRequest.mockReset();
  });

  it("posts to /api/v1/user-feedback with the supplied payload", async () => {
    mockRequest.mockResolvedValueOnce({ code: 0 });
    const data = { feedback_type: "bug", feedback_content: "x" };
    await feedback(data);
    expect(request).toHaveBeenCalledWith({
      url: "/api/v1/user-feedback",
      method: "post",
      data,
    });
  });
});
