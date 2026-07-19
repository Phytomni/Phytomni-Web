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

describe("useBotCapabilities", () => {
  beforeEach(() => {
    mockRequest.mockReset();
    clearBotCapabilitiesCache();
  });

  it("maps a valid Web response by tool and strips upstream fields", async () => {
    mockRequest.mockResolvedValueOnce({
      code: 200,
      data: [record("ChatAgent"), record("AnalystAgent", false)],
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
    expect(mockRequest).toHaveBeenCalledWith({
      url: BOT_CAPABILITIES_URL,
      method: "get",
    });
  });

  it("keeps absent, malformed, and unknown records disabled", async () => {
    mockRequest.mockResolvedValueOnce({
      code: 200,
      data: [
        record("ChatAgent"),
        { ...record("KnowledgeAgent"), slug: "wrong" },
        { tool: "UnknownAgent", slug: "unknown", enabled: true },
      ],
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
      code: 200,
      data: Array.from({ length: MAX_BOT_CAPABILITIES + 1 }, () =>
        record("ChatAgent")
      ),
    });

    const state = useBotCapabilities("oversized");
    await state.load();

    expect(state.capabilities.value.every((item) => !item.enabled)).toBe(true);
  });

  it.each([
    ["401", { code: 401, data: [record("ChatAgent")] }],
    ["404", { code: 404, data: [record("ChatAgent")] }],
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
      code: 200,
      data: [record("ChatAgent")],
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
});
