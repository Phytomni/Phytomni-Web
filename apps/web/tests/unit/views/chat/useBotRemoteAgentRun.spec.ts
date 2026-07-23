import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref, type Ref } from "vue";

const mockQuery = vi.hoisted(() => vi.fn());
const mockAbortRequest = vi.hoisted(() => vi.fn(() => true));
const mockTrackerUpdate = vi.hoisted(() => vi.fn());
const mockTrackerReset = vi.hoisted(() => vi.fn());
const mockUseBotCapabilities = vi.hoisted(() => vi.fn());
const mockLoadCapabilities = vi.hoisted(() => vi.fn());

vi.mock("@/api/chat", () => ({
  getQueryAbortable: mockQuery,
}));

vi.mock("@/utils/request", () => ({
  default: vi.fn(),
  abortRequest: mockAbortRequest,
}));

vi.mock("@/utils/transfer-progress", () => ({
  createTransferTracker: vi.fn(() => ({
    update: mockTrackerUpdate,
    reset: mockTrackerReset,
  })),
}));

// Keep the route contract test focused on the lazy boundary. Loading the real
// Research SFC would pull Element Plus CSS into the Node runner.
vi.mock("@/views/research-agent/ResearchAgentView.vue", () => ({
  default: { __file: "/src/views/research-agent/ResearchAgentView.vue" },
}));

vi.mock("@/views/chat/composables/useBotCapabilities", () => ({
  useBotCapabilities: mockUseBotCapabilities,
}));

import {
  useBotRemoteAgentRun,
  type RemoteAgentChatState,
} from "@/views/chat/composables/useBotRemoteAgentRun";
import type {
  BotCapability,
  BotCapabilityExecution,
} from "@/views/chat/composables/useBotCapabilities";
import { initBotLifecycleState } from "@/views/chat/streaming/botLifecycleReducer";
import router, {
  REMOTE_AGENT_ROUTE_CONTRACTS,
  REMOTE_AGENT_LAZY_ROUTES,
  canActivateRemoteAgentRoute,
  remoteAgentRouteGuard,
} from "@/router";
import { mustGet } from "../../../helpers/mockFactories";

function makeState(): RemoteAgentChatState {
  return {
    isSending: false,
    uploadTransfer: null,
    activeRequestId: "",
    generationStopped: false,
  };
}

type CapabilityMap = Record<string, Partial<BotCapability> | undefined>;
type TestCapabilitySource = {
  byTool: Ref<CapabilityMap>;
  load?: (force?: boolean) => Promise<unknown>;
};

function makeCapabilities(
  tool: string,
  enabled = true,
  attachments: boolean | undefined = true,
  execution: BotCapabilityExecution = "agent_run",
  resolver = false,
  load?: () => Promise<unknown>,
  artifacts: boolean | undefined = true
): TestCapabilitySource {
  return {
    byTool: ref<CapabilityMap>({
      [tool]: {
        enabled,
        attachments,
        execution,
        resolver,
        artifacts,
      },
    }),
    load,
  };
}

describe("useBotRemoteAgentRun", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockAbortRequest.mockClear();
    mockTrackerUpdate.mockReset();
    mockTrackerReset.mockReset();
    mockUseBotCapabilities.mockReset();
    mockLoadCapabilities.mockReset();
  });

  it("does not submit a dark or unknown remote agent", async () => {
    const states = new Map<string, RemoteAgentChatState>();
    const getChatState = (dialogueId: string) => {
      if (!states.has(dialogueId)) states.set(dialogueId, makeState());
      return mustGet(
        states.get(dialogueId),
        `remote agent state ${dialogueId}`
      );
    };
    const run = useBotRemoteAgentRun({
      tool: "GeneNetworkAgent",
      dialogueId: "d1",
      getChatState,
      capabilities: makeCapabilities("GeneNetworkAgent", false),
    });

    await expect(run.submit({ query: "trait" })).rejects.toMatchObject({
      code: "capability_disabled",
    });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects unknown tools, invalid dialogue ids, and empty queries before transport", async () => {
    const source = makeCapabilities("GeneNetworkAgent");
    const unknown = useBotRemoteAgentRun({
      tool: "UnknownAgent" as never,
      dialogueId: "d-unknown",
      capabilities: source,
    });
    await expect(unknown.submit({ query: "trait" })).rejects.toMatchObject({
      code: "unknown_agent",
    });

    const invalidDialogue = useBotRemoteAgentRun({
      tool: "GeneNetworkAgent",
      dialogueId: "bad/dialogue",
      capabilities: source,
    });
    await expect(
      invalidDialogue.submit({ query: "trait" })
    ).rejects.toMatchObject({
      code: "invalid_dialogue",
    });

    const emptyQuery = useBotRemoteAgentRun({
      tool: "GeneNetworkAgent",
      dialogueId: "d-empty",
      capabilities: source,
    });
    await expect(emptyQuery.submit({ query: "   " })).rejects.toMatchObject({
      code: "invalid_query",
    });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("keeps run state inside the supplied dialogue", async () => {
    const states = new Map<string, RemoteAgentChatState>();
    const getChatState = (dialogueId: string) => {
      if (!states.has(dialogueId)) states.set(dialogueId, makeState());
      return mustGet(
        states.get(dialogueId),
        `remote agent state ${dialogueId}`
      );
    };
    const paperFile = new File(["paper"], "paper.pdf", {
      type: "application/pdf",
    });
    mockQuery.mockResolvedValueOnce({
      data: {
        bot_run_id: "run-research-1",
        tool_name: "InSilicoResearchAgent",
        status: "RUNNING",
        dialogue_id: "42",
        id: 17,
      },
    });

    const run = useBotRemoteAgentRun({
      tool: "InSilicoResearchAgent",
      dialogueId: "d1",
      getChatState,
      capabilities: makeCapabilities(
        "InSilicoResearchAgent",
        true,
        true,
        "agent_run",
        true
      ),
    });

    await run.submit({
      query: "paper",
      files: [paperFile],
      resolver: { geneId: "AT1G01010", speciesCode: "ath" },
      dataList: { "/obs/dataset.csv": "traits" },
      interopMode: "auto",
      interopTargets: ["mcp-peer"],
    });

    expect(getChatState("d1").botProjection?.runId).toBe("run-research-1");
    expect(getChatState("d1").botLifecycle?.runId).toBe("run-research-1");
    expect(run.state.value.dialogueId).toBe("42");
    expect(run.state.value.messageId).toBe("17");

    const formData = mockQuery.mock.calls[0][0] as FormData;
    expect(formData.get("query")).toBe("paper");
    expect(formData.get("tool")).toBe("InSilicoResearchAgent");
    expect(formData.get("mode")).toBe("instant");
    expect(formData.get("id")).toBe("d1");
    expect(formData.get("files")).toBeInstanceOf(File);
    expect(formData.get("gene_id")).toBe("AT1G01010");
    expect(formData.get("species_code")).toBe("ath");
    expect(formData.get("data_list")).toBe(
      JSON.stringify({ "/obs/dataset.csv": "traits" })
    );
    expect(formData.get("interop_mode")).toBe("auto");
    expect(formData.get("interop_targets")).toBe(JSON.stringify(["mcp-peer"]));
    expect(formData.get("query")).not.toContain("AT1G01010");
    expect(getChatState("d1").activeRequestId).toBe("");
  });

  it("retains only safe interop provenance in owner lifecycle state", async () => {
    const state = makeState();
    mockQuery.mockResolvedValueOnce({
      data: {
        bot_run_id: "run-research-interop",
        tool_name: "InSilicoResearchAgent",
        status: "RUNNING",
        degraded_interop: true,
        interop: {
          mode: "auto",
          status: "degraded",
          target_id: "mcp-peer",
          kind: "mcp",
          code: "degraded",
          endpoint: "https://private.invalid",
        },
      },
    });
    const run = useBotRemoteAgentRun({
      tool: "InSilicoResearchAgent",
      dialogueId: "d-interop",
      getChatState: () => state,
      capabilities: makeCapabilities("InSilicoResearchAgent"),
    });

    await run.submit({ query: "paper" });

    expect(run.state.value.interop).toEqual({
      mode: "auto",
      status: "degraded",
      targetId: "mcp-peer",
      kind: "mcp",
      code: "degraded",
    });
    expect(run.state.value.degradedInterop).toBe(true);
    expect(state.botLifecycle?.interop).toEqual(run.state.value.interop);
    expect(state.botLifecycle?.degradedInterop).toBe(true);
    expect(JSON.stringify(state)).not.toContain("private.invalid");
  });

  it("does not parse an explicit failure envelope that also carries data", async () => {
    mockQuery.mockResolvedValueOnce({
      code: 500,
      data: {
        bot_run_id: "run-error-data",
        tool_name: "InSilicoResearchAgent",
        status: "SUCCEEDED",
        final_report: "This must not enter lifecycle state",
      },
    });
    const state = makeState();
    const run = useBotRemoteAgentRun({
      tool: "InSilicoResearchAgent",
      dialogueId: "d-error-envelope",
      getChatState: () => state,
      capabilities: makeCapabilities("InSilicoResearchAgent"),
    });

    await expect(run.submit({ query: "paper" })).rejects.toThrow(
      "invalid response envelope"
    );
    expect(run.state.value.phase).toBe("failed");
    expect(run.state.value.error).toBe("request_failed");
    expect(state.botProjection).toBeUndefined();
  });

  it("sanitizes pre-existing lifecycle interop before entering reactive state", () => {
    const rawInterop = {
      mode: "auto",
      status: "delegated",
      targetId: "mcp-peer",
      kind: "mcp",
      code: "no_evidence",
      endpoint: "https://private.invalid",
      credentials: "secret-token",
    };
    const state: RemoteAgentChatState = {
      ...makeState(),
      botLifecycle: {
        ...initBotLifecycleState(),
        degradedInterop: "yes" as never,
        interop: rawInterop as never,
      },
    };

    const run = useBotRemoteAgentRun({
      tool: "InSilicoResearchAgent",
      dialogueId: "d-existing-lifecycle",
      getChatState: () => state,
      capabilities: makeCapabilities("InSilicoResearchAgent"),
    });

    expect(run.state.value.degradedInterop).toBe(false);
    expect(run.state.value.interop).toEqual({
      mode: "auto",
      status: "delegated",
      targetId: "mcp-peer",
      kind: "mcp",
      code: "no_evidence",
    });
    expect(run.state.value.interop).not.toBe(rawInterop);
    expect(run.state.value.interop).not.toHaveProperty("endpoint");
    expect(run.state.value.interop).not.toHaveProperty("credentials");
  });

  it("hydrates a validated terminal projection and clears its identity on reset", async () => {
    mockQuery.mockResolvedValueOnce({
      data: {
        bot_run_id: "run-research-2",
        tool_name: "InSilicoResearchAgent",
        status: "RUNNING",
        dialogue_id: "43",
        id: 18,
      },
    });
    const run = useBotRemoteAgentRun({
      tool: "InSilicoResearchAgent",
      dialogueId: "d-hydrate",
      capabilities: makeCapabilities("InSilicoResearchAgent"),
    });

    await run.submit({ query: "paper" });
    run.hydrate(
      {
        runId: "run-research-2",
        agent: "InSilicoResearchAgent",
        status: "SUCCEEDED",
        reportStage: "final",
        reportCompleteness: "complete",
        reportRevision: 1,
        reportUpdatedAt: null,
        intermediateReport: "",
        finalReport: "Terminal report",
        progress: {
          completed: 1,
          total: 1,
          failed: 0,
          pending: 0,
          briefGeneStatus: "",
        },
        degraded: false,
        degradedReason: null,
        failures: [],
        artifacts: [{ outputDir: "/obs/bucket/report", paths: [] }],
        requestId: null,
        trackingDegraded: false,
        interop: {
          mode: "required",
          status: "delegated",
          targetId: "a2a-peer",
          kind: "a2a",
          code: "no_evidence",
        },
        degradedInterop: false,
      },
      { dialogueId: "43", messageId: "18" }
    );

    expect(run.state.value.phase).toBe("succeeded");
    expect(run.state.value.finalReport).toBe("Terminal report");
    expect(run.state.value.dialogueId).toBe("43");
    expect(run.state.value.messageId).toBe("18");
    expect(run.state.value.interop).toEqual({
      mode: "required",
      status: "delegated",
      targetId: "a2a-peer",
      kind: "a2a",
      code: "no_evidence",
    });

    run.reset();
    expect(run.state.value.dialogueId).toBeNull();
    expect(run.state.value.messageId).toBeNull();
    expect(run.state.value.interop).toBeNull();
    expect(run.state.value.degradedInterop).toBe(false);
  });

  it("loads the default capability source before submitting", async () => {
    const source = makeCapabilities(
      "GeneNetworkAgent",
      true,
      true,
      "agent_run"
    );
    source.load = mockLoadCapabilities.mockResolvedValueOnce([]);
    mockUseBotCapabilities.mockReturnValue(source);
    mockQuery.mockResolvedValueOnce({
      data: {
        bot_run_id: "run-network-1",
        tool_name: "GeneNetworkAgent",
        status: "RUNNING",
      },
    });

    const run = useBotRemoteAgentRun({
      tool: "GeneNetworkAgent",
      dialogueId: "d3",
    });
    await run.submit({ query: "trait" });

    expect(mockLoadCapabilities).toHaveBeenCalledTimes(1);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("loads an injected capability source and rejects incomplete authorization", async () => {
    const load = mockLoadCapabilities.mockResolvedValueOnce([]);
    const cases: Array<
      [
        string,
        TestCapabilitySource,
        { files?: File[]; resolver?: { geneId: string; speciesCode: string } }
      ]
    > = [
      [
        "wrong execution",
        makeCapabilities("DigitalDesignAgent", true, true, "chat"),
        {},
      ],
      [
        "missing attachment authorization",
        makeCapabilities(
          "DigitalDesignAgent",
          true,
          null as unknown as boolean,
          "agent_run"
        ),
        { files: [new File(["x"], "x.txt")] },
      ],
      [
        "missing resolver authorization",
        makeCapabilities("DigitalDesignAgent", true, true, "agent_run", false),
        { resolver: { geneId: "AT1G01010", speciesCode: "ath" } },
      ],
      [
        "missing artifact authorization",
        makeCapabilities(
          "DigitalDesignAgent",
          true,
          true,
          "agent_run",
          false,
          undefined,
          false
        ),
        {},
      ],
    ];

    for (const [name, source, input] of cases) {
      source.load = load;
      const run = useBotRemoteAgentRun({
        tool: "DigitalDesignAgent",
        dialogueId: `guard-${name.replace(/\s+/gu, "-")}`,
        capabilities: source,
      });
      await expect(
        run.submit({ query: "design", ...input })
      ).rejects.toMatchObject({
        code:
          name === "missing resolver authorization"
            ? "resolver_disabled"
            : name === "missing attachment authorization"
            ? "attachments_disabled"
            : name === "missing artifact authorization"
            ? "artifacts_disabled"
            : "capability_disabled",
      });
    }
    expect(load).toHaveBeenCalledTimes(cases.length);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("aborts the active request and clears dialogue upload progress", async () => {
    let resolveRequest: (value: unknown) => void = () => undefined;
    mockTrackerUpdate.mockReturnValue({
      loaded: 1,
      total: 2,
      percent: 50,
      etaSec: null,
      indeterminate: false,
      phase: "upload",
      requestId: "pending",
    });
    mockQuery.mockImplementationOnce((_formData, _requestId, config) => {
      config?.onUploadProgress?.({ loaded: 1, total: 2 });
      return new Promise((resolve) => {
        resolveRequest = resolve;
      });
    });
    const state = makeState();
    const run = useBotRemoteAgentRun({
      tool: "DigitalDesignAgent",
      dialogueId: "d2",
      getChatState: () => state,
      capabilities: makeCapabilities("DigitalDesignAgent"),
    });

    const pending = run.submit({
      query: "design",
      files: [new File(["design"], "design.txt", { type: "text/plain" })],
    });
    await Promise.resolve();
    expect(state.activeRequestId).not.toBe("");
    expect(state.uploadTransfer?.percent).toBe(50);
    const requestId = state.activeRequestId;
    expect(run.cancel()).toBe(true);
    expect(mockAbortRequest).toHaveBeenCalledWith(requestId);
    expect(state.activeRequestId).toBe("");
    expect(state.uploadTransfer).toBeNull();
    resolveRequest({
      data: {
        bot_run_id: "run-design-1",
        tool_name: "DigitalDesignAgent",
        status: "CANCELLED",
      },
    });
    await pending;

    expect(state.uploadTransfer).toBeNull();
    expect(state.activeRequestId).toBe("");
    expect(state.activeAgentName).toBe("");
    expect(state.botLifecycle?.status).toBe("FAILED");
    expect(state.botLifecycle?.failures).toContain("analysis task cancelled");
    expect(run.state.value.phase).toBe("cancelled");
  });

  it("does not let a reset old response overwrite a later run", async () => {
    let resolveA: (value: unknown) => void = () => undefined;
    let resolveB: (value: unknown) => void = () => undefined;
    mockQuery
      .mockReturnValueOnce(new Promise((resolve) => (resolveA = resolve)))
      .mockReturnValueOnce(new Promise((resolve) => (resolveB = resolve)));
    const state = makeState();
    const run = useBotRemoteAgentRun({
      tool: "GeneNetworkAgent",
      dialogueId: "d4",
      getChatState: () => state,
      capabilities: makeCapabilities("GeneNetworkAgent"),
    });

    const oldRun = run.submit({ query: "old" });
    await Promise.resolve();
    run.reset();
    const newRun = run.submit({ query: "new" });
    await Promise.resolve();

    resolveA({
      data: {
        bot_run_id: "run-old",
        tool_name: "GeneNetworkAgent",
        status: "SUCCEEDED",
        final_report: "old",
      },
    });
    await oldRun;
    expect(state.botProjection).toBeUndefined();

    resolveB({
      data: {
        bot_run_id: "run-new",
        tool_name: "GeneNetworkAgent",
        status: "SUCCEEDED",
        final_report: "new",
      },
    });
    await newRun;
    expect(state.botProjection?.runId).toBe("run-new");
  });

  it("keeps the research route dark and points its lazy boundary at Research", async () => {
    const contract = REMOTE_AGENT_ROUTE_CONTRACTS.InSilicoResearchAgent;
    const originalLive = contract.live;
    const route = router
      .getRoutes()
      .find((candidate) => candidate.path === "/research-agent");
    expect(route).toBeTruthy();
    expect(router.resolve("/research-agent").name).toBe("researchAgent");
    expect(
      canActivateRemoteAgentRoute("InSilicoResearchAgent", {
        roles: ["InSilicoResearchAgent"],
        capabilities: {
          InSilicoResearchAgent: { enabled: true, execution: "agent_run" },
        },
      })
    ).toBe(false);

    contract.live = true;
    expect(
      canActivateRemoteAgentRoute("InSilicoResearchAgent", {
        roles: [],
        capabilities: {
          InSilicoResearchAgent: { enabled: true, execution: "agent_run" },
        },
      })
    ).toBe(false);
    expect(
      canActivateRemoteAgentRoute("InSilicoResearchAgent", {
        roles: ["InSilicoResearchAgent"],
        capabilities: {
          InSilicoResearchAgent: { enabled: true, execution: "agent_run" },
        },
      })
    ).toBe(true);
    const guard = remoteAgentRouteGuard("InSilicoResearchAgent");
    expect(
      await guard({
        meta: {
          remoteAccess: {
            roles: [],
            capabilities: {
              InSilicoResearchAgent: {
                enabled: true,
                execution: "agent_run",
              },
            },
          },
        },
      } as never)
    ).toEqual({ name: "NotFound" });
    expect(
      await guard({
        meta: {
          remoteAccess: {
            roles: ["InSilicoResearchAgent"],
            capabilities: {
              InSilicoResearchAgent: {
                enabled: true,
                execution: "agent_run",
              },
            },
          },
        },
      } as never)
    ).toBe(true);
    contract.live = originalLive;

    const component = REMOTE_AGENT_LAZY_ROUTES[0].component as () => Promise<{
      default?: { __file?: string };
    }>;
    const loaded = await component();
    expect(loaded.default?.__file).toContain(
      "views/research-agent/ResearchAgentView.vue"
    );
  });
});
