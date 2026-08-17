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

import request, { createAbortableRequest } from "@/utils/request";
import {
  decodeQueryData,
  getChatdownloadURL,
  getObsImages,
  getConversationArtifactDownloadURL,
  getConversationArtifactFile,
  getAnalystAgentLog,
  getQuery,
  getQueryAbortable,
  getReactionType,
  retryConversationResultArchive,
  runAgentProductAbortable,
  getUserTool,
  type QueryData,
} from "@/api/chat";
import { decodeConversationContextNotice } from "@/api/types";
import { feedback } from "@/api/feedback";

const mockRequest = vi.mocked(request);
const mockCreateAbortableRequest = vi.mocked(createAbortableRequest);

describe("query routing intent transport", () => {
  beforeEach(() => {
    mockRequest.mockReset();
    mockCreateAbortableRequest.mockReset();
  });

  it.each([
    ["blocking", getQuery, mockRequest],
    ["abortable", getQueryAbortable, mockCreateAbortableRequest],
  ] as const)(
    "emits the finite Research intent header for explicit FormData on %s requests",
    async (_name, send, transport) => {
      transport.mockResolvedValueOnce({ code: 200, data: { id: 1 } });
      const data = new FormData();
      data.set("id", "0");
      data.set("query", "research question");
      data.set("mode", "expert");
      data.set("tool", "InSilicoResearchAgent");
      data.set("client_turn_id", "research-client-turn");

      await send(data);

      expect(transport).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: {
            "X-Phyto-Research-Intent": "expert-research-v1",
            "X-Phyto-Client-Turn-Id": "research-client-turn",
          },
        })
      );
    }
  );

  it.each([
    ["blocking", getQuery, mockRequest],
    ["abortable", getQueryAbortable, mockCreateAbortableRequest],
  ] as const)(
    "emits the client-turn header for keyed %s requests",
    async (_name, send, transport) => {
      transport.mockResolvedValueOnce({ code: 200, data: { id: 1 } });
      const data = new FormData();
      data.set("query", "ordinary keyed question");
      data.set("client_turn_id", "ordinary-client-turn");

      await send(data);

      expect(transport).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: {
            "X-Phyto-Client-Turn-Id": "ordinary-client-turn",
          },
        })
      );
    }
  );

  it("emits the client-turn header for dedicated product requests", async () => {
    mockCreateAbortableRequest.mockResolvedValueOnce({
      code: 200,
      data: { id: 1 },
    });
    const data = new FormData();
    data.set("query", "dedicated Research question");
    data.set("client_turn_id", "dedicated-client-turn");

    await runAgentProductAbortable(
      "InSilicoResearchAgent",
      data,
      "dedicated-request"
    );

    expect(mockCreateAbortableRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: {
          "X-Phyto-Client-Turn-Id": "dedicated-client-turn",
        },
      })
    );
  });

  it.each([
    ["autonomous Expert", "expert", ""],
    ["another Expert tool", "expert", "DataAgent"],
    ["invalid Instant tool hint", "instant", "InSilicoResearchAgent"],
  ])(
    "does not emit the Research intent header for %s",
    async (_name, mode, tool) => {
      mockRequest.mockResolvedValueOnce({ code: 200, data: { id: 1 } });
      const data = new FormData();
      data.set("query", "question");
      data.set("mode", mode);
      if (tool) data.set("tool", tool);

      await getQuery(data);

      expect(mockRequest).toHaveBeenCalledWith(
        expect.not.objectContaining({ headers: expect.anything() })
      );
    }
  );

  it("does not derive the pre-body signal from a JSON-shaped request", async () => {
    mockRequest.mockResolvedValueOnce({ code: 200, data: { id: 1 } });

    await getQuery({
      query: "research question",
      mode: "expert",
      tool: "InSilicoResearchAgent",
    });

    expect(mockRequest).toHaveBeenCalledWith(
      expect.not.objectContaining({ headers: expect.anything() })
    );
  });
});

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

describe("retryConversationResultArchive — wire contract", () => {
  const delivery = {
    schema_version: 1,
    required: true,
    status: "pending",
    revision: 2,
    name: null,
    size_bytes: null,
    error_code: null,
    retryable: false,
  } as const;

  beforeEach(() => {
    mockRequest.mockReset();
  });

  it("posts to the encoded retry path and decodes the delivery envelope", async () => {
    mockRequest.mockResolvedValueOnce({ code: 200, data: delivery });

    await expect(
      retryConversationResultArchive({
        dialogue_id: "dialogue/1",
        message_id: "message 2",
      })
    ).resolves.toEqual({ code: 200, data: delivery });
    expect(mockRequest).toHaveBeenCalledWith({
      url: "/api/v1/conversations/dialogue%2F1/messages/message%202/artifacts/archive/retry",
      method: "post",
    });
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

  it("keeps a public Expert route reason on the query payload", () => {
    const result = decodeQueryData({
      id: 9,
      answer: "saved",
      tool_name: "ChatAgent",
      route_reason_code: "CHAT_FALLBACK",
    });

    expect(result.route_reason_code).toBe("CHAT_FALLBACK");
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

describe("QueryData — conversation artifact contract", () => {
  const relayURL = "/api/v1/downloads/relay-file?token=signed-token";
  const artifact = {
    id: "artifact-1",
    name: "report.pdf",
    kind: "report",
  };

  beforeEach(() => {
    mockRequest.mockReset();
    mockCreateAbortableRequest.mockReset();
  });

  it("resolves an artifact URL only through the authenticated identity endpoint", async () => {
    mockRequest.mockResolvedValueOnce({
      code: 200,
      data: relayURL,
    });

    await expect(
      getConversationArtifactDownloadURL({
        dialogue_id: "dialogue/1",
        message_id: "42",
        artifact_id: "opaque-id",
      })
    ).resolves.toEqual({ code: 200, data: relayURL });
    expect(mockRequest).toHaveBeenCalledWith({
      url: "/api/v1/conversations/dialogue%2F1/messages/42/artifacts/opaque-id/download-url",
      method: "get",
    });
  });

  it("accepts bounded relay links and exposes only public context booleans", () => {
    const result = decodeQueryData({
      id: 7,
      answer: "saved",
      artifacts: [artifact],
      context_rebuilt: true,
      context_degraded: true,
      context_version: 8,
      context_hash: "private-hash",
      assistant_summary: "private summary",
      permissions: ["private"],
      route_reasoning: "private",
    });

    expect(result.artifacts).toEqual([artifact]);
    expect(result.download_path).toBeUndefined();
    expect(result.context_rebuilt).toBe(true);
    expect(result.context_degraded).toBe(true);
    for (const key of [
      "context_version",
      "context_hash",
      "assistant_summary",
      "permissions",
      "route_reasoning",
    ]) {
      expect(result).not.toHaveProperty(key);
    }
  });

  it("accepts cif kind and optional media type without a durable URL", () => {
    const cif = {
      id: "structure-1",
      name: "fold.cif",
      kind: "cif",
      media_type: "chemical/x-cif",
    };
    const result = decodeQueryData({
      id: 9,
      answer: "saved",
      artifacts: [cif],
    });
    expect(result.artifacts).toEqual([cif]);
    expect(result.artifacts?.[0]).not.toHaveProperty("display_url");
    expect(result.artifacts?.[0]).not.toHaveProperty("download_url");
  });

  it.each([
    {
      name: "absolute URL",
      artifacts: [{ ...artifact, download_url: "https://evil.invalid/file" }],
    },
    {
      name: "display URL on the list DTO",
      artifacts: [
        {
          ...artifact,
          display_url: "/api/v1/downloads/relay-file?token=signed-token",
        },
      ],
    },
    {
      name: "legacy relay URL without canonical token",
      artifacts: [
        {
          ...artifact,
          download_url: "/api/v1/downloads/relay-file?t=signed-token",
        },
      ],
    },
    {
      name: "relay URL with a legacy token alias",
      artifacts: [
        {
          ...artifact,
          download_url: `${relayURL}&t=signed-token`,
        },
      ],
    },
    {
      name: "duplicate id",
      artifacts: [artifact, { ...artifact }],
    },
    {
      name: "unknown kind",
      artifacts: [{ ...artifact, kind: "dataset" }],
    },
    {
      name: "oversized name",
      artifacts: [{ ...artifact, name: "x".repeat(256) }],
    },
    {
      name: "oversized count",
      artifacts: Array.from({ length: 51 }, (_, index) => ({
        ...artifact,
        id: `artifact-${index}`,
      })),
    },
  ])("rejects $name", ({ artifacts }) => {
    expect(() => decodeQueryData({ id: 8, artifacts })).toThrow(
      "Invalid chat response"
    );
  });

  it("passes an already signed relay link through without calling email download", async () => {
    const result = await getChatdownloadURL({ obs_path: relayURL });

    expect(result).toEqual({ code: 200, data: relayURL });
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("downloads a canonical relay link through the abortable blob transport", async () => {
    const response = {
      data: new Blob(["report"]),
      headers: {},
    };
    mockCreateAbortableRequest.mockResolvedValueOnce(response);
    const onDownloadProgress = vi.fn();

    await expect(
      getConversationArtifactFile(relayURL, {
        requestId: "artifact-request",
        onDownloadProgress,
      })
    ).resolves.toBe(response);

    expect(mockCreateAbortableRequest).toHaveBeenCalledWith({
      url: relayURL,
      method: "get",
      responseType: "blob",
      requestId: "artifact-request",
      onDownloadProgress,
    });
    expect(() =>
      getConversationArtifactFile("https://evil.invalid/report.pdf")
    ).toThrow("Invalid conversation artifact download URL");
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

describe("getAnalystAgentLog — wire contract", () => {
  beforeEach(() => {
    mockRequest.mockReset();
  });

  it("gets a validated owner-scoped task log", async () => {
    const data = {
      state: "AVAILABLE",
      source: "LEGACY_TASK",
      text: "safe log",
      revision: 0,
      truncated: false,
      can_request_legacy_refresh: false,
      error_code: null,
    };
    mockRequest.mockResolvedValueOnce({ code: 200, data });

    await expect(getAnalystAgentLog({ id: "42" })).resolves.toEqual({
      code: 200,
      data,
    });
    expect(mockRequest).toHaveBeenCalledWith({
      url: "/api/v1/async-tasks/42/analyst-log",
      method: "get",
    });
  });

  it.each(["", "0", "-1", "1.5", "bot-run", "9007199254740992"])(
    "rejects invalid local task ID %s before Axios",
    (id) => {
      expect(() => getAnalystAgentLog({ id })).toThrow("Invalid task row ID");
      expect(mockRequest).not.toHaveBeenCalled();
    }
  );
});

describe("getObsImages", () => {
  beforeEach(() => {
    mockRequest.mockReset();
  });

  it("does not toast when the gallery endpoint is empty or unservable", async () => {
    mockRequest.mockResolvedValueOnce({ code: 200, data: [] });

    await getObsImages({
      obs_path: "/obs/phytomni/agent_data/test/output/children/part-001",
    });

    expect(mockRequest).toHaveBeenCalledWith({
      url: "/api/v1/downloads/analyst-agent/obs-images",
      method: "get",
      params: {
        obs_path: "/obs/phytomni/agent_data/test/output/children/part-001",
      },
      suppressErrorToast: true,
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
