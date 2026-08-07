import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/utils/request", () => ({ default: vi.fn() }));

import request from "@/utils/request";
import { CANONICAL_AGENT_TOOLS } from "@/constants/agents";
import {
  BOT_CAPABILITIES_URL,
  MAX_BOT_CAPABILITIES,
  MAX_BOT_CAPABILITY_CACHE_ENTRIES,
  type BotResearchInputCapability,
  clearBotCapabilitiesCache,
  disabledBotResearchInputCapability,
  parseCapabilityResponse,
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

function researchInputRecord(
  overrides: Record<string, unknown> = {}
): BotResearchInputCapability & Record<string, unknown> {
  return {
    enabled: true,
    protocol: "research_input_resolution_v1",
    max_user_query_chars: 131072,
    max_attachments_per_request: 64,
    max_research_dataset_paths: 64,
    max_research_input_references: 128,
    ...overrides,
  };
}

function manifestPayload(
  agents: unknown[],
  upload: Record<string, unknown> = uploadRecord(),
  researchInput: unknown = researchInputRecord()
) {
  return {
    code: 200,
    data: { agents, upload, research_input: researchInput },
  };
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

  it("decodes finite attachment channels", async () => {
    mockRequest.mockResolvedValueOnce(
      manifestPayload([
        {
          ...record("AnalystAgent"),
          attachment_purposes: ["dataset", "document"],
        },
      ])
    );

    const state = useBotCapabilities("attachment-purposes-valid");
    await state.load(true);

    expect(state.byTool.value.AnalystAgent?.attachmentChannels).toEqual([
      "dataset",
      "document",
    ]);
  });

  it.each([
    ["unknown", ["dataset", "binary"]],
    ["duplicate", ["dataset", "dataset"]],
    ["wrong type", "dataset"],
  ])(
    "fails closed for %s attachment purpose data",
    async (_name, attachmentPurposes) => {
      mockRequest.mockResolvedValueOnce(
        manifestPayload([
          {
            ...record("AnalystAgent"),
            attachment_purposes: attachmentPurposes,
          },
        ])
      );

      const state = useBotCapabilities(`attachment-purposes-${_name}`);
      await state.load(true);

      expect(state.byTool.value.AnalystAgent?.attachmentChannels).toEqual([]);
    }
  );

  it("clears attachment purposes for disabled attachments and Agents", async () => {
    mockRequest.mockResolvedValueOnce(
      manifestPayload([
        {
          ...record("ChatAgent"),
          attachments: false,
          attachment_purposes: ["document"],
        },
        {
          ...record("AnalystAgent", false),
          attachments: true,
          attachment_purposes: ["dataset"],
        },
      ])
    );

    const state = useBotCapabilities("attachment-purposes-disabled");
    await state.load(true);

    expect(state.byTool.value.ChatAgent?.attachmentChannels).toEqual([]);
    expect(state.byTool.value.AnalystAgent?.attachmentChannels).toEqual([]);
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

  it("clones attachment channel arrays across cache entries", async () => {
    mockRequest.mockResolvedValueOnce(
      manifestPayload([
        {
          ...record("AnalystAgent"),
          attachment_purposes: ["dataset"],
        },
      ])
    );

    const first = useBotCapabilities("attachment-purpose-cache");
    await first.load();
    first.byTool.value.AnalystAgent?.attachmentChannels.push("document");

    const second = useBotCapabilities("attachment-purpose-cache");
    await second.load();

    expect(second.byTool.value.AnalystAgent?.attachmentChannels).toEqual([
      "dataset",
    ]);
  });

  it("decodes the exact finite Research input projection", () => {
    const upstream = researchInputRecord({
      upstream_private_field: "must-not-be-copied",
    });

    const parsed = parseCapabilityResponse(
      manifestPayload(
        [record("InSilicoResearchAgent")],
        uploadRecord(),
        upstream
      )
    );

    const researchInput = parsed.researchInput;
    expect(researchInput).toEqual({
      enabled: true,
      protocol: "research_input_resolution_v1",
      max_user_query_chars: 131072,
      max_attachments_per_request: 64,
      max_research_dataset_paths: 64,
      max_research_input_references: 128,
    });
    expect(researchInput).not.toBe(upstream);
    expect(researchInput).not.toHaveProperty("upstream_private_field");
  });

  it.each([
    ["missing descriptor", null],
    [
      "missing field",
      { ...researchInputRecord(), max_user_query_chars: undefined },
    ],
    ["zero", researchInputRecord({ max_research_dataset_paths: 0 })],
    ["non-integer", researchInputRecord({ max_attachments_per_request: 63.5 })],
    [
      "query above hard ceiling",
      researchInputRecord({ max_user_query_chars: 1048577 }),
    ],
    [
      "attachments above hard ceiling",
      researchInputRecord({ max_attachments_per_request: 257 }),
    ],
    [
      "dataset paths above hard ceiling",
      researchInputRecord({ max_research_dataset_paths: 257 }),
    ],
    [
      "references above hard ceiling",
      researchInputRecord({ max_research_input_references: 257 }),
    ],
    [
      "references below attachments",
      researchInputRecord({ max_research_input_references: 63 }),
    ],
    [
      "references below dataset paths",
      researchInputRecord({
        max_attachments_per_request: 32,
        max_research_dataset_paths: 64,
        max_research_input_references: 63,
      }),
    ],
    [
      "unknown protocol",
      researchInputRecord({
        protocol: "research_input_resolution_v2",
        upstream_private_field: "must-not-be-copied",
      }),
    ],
    ["disabled descriptor", researchInputRecord({ enabled: false })],
  ])("fails closed for %s Research input data", (_name, researchInput) => {
    const parsed = parseCapabilityResponse(
      manifestPayload(
        [record("InSilicoResearchAgent")],
        uploadRecord(),
        researchInput
      )
    );

    const parsedResearchInput = parsed.researchInput;
    expect(parsedResearchInput).toEqual(disabledBotResearchInputCapability());
    expect(parsedResearchInput).not.toBe(researchInput);
    expect(parsedResearchInput).not.toHaveProperty("upstream_private_field");
  });

  it("disables Research input when the Research Agent is disabled", () => {
    const parsed = parseCapabilityResponse(
      manifestPayload(
        [record("InSilicoResearchAgent", false)],
        uploadRecord(),
        researchInputRecord()
      )
    );

    expect(parsed.researchInput).toEqual(disabledBotResearchInputCapability());
  });

  it("clones Research input limits across cache reads", async () => {
    mockRequest.mockResolvedValueOnce(
      manifestPayload([record("InSilicoResearchAgent")])
    );

    const first = useBotCapabilities("research-input-cache");
    await first.load();
    first.researchInput.value.max_user_query_chars = 1;

    const second = useBotCapabilities("research-input-cache");
    await second.load();

    expect(second.researchInput.value).toEqual(researchInputRecord());
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it("accepts negotiated upload counts through the structural ceiling", async () => {
    mockRequest.mockResolvedValueOnce(
      manifestPayload(
        [record("InSilicoResearchAgent")],
        uploadRecord({ max_attachments: 64 })
      )
    );

    const state = useBotCapabilities("upload-negotiated-count");
    await state.load();

    expect(state.upload.value.max_attachments).toBe(64);
  });

  it("rejects upload counts above the structural ceiling", async () => {
    mockRequest.mockResolvedValueOnce(
      manifestPayload(
        [record("InSilicoResearchAgent")],
        uploadRecord({ max_attachments: 257 })
      )
    );

    const state = useBotCapabilities("upload-count-above-ceiling");
    await state.load();

    expect(state.upload.value.enabled).toBe(false);
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
    expect(state.byTool.value.ChatAgent?.attachmentChannels).toEqual([]);
    expect(state.byTool.value.AnalystAgent?.attachmentChannels).toEqual([]);
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
