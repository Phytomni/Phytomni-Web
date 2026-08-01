import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/utils/request", () => ({ default: vi.fn() }));

import request from "@/utils/request";
import { CANONICAL_AGENT_TOOLS } from "@/constants/agents";
import {
  BOT_CAPABILITIES_URL,
  MAX_BOT_CAPABILITIES,
  MAX_BOT_CAPABILITY_CACHE_ENTRIES,
  clearBotCapabilitiesCache,
  useBotCapabilities,
} from "@/views/chat/composables/useBotCapabilities";

const mockRequest = vi.mocked(request);

const slugByTool: Record<string, string> = {
  ChatAgent: "chat",
  KnowledgeAgent: "knowledge",
  DataAgent: "data",
  ReviewAgent: "review",
  BriefGeneAgent: "brief_gene",
  AnalystAgent: "analyst",
  DeepGenomeAgent: "deep_genome",
  InSilicoResearchAgent: "research",
  DigitalDesignAgent: "design",
  GeneNetworkAgent: "network",
};

const executionByTool: Record<string, string> = {
  ChatAgent: "chat",
  KnowledgeAgent: "chat",
  DataAgent: "blocking",
  ReviewAgent: "chat",
  BriefGeneAgent: "agent_run",
  AnalystAgent: "agent_run",
  DeepGenomeAgent: "agent_run",
  InSilicoResearchAgent: "agent_run",
  DigitalDesignAgent: "agent_run",
  GeneNetworkAgent: "agent_run",
};

function record(tool: string, enabled = true) {
  return {
    tool,
    slug: slugByTool[tool],
    execution: executionByTool[tool],
    stream: tool === "ChatAgent",
    a2ui: false,
    resolver: false,
    attachments: enabled,
    artifacts: false,
    enabled,
    upstream_private_field: "must-not-be-copied",
  };
}

function uploadRecord(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    protocol: "obs-multipart-v2",
    upload_origin: "https://upload.example",
    max_file_bytes: 10 * 1024 * 1024 * 1024,
    max_attachments: 10,
    ...overrides,
  };
}

function manifestPayload(
  agents: unknown[],
  upload: Record<string, unknown> = uploadRecord()
) {
  return { code: 200, data: { agents, upload } };
}

describe("useBotCapabilities", () => {
  beforeEach(() => {
    mockRequest.mockReset();
    clearBotCapabilitiesCache();
  });

  it("maps a valid Web response by tool and strips upstream fields", async () => {
    mockRequest.mockResolvedValueOnce({
      ...manifestPayload([record("ChatAgent"), record("AnalystAgent", false)]),
    });

    const state = useBotCapabilities("dialogue-1");
    await state.load();

    expect(state.byTool.value.ChatAgent).toMatchObject({
      tool: "ChatAgent",
      slug: "chat",
      enabled: true,
      stream: true,
    });
    expect(state.bySlug.value.chat?.tool).toBe("ChatAgent");
    expect(state.byTool.value.ChatAgent).not.toHaveProperty(
      "upstream_private_field"
    );
    expect(state.byTool.value.AnalystAgent?.enabled).toBe(false);
    expect(state.upload.value).toEqual(uploadRecord());
    expect(mockRequest).toHaveBeenCalledWith({
      url: BOT_CAPABILITIES_URL,
      method: "get",
    });
  });

  it("keeps absent, malformed, and unknown records disabled", async () => {
    mockRequest.mockResolvedValueOnce({
      ...manifestPayload([
        record("ChatAgent"),
        { ...record("KnowledgeAgent"), slug: "wrong" },
        { tool: "UnknownAgent", slug: "unknown", enabled: true },
      ]),
    });

    const state = useBotCapabilities({ cacheKey: "malformed" });
    await state.load();

    expect(state.byTool.value.ChatAgent?.enabled).toBe(true);
    expect(state.byTool.value.KnowledgeAgent?.enabled).toBe(false);
    expect(state.byTool.value.AnalystAgent?.enabled).toBe(false);
    expect(state.capabilities.value).toHaveLength(CANONICAL_AGENT_TOOLS.length);
    expect(
      state.capabilities.value.every((item) => item.tool !== "UnknownAgent")
    ).toBe(true);
  });

  it("rejects oversized manifests instead of widening the DTO", async () => {
    mockRequest.mockResolvedValueOnce({
      ...manifestPayload(
        Array.from({ length: MAX_BOT_CAPABILITIES + 1 }, () =>
          record("ChatAgent")
        )
      ),
    });

    const state = useBotCapabilities("oversized");
    await state.load();

    expect(state.capabilities.value.every((item) => !item.enabled)).toBe(true);
  });

  it.each([
    ["401", { code: 401, data: manifestPayload([record("ChatAgent")]).data }],
    ["404", { code: 404, data: manifestPayload([record("ChatAgent")]).data }],
  ])("returns disabled defaults for HTTP %s", async (_name, response) => {
    mockRequest.mockResolvedValueOnce(response);

    const state = useBotCapabilities(`http-${_name}`);
    await state.load();

    expect(state.capabilities.value.every((item) => !item.enabled)).toBe(true);
  });

  it.each(["timeout", "network"])(
    "returns disabled defaults for %s failures",
    async (kind) => {
      mockRequest.mockRejectedValueOnce(new Error(kind));

      const state = useBotCapabilities(`failure-${kind}`);
      const items = await state.load();
      expect(items.every((item) => !item.enabled)).toBe(true);
    }
  );

  it("bounds per-caller cache entries and avoids repeated requests", async () => {
    mockRequest.mockImplementation(async () => ({
      ...manifestPayload([record("ChatAgent")]),
    }));

    for (let index = 0; index < MAX_BOT_CAPABILITY_CACHE_ENTRIES; index += 1) {
      await useBotCapabilities(`caller-${index}`).load();
    }
    expect(mockRequest).toHaveBeenCalledTimes(MAX_BOT_CAPABILITY_CACHE_ENTRIES);

    await useBotCapabilities("caller-overflow").load();
    await useBotCapabilities("caller-0").load();
    expect(mockRequest).toHaveBeenCalledTimes(
      MAX_BOT_CAPABILITY_CACHE_ENTRIES + 2
    );
  });

  it("decodes upload capability independently from Agent availability", async () => {
    mockRequest.mockResolvedValueOnce(
      manifestPayload([record("ChatAgent")], uploadRecord())
    );

    const state = useBotCapabilities("upload-valid");
    await state.load();

    expect(state.byTool.value.ChatAgent?.enabled).toBe(true);
    expect(state.upload.value.enabled).toBe(true);
    expect(state.upload.value.upload_origin).toBe("https://upload.example");
  });

  it.each([
    ["missing upload", null],
    ["wrong protocol", uploadRecord({ protocol: "other" })],
    [
      "invalid origin",
      uploadRecord({ upload_origin: "https://upload.example/path" }),
    ],
    [
      "invalid limit",
      uploadRecord({ max_file_bytes: Number.MAX_SAFE_INTEGER + 1 }),
    ],
  ])(
    "disables malformed upload fields without disabling valid Agents (%s)",
    async (_name, upload) => {
      mockRequest.mockResolvedValueOnce(
        manifestPayload(
          [record("ChatAgent")],
          upload as Record<string, unknown>
        )
      );

      const state = useBotCapabilities(`upload-invalid-${_name}`);
      await state.load();

      expect(state.byTool.value.ChatAgent?.enabled).toBe(true);
      expect(state.upload.value.enabled).toBe(false);
      expect(state.upload.value.upload_origin).toBe("");
      expect(state.byTool.value.ChatAgent?.attachments).toBe(false);
    }
  );

  it("disables Agent attachments when the upload capability is disabled", async () => {
    mockRequest.mockResolvedValueOnce(
      manifestPayload(
        [record("ChatAgent"), record("AnalystAgent")],
        uploadRecord({ enabled: false, upload_origin: "" })
      )
    );

    const state = useBotCapabilities("upload-disabled-attachments");
    await state.load();

    expect(state.upload.value.enabled).toBe(false);
    expect(state.byTool.value.ChatAgent?.enabled).toBe(true);
    expect(state.byTool.value.ChatAgent?.attachments).toBe(false);
    expect(state.byTool.value.AnalystAgent?.attachments).toBe(false);
  });

  it("rejects the legacy bare Agent array instead of treating it as a capability manifest", async () => {
    mockRequest.mockResolvedValueOnce({
      code: 200,
      data: [record("ChatAgent")],
    });

    const state = useBotCapabilities("legacy-array");
    await state.load();

    expect(state.capabilities.value.every((item) => !item.enabled)).toBe(true);
    expect(state.upload.value.enabled).toBe(false);
  });
});
