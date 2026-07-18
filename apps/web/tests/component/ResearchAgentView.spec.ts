import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { REMOTE_AGENT_PRODUCT_REGISTRY } from "@/constants/agents";
import ResearchAgentView from "@/views/research-agent/index.vue";
import type { BotLifecycleState } from "@/views/chat/streaming/botLifecycleReducer";

const mocks = vi.hoisted(() => {
  const state = {
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
  const hydrate = vi.fn((projection: any, identity: any = {}) => {
    state.value = {
      ...state.value,
      phase:
        projection.status === "SUCCEEDED"
          ? "succeeded"
          : projection.status === "FAILED" || projection.status === "CANCELLED"
          ? "failed"
          : "running",
      projection,
      runId: projection.runId,
      status:
        projection.status === "SUCCEEDED"
          ? "SUCCEEDED"
          : projection.status === "FAILED" || projection.status === "CANCELLED"
          ? "FAILED"
          : "RUNNING",
      visibleReport: projection.finalReport || projection.intermediateReport,
      finalReport: projection.finalReport,
      intermediateReport: projection.intermediateReport,
      degraded: projection.degraded,
      failures: projection.failures,
      artifacts: projection.artifacts,
      dialogueId: identity.dialogueId ?? state.value.dialogueId,
      messageId: identity.messageId ?? state.value.messageId,
    };
  });
  return {
    state,
    submit: vi.fn().mockResolvedValue(null),
    hydrate,
    cancel: vi.fn().mockReturnValue(true),
    reset: vi.fn(),
    load: vi.fn().mockResolvedValue([]),
    getChatState: vi.fn(() => ({})),
    getAnswerCheck: vi.fn().mockResolvedValue({ code: 200, data: [] }),
    capabilityLoaded: { value: true },
    routerBack: vi.fn(),
  };
});

vi.mock("@/api/chat", () => ({
  getAnswerCheck: mocks.getAnswerCheck,
  getChatdownloadURL: vi.fn(),
}));

vi.mock("@/views/chat/composables/useBotRemoteAgentRun", () => ({
  useBotRemoteAgentRun: () => ({
    state: mocks.state,
    submit: mocks.submit,
    hydrate: mocks.hydrate,
    cancel: mocks.cancel,
    reset: mocks.reset,
  }),
}));

vi.mock("@/views/chat/composables/useBotCapabilities", () => ({
  useBotCapabilities: () => ({
    loaded: mocks.capabilityLoaded,
    loading: { value: false },
    byTool: {
      value: {
        InSilicoResearchAgent: {
          tool: "InSilicoResearchAgent",
          slug: "research",
          execution: "agent_run",
          stream: false,
          a2ui: false,
          resolver: false,
          attachments: true,
          artifacts: true,
          enabled: true,
        },
      },
    },
    load: mocks.load,
  }),
}));

vi.mock("@/views/chat/composables/useChatStates", () => ({
  useChatStates: () => ({ getChatState: mocks.getChatState }),
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({ back: mocks.routerBack, push: vi.fn() }),
  useRoute: () => ({ query: {} }),
}));

vi.mock("@/components/research/ResearchArtifactShell.vue", () => ({
  default: {
    props: ["title", "metadata", "status", "reportStatus"],
    template:
      '<section><slot name="content"/><slot name="evidence"/><slot name="activity"/><slot name="downloads"/></section>',
  },
}));
vi.mock("@/components/research/BotReportState.vue", () => ({
  default: {
    props: ["state"],
    template:
      '<div data-test="bot-report-state"><span v-if="state.degraded" data-test="research-degraded">degraded</span></div>',
  },
}));
vi.mock("@/components/research/BotArtifactList.vue", () => ({
  default: { template: '<div data-test="bot-artifact-list" />' },
}));

function mountView(options: { state?: BotLifecycleState } = {}) {
  return mount(ResearchAgentView, {
    props: options.state ? { state: options.state } : undefined,
    global: {
      stubs: {
        ResearchArtifactShell: {
          template:
            '<section><button data-test="research-reset" @click="$emit(\'action\')">reset</button><slot name="content"/><slot name="evidence"/><slot name="downloads"/></section>',
        },
        BotReportState: {
          props: ["state"],
          template:
            '<div data-test="bot-report-state"><span v-if="state.degraded" data-test="research-degraded">degraded</span></div>',
        },
        BotArtifactList: {
          template: '<div data-test="bot-artifact-list" />',
        },
      },
    },
  });
}

function degradedState(): BotLifecycleState {
  return {
    runId: "run-1",
    status: "RUNNING",
    reportRevision: 1,
    visibleReport: "Partial report",
    intermediateReport: "Partial report",
    finalReport: "",
    degraded: true,
    failures: ["Optional analysis unavailable"],
    artifacts: [],
  };
}

describe("ResearchAgentView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    REMOTE_AGENT_PRODUCT_REGISTRY.InSilicoResearchAgent.live = true;
    mocks.state.value = {
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
    };
    mocks.submit.mockResolvedValue(null);
    mocks.getAnswerCheck.mockResolvedValue({ code: 200, data: [] });
    mocks.capabilityLoaded.value = true;
  });

  afterEach(() => {
    REMOTE_AGENT_PRODUCT_REGISTRY.InSilicoResearchAgent.live = false;
  });

  it("keeps loading and dark-product Back actions reachable", async () => {
    mocks.capabilityLoaded.value = false;
    const loading = mountView();
    expect(loading.get('[data-test="research-back"]').exists()).toBe(true);
    await loading.get('[data-test="research-back"]').trigger("click");
    expect(mocks.routerBack).toHaveBeenCalledTimes(1);
    loading.unmount();

    mocks.capabilityLoaded.value = true;
    REMOTE_AGENT_PRODUCT_REGISTRY.InSilicoResearchAgent.live = false;
    const unavailable = mountView();
    expect(unavailable.get('[data-test="research-unavailable"]').exists()).toBe(
      true
    );
    await unavailable.get('[data-test="research-back"]').trigger("click");
    expect(mocks.routerBack).toHaveBeenCalledTimes(2);
    unavailable.unmount();
  });

  it("uses localized custom validation for empty and oversized questions", async () => {
    const wrapper = mountView();

    await wrapper.get("form.research-agent-form").trigger("submit");
    expect(wrapper.get('[data-test="research-form-error"]').exists()).toBe(
      true
    );
    expect(mocks.submit).not.toHaveBeenCalled();

    await wrapper
      .get('[data-test="research-question"]')
      .setValue("x".repeat(4001));
    await wrapper.get("form.research-agent-form").trigger("submit");
    expect(wrapper.get('[data-test="research-form-error"]').exists()).toBe(
      true
    );
    expect(mocks.submit).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("submits a research question and preserves uploaded paper names", async () => {
    const wrapper = mountView();
    const paper = new File(["paper"], "paper.pdf", { type: "application/pdf" });

    await wrapper
      .get('[data-test="research-question"]')
      .setValue("Summarize the paper");
    const fileInput = wrapper.get('[data-test="research-files"]');
    Object.defineProperty(fileInput.element, "files", {
      configurable: true,
      value: [paper],
    });
    await fileInput.trigger("change");

    expect(wrapper.text()).toContain("paper.pdf");
    await wrapper.get('[data-test="research-submit"]').trigger("click");

    expect(mocks.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "Summarize the paper",
        files: expect.arrayContaining([paper]),
      })
    );
    expect(mocks.submit.mock.calls[0][0]).not.toHaveProperty("dataList");
    wrapper.unmount();
  });

  it("sends a bounded dataset description through the stable query marker", async () => {
    const wrapper = mountView();

    await wrapper
      .get('[data-test="research-question"]')
      .setValue("Summarize the paper");
    await wrapper
      .get('[data-test="research-dataset"]')
      .setValue("Traits were measured in drought-treated plants.");
    await wrapper.get('[data-test="research-submit"]').trigger("click");

    expect(mocks.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        query:
          "Summarize the paper\n\n[dataset-description]\nTraits were measured in drought-treated plants.",
      })
    );
    expect(mocks.submit.mock.calls[0][0]).not.toHaveProperty("dataList");
    wrapper.unmount();
  });

  it("shows a safe degraded report without an invented file link", () => {
    const wrapper = mountView({ state: degradedState() });

    expect(wrapper.get('[data-test="research-degraded"]').exists()).toBe(true);
    expect(wrapper.find('a[href*="task"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("hydrates terminal history once and stops polling after cancellation", async () => {
    vi.useFakeTimers();
    mocks.submit.mockImplementationOnce(async () => {
      mocks.state.value = {
        ...mocks.state.value,
        phase: "running",
        dialogueId: "42",
        projection: {
          runId: "run-research",
          agent: "InSilicoResearchAgent",
          status: "RUNNING",
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
        },
      };
      return mocks.state.value.projection;
    });
    mocks.getAnswerCheck.mockResolvedValueOnce({
      code: 200,
      data: [
        {
          id: 19,
          dialogue_id: "42",
          tool_name: "InSilicoResearchAgent",
          bot_run_id: "run-research",
          status: "SUCCEEDED",
          answer: JSON.stringify({ final_report: "Terminal report" }),
          download_path: "/obs/bucket/report",
          image_paths: JSON.stringify([
            "/obs/bucket/report/result.pdf",
            "javascript:alert(1)",
          ]),
        },
      ],
    });
    const wrapper = mountView();
    await wrapper
      .get('[data-test="research-question"]')
      .setValue("Summarize the paper");
    await wrapper.get('[data-test="research-submit"]').trigger("click");
    await vi.advanceTimersByTimeAsync(2000);

    expect(mocks.getAnswerCheck).toHaveBeenCalledWith({ dialogue_id: "42" });
    expect(mocks.hydrate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "SUCCEEDED",
        finalReport: "Terminal report",
        artifacts: [
          {
            outputDir: "/obs/bucket/report",
            paths: ["/obs/bucket/report/result.pdf"],
          },
        ],
      }),
      expect.objectContaining({ dialogueId: "42", messageId: "19" })
    );
    expect(wrapper.find('a[href*="javascript"]').exists()).toBe(false);

    const callsAfterTerminal = mocks.getAnswerCheck.mock.calls.length;
    await vi.advanceTimersByTimeAsync(6000);
    expect(mocks.getAnswerCheck.mock.calls.length).toBe(callsAfterTerminal);

    wrapper.unmount();
    vi.useRealTimers();
  });

  it("stops a pending history poll on cancel and reset", async () => {
    vi.useFakeTimers();
    mocks.state.value = {
      ...mocks.state.value,
      phase: "running",
      dialogueId: "44",
    };
    mocks.submit.mockImplementationOnce(async () => {
      return {
        runId: "run-pending",
        agent: "InSilicoResearchAgent",
        status: "RUNNING",
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
    });
    const wrapper = mountView();
    await wrapper
      .get('[data-test="research-question"]')
      .setValue("Summarize the paper");
    await wrapper.get('[data-test="research-submit"]').trigger("click");
    await vi.advanceTimersByTimeAsync(0);
    await wrapper.get('[data-test="research-cancel"]').trigger("click");
    await vi.advanceTimersByTimeAsync(4000);
    expect(mocks.getAnswerCheck).not.toHaveBeenCalled();

    await wrapper.get('[data-test="research-reset"]').trigger("click");
    await vi.advanceTimersByTimeAsync(4000);
    expect(mocks.getAnswerCheck).not.toHaveBeenCalled();

    wrapper.unmount();
    vi.useRealTimers();
  });
});
