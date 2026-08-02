import { ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTaskLifecycle } from "@/api/types";
import { REMOTE_AGENT_PRODUCT_REGISTRY } from "@/constants/agents";
import GeneNetworkAgentView from "@/views/gene-network-agent/GeneNetworkAgentView.vue";
import type { BotRunProjection } from "@/views/chat/botProjection";
import type { BotRemoteAgentRunState } from "@/views/chat/composables/useBotRemoteAgentRun";
import type { BotLifecycleState } from "@/views/chat/streaming/botLifecycleReducer";
import { createTestAppContext } from "../helpers/test-app-context";

const mocks = vi.hoisted(() => {
  const state: { value: BotRemoteAgentRunState } = {
    value: {
      runId: null,
      status: "RUNNING" as const,
      reportRevision: -1,
      visibleReport: "",
      intermediateReport: "",
      finalReport: "",
      degraded: false,
      failures: [],
      artifacts: [],
      phase: "idle" as const,
      requestId: null,
      uploadTransfer: null,
      projection: null,
      error: null,
      dialogueId: null,
      messageId: null,
    },
  };
  const capabilities = {
    loaded: { value: true },
    loading: { value: false },
    load: vi.fn().mockResolvedValue([]),
    byTool: {
      value: {
        GeneNetworkAgent: {
          tool: "GeneNetworkAgent",
          slug: "network",
          execution: "agent_run",
          stream: false,
          a2ui: false,
          resolver: true,
          attachments: true,
          artifacts: true,
          enabled: true,
        },
      },
    },
  };
  return {
    state,
    capabilities,
    submit: vi.fn().mockResolvedValue(null),
    hydrate: vi.fn(),
    useBotRemoteAgentRun: vi.fn(),
    cancel: vi.fn().mockReturnValue(true),
    reset: vi.fn(),
    getChatState: vi.fn(() => ({})),
    getChatdownloadURL: vi.fn(),
    getAnswerCheck: vi.fn().mockResolvedValue({ code: 200, data: [] }),
    getTaskLifecycle: vi.fn(),
    routerBack: vi.fn(),
  };
});

vi.mock("@/api/chat", () => ({
  getChatdownloadURL: mocks.getChatdownloadURL,
  getAnswerCheck: mocks.getAnswerCheck,
}));

vi.mock("@/api/task", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/task")>();
  return { ...actual, getTaskLifecycle: mocks.getTaskLifecycle };
});

vi.mock("@/views/chat/composables/useBotCapabilities", () => ({
  useBotCapabilities: () => mocks.capabilities,
}));

vi.mock("@/views/chat/composables/useBotRemoteAgentRun", () => ({
  useBotRemoteAgentRun: mocks.useBotRemoteAgentRun,
}));

mocks.useBotRemoteAgentRun.mockImplementation(() => ({
  state: mocks.state,
  submit: mocks.submit,
  hydrate: mocks.hydrate,
  cancel: mocks.cancel,
  reset: mocks.reset,
}));

vi.mock("@/views/chat/composables/useChatStates", () => ({
  useChatStates: () => ({ getChatState: mocks.getChatState }),
}));

vi.mock("@/components/research/ResearchArtifactShell.vue", () => ({
  default: {
    template:
      '<section><button data-test="network-report-reset" @click="$emit(\'action\')">reset</button><slot name="content"/><slot name="evidence"/><slot name="activity"/><slot name="downloads"/></section>',
  },
}));
vi.mock("@/components/research/BotReportState.vue", () => ({
  default: {
    props: ["state"],
    template:
      '<div data-test="bot-report-state"><span v-if="state.degraded" data-test="network-degraded">degraded</span></div>',
  },
}));
vi.mock("@/components/research/BotArtifactList.vue", () => ({
  default: { template: '<div data-test="bot-artifact-list" />' },
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({ back: mocks.routerBack }),
  useRoute: () => ({ query: {} }),
}));

function mountView(options: { state?: BotLifecycleState } = {}) {
  return createTestAppContext().mount(GeneNetworkAgentView, {
    props: options.state ? { state: options.state } : undefined,
    global: {
      stubs: {
        ResearchArtifactShell: {
          template:
            '<section><button data-test="network-report-reset" @click="$emit(\'action\')">reset</button><slot name="content"/><slot name="evidence"/><slot name="activity"/><slot name="downloads"/></section>',
        },
        BotReportState: {
          props: ["state"],
          template:
            '<div data-test="bot-report-state"><span v-if="state.degraded" data-test="network-degraded">degraded</span><span data-test="network-report-text">{{ state.visibleReport }}</span></div>',
        },
        BotArtifactList: {
          props: ["artifacts"],
          template:
            '<div data-test="bot-artifact-list">{{ artifacts.map((artifact) => artifact.outputDir).join(",") }}</div>',
        },
      },
    },
  });
}

function resetState(): void {
  mocks.state = ref({
    runId: null,
    status: "RUNNING",
    reportRevision: -1,
    visibleReport: "",
    intermediateReport: "",
    finalReport: "",
    degraded: false,
    failures: [],
    artifacts: [],
    phase: "idle",
    requestId: null,
    uploadTransfer: null,
    projection: null,
    error: null,
    dialogueId: null,
    messageId: null,
  });
  mocks.capabilities.loaded.value = true;
  REMOTE_AGENT_PRODUCT_REGISTRY.GeneNetworkAgent.live = true;
  mocks.capabilities.byTool.value.GeneNetworkAgent = {
    tool: "GeneNetworkAgent",
    slug: "network",
    execution: "agent_run",
    stream: false,
    a2ui: false,
    resolver: true,
    attachments: true,
    artifacts: true,
    enabled: true,
  };
}

function lifecycle(
  overrides: Partial<AgentTaskLifecycle> = {}
): AgentTaskLifecycle {
  return {
    id: 19,
    phase: "PREPARING",
    terminal: false,
    child_task_count: 1,
    child_work_accepted: true,
    report_revision: 0,
    artifact_summary: {
      image_count: 0,
      output_directory_count: 0,
      has_report: false,
    },
    reconciliation: "FRESH",
    tracking_degraded: false,
    error_code: null,
    ...overrides,
  };
}

afterEach(() => {
  REMOTE_AGENT_PRODUCT_REGISTRY.GeneNetworkAgent.live = false;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function degradedState(): BotLifecycleState {
  return {
    runId: "run-network",
    status: "RUNNING",
    reportRevision: 1,
    visibleReport: "Partial network report",
    intermediateReport: "Partial network report",
    finalReport: "",
    degraded: true,
    failures: ["Optional network analysis unavailable"],
    artifacts: [],
  };
}

describe("GeneNetworkAgentView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useBotRemoteAgentRun.mockImplementation(() => ({
      state: mocks.state,
      submit: mocks.submit,
      hydrate: mocks.hydrate,
      cancel: mocks.cancel,
      reset: mocks.reset,
    }));
    resetState();
    mocks.submit.mockResolvedValue(null);
    mocks.hydrate.mockImplementation((next: BotRunProjection) => {
      mocks.state.value = {
        ...mocks.state.value,
        runId: next.runId,
        status: next.status === "SUCCEEDED" ? "SUCCEEDED" : "RUNNING",
        phase: next.status === "SUCCEEDED" ? "succeeded" : "running",
        reportRevision: next.reportRevision,
        visibleReport: next.finalReport || next.intermediateReport,
        intermediateReport: next.intermediateReport,
        finalReport: next.finalReport,
        artifacts: next.artifacts,
        projection: next,
      };
    });
    mocks.capabilities.load.mockResolvedValue([]);
    mocks.getAnswerCheck.mockResolvedValue({ code: 200, data: [] });
    mocks.getTaskLifecycle.mockResolvedValue({ data: lifecycle() });
  });

  it("passes the Gene Network tool to the shared product runner", () => {
    const view = mountView();
    expect(view.get('[data-scroll-root="gene-network-agent"]').exists()).toBe(
      true
    );
    expect(mocks.useBotRemoteAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "GeneNetworkAgent" })
    );
    view.unmount();
  });

  it("keeps loading and unavailable Back actions labeled and reachable", async () => {
    mocks.capabilities.loaded.value = false;
    const loading = mountView();
    expect(loading.get('[data-test="network-back"]').text()).toBe("Back");
    await loading.get('[data-test="network-back"]').trigger("click");
    expect(mocks.routerBack).toHaveBeenCalledTimes(1);
    loading.unmount();

    mocks.capabilities.loaded.value = true;
    REMOTE_AGENT_PRODUCT_REGISTRY.GeneNetworkAgent.live = false;
    const unavailable = mountView();
    expect(unavailable.get('[data-test="network-unavailable"]').exists()).toBe(
      true
    );
    expect(unavailable.get('[data-test="network-back"]').text()).toBe("Back");
    await unavailable.get('[data-test="network-back"]').trigger("click");
    expect(mocks.routerBack).toHaveBeenCalledTimes(2);
    unavailable.unmount();
  });

  it("contains a rejected capability bootstrap", async () => {
    mocks.capabilities.load.mockRejectedValueOnce(
      new Error("capabilities unavailable")
    );
    const wrapper = mountView();

    await Promise.resolve();
    expect(mocks.capabilities.load).toHaveBeenCalled();
    wrapper.unmount();
  });

  it("submits a closed-set trait/species resolver without leaking ids into query", async () => {
    const wrapper = mountView();
    await wrapper
      .get('[data-test="network-question"]')
      .setValue("Analyze the trait network");
    await wrapper.get('[data-test="network-trait"]').setValue("TO:0000011");
    await wrapper.get('[data-test="network-species"]').setValue("ath");
    await wrapper.get("form.gene-network-form").trigger("submit");

    expect(mocks.submit).toHaveBeenCalledWith({
      query: "Analyze the trait network",
      resolver: { toId: "TO:0000011", speciesCode: "ath" },
    });
    expect(mocks.submit.mock.calls[0][0].query).not.toContain("TO:0000011");
    expect(mocks.submit.mock.calls[0][0].query).not.toContain("ath");
    expect(
      (wrapper.get('[data-test="network-trait"]').element as HTMLSelectElement)
        .value
    ).toBe("TO:0000011");
    expect(
      (
        wrapper.get('[data-test="network-species"]')
          .element as HTMLSelectElement
      ).value
    ).toBe("ath");
    wrapper.unmount();
  });

  it("blocks missing and malformed resolver values before transport", async () => {
    const wrapper = mountView();
    await wrapper
      .get('[data-test="network-question"]')
      .setValue("Analyze traits");
    await wrapper.get("form.gene-network-form").trigger("submit");
    expect(wrapper.get('[data-test="network-validation"]').text()).toContain(
      "Trait Ontology"
    );
    expect(wrapper.get('[data-test="network-validation"]').text()).toContain(
      "species"
    );
    expect(mocks.submit).not.toHaveBeenCalled();

    const trait = wrapper.get('[data-test="network-trait"]');
    const species = wrapper.get('[data-test="network-species"]');
    (trait.element as HTMLSelectElement).value = "TO:9999999";
    (species.element as HTMLSelectElement).value = "unknown";
    await trait.trigger("change");
    await species.trigger("change");
    await wrapper.get("form.gene-network-form").trigger("submit");
    expect(mocks.submit).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("renders localized validation for empty and oversized questions", async () => {
    const wrapper = mountView();
    await wrapper.get("form.gene-network-form").trigger("submit");
    expect(wrapper.get('[data-test="network-form-error"]').text()).toContain(
      "Enter a network question"
    );
    expect(mocks.submit).not.toHaveBeenCalled();

    await wrapper
      .get('[data-test="network-question"]')
      .setValue("x".repeat(4001));
    await wrapper.get('[data-test="network-trait"]').setValue("TO:0000011");
    await wrapper.get('[data-test="network-species"]').setValue("ath");
    await wrapper.get("form.gene-network-form").trigger("submit");
    expect(wrapper.get('[data-test="network-form-error"]').text()).toContain(
      "too long"
    );
    expect(mocks.submit).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("fails closed for dark and incomplete capability manifests", () => {
    REMOTE_AGENT_PRODUCT_REGISTRY.GeneNetworkAgent.live = false;
    let wrapper = mountView();
    expect(wrapper.get('[data-test="network-unavailable"]').exists()).toBe(
      true
    );
    expect(wrapper.find('[data-test="network-submit"]').exists()).toBe(false);
    wrapper.unmount();

    REMOTE_AGENT_PRODUCT_REGISTRY.GeneNetworkAgent.live = true;
    const baseCapability = {
      ...mocks.capabilities.byTool.value.GeneNetworkAgent,
    };
    for (const field of ["enabled", "resolver", "artifacts"] as const) {
      mocks.capabilities.byTool.value.GeneNetworkAgent = {
        ...baseCapability,
        [field]: false,
      };
      wrapper = mountView();
      expect(wrapper.get('[data-test="network-unavailable"]').exists()).toBe(
        true
      );
      expect(wrapper.find('[data-test="network-submit"]').exists()).toBe(false);
      wrapper.unmount();
    }

    mocks.capabilities.byTool.value.GeneNetworkAgent = {
      ...baseCapability,
      execution: "chat",
    };
    wrapper = mountView();
    expect(wrapper.get('[data-test="network-unavailable"]').exists()).toBe(
      true
    );
    wrapper.unmount();
  });

  it("renders degraded empty-artifact state without static task or download paths", () => {
    const wrapper = mountView({ state: degradedState() });
    expect(wrapper.get('[data-test="network-degraded"]').exists()).toBe(true);
    expect(wrapper.find('a[href*="task"]').exists()).toBe(false);
    expect(wrapper.html()).not.toContain("/static/downloads/");
    expect(wrapper.html()).not.toContain("8ab4434b");
    expect(wrapper.get('[data-test="network-empty-artifacts"]').exists()).toBe(
      true
    );
    expect(wrapper.get('[data-test="bot-artifact-list"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("keeps Reset, Back, and keyboard submit reachable", async () => {
    const wrapper = mountView({ state: degradedState() });
    await wrapper.get('[data-test="network-back"]').trigger("click");
    expect(mocks.routerBack).toHaveBeenCalledTimes(1);

    await wrapper
      .get('[data-test="network-question"]')
      .setValue("Analyze traits");
    await wrapper.get('[data-test="network-trait"]').setValue("TO:0000207");
    await wrapper.get('[data-test="network-species"]').setValue("osa");
    await wrapper.get('[data-test="network-submit"]').trigger("keydown.enter");
    expect(mocks.submit).toHaveBeenCalledTimes(1);

    await wrapper.get('[data-test="network-reset"]').trigger("click");
    expect(mocks.reset).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("reconciles preparing, running, and terminal network reports after 24 seconds", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const runningProjection: BotRunProjection = {
      runId: "run-network",
      agent: "GeneNetworkAgent",
      status: "RUNNING",
      reportPresentation: true,
      reportStage: null,
      reportCompleteness: "partial",
      reportRevision: 0,
      reportUpdatedAt: null,
      intermediateReport: "",
      finalReport: "",
      progress: {
        completed: 0,
        total: 1,
        failed: 0,
        pending: 1,
        briefGeneStatus: "",
      },
      degraded: false,
      degradedReason: null,
      failures: [],
      artifacts: [],
      requestId: null,
      trackingDegraded: false,
    };
    mocks.submit.mockImplementationOnce(async () => {
      mocks.state.value = {
        ...mocks.state.value,
        runId: "run-network",
        phase: "running",
        projection: runningProjection,
        dialogueId: "dialogue-network",
        messageId: "19",
      };
      return runningProjection;
    });
    const preparing = lifecycle();
    mocks.getTaskLifecycle
      .mockResolvedValueOnce({ data: preparing })
      .mockResolvedValueOnce({ data: preparing })
      .mockResolvedValueOnce({ data: preparing })
      .mockResolvedValueOnce({ data: preparing })
      .mockResolvedValueOnce({ data: preparing })
      .mockResolvedValueOnce({
        data: lifecycle({
          phase: "RUNNING",
          report_revision: 1,
          artifact_summary: { ...preparing.artifact_summary, has_report: true },
        }),
      })
      .mockResolvedValueOnce({
        data: lifecycle({
          phase: "SUCCEEDED",
          terminal: true,
          report_revision: 2,
          artifact_summary: {
            image_count: 1,
            output_directory_count: 1,
            has_report: true,
          },
        }),
      });
    mocks.getAnswerCheck
      .mockResolvedValueOnce({
        code: 200,
        data: [
          {
            id: 19,
            dialogue_id: "dialogue-network",
            tool_name: "GeneNetworkAgent",
            bot_run_id: "run-network",
            status: "RUNNING",
            report_revision: 1,
            answer: JSON.stringify({
              intermediate_report: "Network intermediate",
            }),
          },
        ],
      })
      .mockResolvedValueOnce({
        code: 200,
        data: [
          {
            id: 19,
            dialogue_id: "dialogue-network",
            tool_name: "GeneNetworkAgent",
            bot_run_id: "run-network",
            status: "SUCCEEDED",
            report_revision: 2,
            answer: JSON.stringify({ final_report: "Network final" }),
            download_path: "/obs/bucket/network",
          },
        ],
      });

    const wrapper = mountView();
    await wrapper
      .get('[data-test="network-question"]')
      .setValue("Analyze the trait network");
    await wrapper.get('[data-test="network-trait"]').setValue("TO:0000011");
    await wrapper.get('[data-test="network-species"]').setValue("ath");
    await wrapper.get("form.gene-network-form").trigger("submit");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(wrapper.get('[data-test="network-report-text"]').text()).toBe(
      "Network intermediate"
    );

    await vi.advanceTimersByTimeAsync(1000);
    expect(wrapper.get('[data-test="network-report-text"]').text()).toBe(
      "Network final"
    );
    expect(wrapper.get('[data-test="bot-artifact-list"]').text()).toContain(
      "/obs/bucket/network"
    );
    wrapper.unmount();
  });
});
