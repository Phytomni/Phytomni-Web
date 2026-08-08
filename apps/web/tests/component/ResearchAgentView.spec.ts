import { flushPromises } from "@vue/test-utils";
import { reactive, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTaskLifecycle } from "@/api/types";
import { REMOTE_AGENT_PRODUCT_REGISTRY } from "@/constants/agents";
import ResearchAgentView from "@/views/research-agent/ResearchAgentView.vue";
import type { BotRunProjection } from "@/views/chat/botProjection";
import type { BotLifecycleState } from "@/views/chat/streaming/botLifecycleReducer";
import type {
  BotRemoteAgentRunState,
  RemoteAgentRunIdentity,
} from "@/views/chat/composables/useBotRemoteAgentRun";
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
  const hydrate = vi.fn(
    (
      projection: BotRunProjection,
      identity: Partial<RemoteAgentRunIdentity> = {}
    ) => {
      state.value = {
        ...state.value,
        phase:
          projection.status === "SUCCEEDED"
            ? "succeeded"
            : projection.status === "FAILED" ||
                projection.status === "CANCELLED"
              ? "failed"
              : "running",
        projection,
        runId: projection.runId,
        status:
          projection.status === "SUCCEEDED"
            ? "SUCCEEDED"
            : projection.status === "FAILED" ||
                projection.status === "CANCELLED"
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
    }
  );
  const chatState = { fileList: [] as unknown[] };
  const uploadQueue = {
    queueFiles: vi.fn().mockResolvedValue(undefined),
    removeUpload: vi.fn().mockResolvedValue(undefined),
    removeUploadById: vi.fn().mockResolvedValue(undefined),
    cancelUpload: vi.fn().mockResolvedValue(undefined),
    pauseUpload: vi.fn().mockResolvedValue(undefined),
    resumeUpload: vi.fn().mockResolvedValue(undefined),
    retryUpload: vi.fn().mockResolvedValue(undefined),
    reselectUpload: vi.fn(),
    cancelDialogue: vi.fn().mockResolvedValue(undefined),
    recoveryStore: {},
    hasBlockingUploads: { value: false, __v_isRef: true },
    completedAssetIds: { value: [] as Array<{ asset_id: string }> },
  };
  const researchInputCapability = {
    enabled: true,
    protocol: "research_input_resolution_v1",
    max_user_query_chars: 131072,
    max_attachments_per_request: 64,
    max_research_dataset_paths: 64,
    max_research_input_references: 128,
  };
  return {
    state,
    submit: vi.fn().mockResolvedValue(null),
    useBotRemoteAgentRun: vi.fn(),
    hydrate,
    cancel: vi.fn().mockReturnValue(true),
    reset: vi.fn(),
    load: vi.fn().mockResolvedValue([]),
    chatState,
    uploadQueue,
    researchInputCapability,
    getChatState: vi.fn(() => chatState),
    getAnswerCheck: vi.fn().mockResolvedValue({ code: 200, data: [] }),
    getTaskLifecycle: vi.fn(),
    capabilityLoaded: { value: true },
    routerBack: vi.fn(),
  };
});

vi.mock("@/api/chat", () => ({
  getAnswerCheck: mocks.getAnswerCheck,
  getChatdownloadURL: vi.fn(),
}));

vi.mock("@/api/task", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/task")>();
  return { ...actual, getTaskLifecycle: mocks.getTaskLifecycle };
});

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
          attachmentChannels: ["dataset"],
          artifacts: true,
          enabled: true,
        },
      },
    },
    upload: {
      value: {
        enabled: true,
        protocol: "obs-multipart-v2",
        upload_origin: "https://uploads.example.test",
        max_file_bytes: 10 * 1024 * 1024 * 1024,
        max_attachments: 10,
      },
    },
    researchInput: {
      value: mocks.researchInputCapability,
    },
    load: mocks.load,
  }),
}));

vi.mock("@/views/chat/composables/useResumableUploads", () => ({
  useResumableUploads: () => mocks.uploadQueue,
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
  return createTestAppContext().mount(ResearchAgentView, {
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
            '<div data-test="bot-report-state"><span v-if="state.degraded" data-test="research-degraded">degraded</span><span data-test="research-report-text">{{ state.visibleReport }}</span></div>',
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

describe("ResearchAgentView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useBotRemoteAgentRun.mockImplementation(() => ({
      state: mocks.state,
      submit: mocks.submit,
      hydrate: mocks.hydrate,
      cancel: mocks.cancel,
      reset: mocks.reset,
    }));
    REMOTE_AGENT_PRODUCT_REGISTRY.InSilicoResearchAgent.live = true;
    mocks.chatState = reactive({ fileList: [] as unknown[] });
    mocks.getChatState.mockImplementation(() => mocks.chatState);
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
    mocks.hydrate.mockImplementation(
      (
        projection: BotRunProjection,
        identity: Partial<RemoteAgentRunIdentity> = {}
      ) => {
        mocks.state.value = {
          ...mocks.state.value,
          phase:
            projection.status === "SUCCEEDED"
              ? "succeeded"
              : projection.status === "FAILED" ||
                  projection.status === "CANCELLED"
                ? "failed"
                : "running",
          projection,
          runId: projection.runId,
          status:
            projection.status === "SUCCEEDED"
              ? "SUCCEEDED"
              : projection.status === "FAILED" ||
                  projection.status === "CANCELLED"
                ? "FAILED"
                : "RUNNING",
          visibleReport:
            projection.finalReport || projection.intermediateReport,
          finalReport: projection.finalReport,
          intermediateReport: projection.intermediateReport,
          degraded: projection.degraded,
          failures: projection.failures,
          artifacts: projection.artifacts,
          dialogueId: identity.dialogueId ?? mocks.state.value.dialogueId,
          messageId: identity.messageId ?? mocks.state.value.messageId,
        };
      }
    );
    mocks.submit.mockResolvedValue(null);
    mocks.load.mockResolvedValue([]);
    mocks.getAnswerCheck.mockResolvedValue({ code: 200, data: [] });
    mocks.getTaskLifecycle.mockResolvedValue({ data: lifecycle() });
    mocks.capabilityLoaded.value = true;
    mocks.chatState.fileList = [];
    mocks.uploadQueue.hasBlockingUploads.value = false;
    mocks.uploadQueue.completedAssetIds.value = [];
    Object.assign(mocks.researchInputCapability, {
      enabled: true,
      protocol: "research_input_resolution_v1",
      max_user_query_chars: 131072,
      max_attachments_per_request: 64,
      max_research_dataset_paths: 64,
      max_research_input_references: 128,
    });
  });

  afterEach(() => {
    REMOTE_AGENT_PRODUCT_REGISTRY.InSilicoResearchAgent.live = false;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("passes the Research tool to the shared product runner", () => {
    const view = mountView();
    expect(mocks.useBotRemoteAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "InSilicoResearchAgent" })
    );
    view.unmount();
  });

  it("renders the shared attachment strip for In Silico Research", () => {
    mocks.chatState.fileList = [
      {
        localId: "research-upload",
        assetId: "file_dataset",
        name: "reads.fastq.gz",
        size: 6,
        type: "application/gzip",
        file: null,
        lastModified: 42,
        status: "completed",
        partSize: 6,
        partCount: 1,
        receivedParts: [1],
        loadedBytes: 6,
        speedBytesPerSecond: 0,
        etaSeconds: 0,
        retryCount: 0,
        errorCode: null,
      },
    ];
    const view = mountView();

    expect(view.find('[data-testid="attachment-chip-strip"]').exists()).toBe(
      true
    );
    expect(view.find('[data-testid="chat-upload-card"]').exists()).toBe(false);
    view.unmount();
  });

  it("renders chip removal after success and preserves chips after rejection", async () => {
    const item = {
      localId: "research-submit",
      assetId: "file_dataset",
      name: "reads.fastq.gz",
      size: 6,
      type: "application/gzip",
      file: null,
      lastModified: 42,
      status: "completed" as const,
      partSize: 6,
      partCount: 1,
      receivedParts: [1],
      loadedBytes: 6,
      speedBytesPerSecond: 0,
      etaSeconds: 0,
      retryCount: 0,
      errorCode: null,
    };
    mocks.chatState.fileList = [item];
    mocks.uploadQueue.completedAssetIds.value = [{ asset_id: item.assetId }];
    mocks.uploadQueue.removeUpload.mockImplementation(async (candidate) => {
      mocks.chatState.fileList = mocks.chatState.fileList.filter(
        (entry) => entry !== candidate
      );
    });
    const accepted = mountView();
    await accepted
      .get('[data-test="research-question"]')
      .setValue("Analyze the reads");
    await accepted.get('[data-test="research-submit"]').trigger("click");
    await Promise.resolve();
    await accepted.vm.$nextTick();

    expect(accepted.find('[data-testid="attachment-chip"]').exists()).toBe(
      false
    );
    accepted.unmount();

    mocks.chatState.fileList = [{ ...item, localId: "research-rejected" }];
    mocks.submit.mockRejectedValueOnce(new Error("submit failed"));
    const rejected = mountView();
    await rejected
      .get('[data-test="research-question"]')
      .setValue("Keep the research draft");
    await rejected.get('[data-test="research-submit"]').trigger("click");
    await Promise.resolve();
    await rejected.vm.$nextTick();

    expect(
      rejected.get('[data-test="research-question"]').element
    ).toHaveProperty("value", "Keep the research draft");
    expect(rejected.find('[data-testid="attachment-chip"]').exists()).toBe(
      true
    );
    rejected.unmount();
  });

  it("blocks a second submit after acceptance when cleanup leaves chips visible", async () => {
    const item = {
      localId: "research-cleanup-failed",
      assetId: "file_dataset",
      name: "reads.fastq.gz",
      size: 6,
      type: "application/gzip",
      file: null,
      lastModified: 42,
      status: "completed" as const,
      partSize: 6,
      partCount: 1,
      receivedParts: [1],
      loadedBytes: 6,
      speedBytesPerSecond: 0,
      etaSeconds: 0,
      retryCount: 0,
      errorCode: null,
    };
    mocks.chatState.fileList = [item];
    mocks.uploadQueue.completedAssetIds.value = [{ asset_id: item.assetId }];
    mocks.submit.mockImplementationOnce(async () => {
      mocks.state.value = {
        ...mocks.state.value,
        phase: "running",
      };
    });
    mocks.uploadQueue.removeUpload.mockRejectedValueOnce(
      new Error("cleanup failed")
    );
    const view = mountView();

    await view.get('[data-test="research-question"]').setValue("Run once");
    const submit = view.get('[data-test="research-submit"]');
    await submit.trigger("click");
    await flushPromises();

    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(submit.element).toHaveProperty("disabled", true);
    expect(view.find('[data-testid="attachment-chip"]').exists()).toBe(true);

    await submit.trigger("click");
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    view.unmount();
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

  it("italicizes only In Silico in the product title", () => {
    const wrapper = mountView();
    const title = wrapper.get("#research-agent-title");
    expect(title.text()).toBe("In Silico Research Agent");
    expect(title.get("em").text()).toBe("In Silico");
    expect(title.get("em").text()).not.toContain("Research Agent");
    wrapper.unmount();
  });

  it("contains a rejected capability bootstrap", async () => {
    mocks.load.mockRejectedValueOnce(new Error("capabilities unavailable"));
    const wrapper = mountView();

    await Promise.resolve();
    expect(mocks.load).toHaveBeenCalled();
    wrapper.unmount();
  });

  it("uses localized custom validation for empty and negotiated oversized questions", async () => {
    const wrapper = mountView();

    await wrapper.get("form.research-agent-form").trigger("submit");
    expect(wrapper.get('[data-test="research-form-error"]').exists()).toBe(
      true
    );
    expect(mocks.submit).not.toHaveBeenCalled();

    await wrapper
      .get('[data-test="research-question"]')
      .setValue("🧬".repeat(131073));
    await wrapper.get("form.research-agent-form").trigger("submit");
    expect(wrapper.get('[data-test="research-form-error"]').exists()).toBe(
      true
    );
    expect(wrapper.get('[data-test="research-form-error"]').text()).toBe(
      "The research question is too long."
    );
    expect(mocks.submit).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("renders Research unavailable when the decoded input capability is disabled", () => {
    Object.assign(mocks.researchInputCapability, {
      enabled: false,
      max_user_query_chars: 0,
      max_attachments_per_request: 0,
      max_research_dataset_paths: 0,
      max_research_input_references: 0,
    });

    const wrapper = mountView();
    const unavailable = wrapper.get('[data-test="research-unavailable"]');

    expect(unavailable.attributes("role")).toBe("status");
    expect(unavailable.attributes("aria-live")).toBe("polite");
    expect(wrapper.find("form.research-agent-form").exists()).toBe(false);
    wrapper.unmount();
  });

  it("removes the old 4000-character limit only for negotiated Research", async () => {
    const wrapper = mountView();
    const query = "x".repeat(4001);

    await wrapper.get('[data-test="research-question"]').setValue(query);
    await wrapper.get("form.research-agent-form").trigger("submit");

    expect(mocks.submit).toHaveBeenCalledWith({
      query,
      attachments: [],
    });
    wrapper.unmount();
  });

  it("submits a short query with PDF and dataset assets as references only", async () => {
    const wrapper = mountView();
    const paper = new File(["paper"], "paper.pdf", { type: "application/pdf" });
    const dataset = new File(["counts"], "counts.mtx.gz", {
      type: "application/gzip",
    });
    const rawQuery = "Compare the synthetic paper and matrix inputs.";

    await wrapper.get('[data-test="research-question"]').setValue(rawQuery);
    const fileInput = wrapper.get('[data-test="research-files"]');
    Object.defineProperty(fileInput.element, "files", {
      configurable: true,
      value: [paper, dataset],
    });
    await fileInput.trigger("change");

    mocks.uploadQueue.completedAssetIds.value = [
      { asset_id: "file_pdf_fixture_19" },
      { asset_id: "file_dataset_fixture_19" },
    ];
    expect(mocks.uploadQueue.queueFiles).toHaveBeenCalledWith([paper, dataset]);
    await wrapper.get('[data-test="research-submit"]').trigger("click");

    const request = mocks.submit.mock.calls[0][0];
    expect(request).toEqual({
      query: rawQuery,
      attachments: [
        { asset_id: "file_pdf_fixture_19" },
        { asset_id: "file_dataset_fixture_19" },
      ],
    });
    expect(Object.keys(request).sort()).toEqual(["attachments", "query"]);
    expect(request).not.toHaveProperty("data_list");
    expect(request).not.toHaveProperty("obs_file_list");
    expect(request).not.toHaveProperty("dataset_description");
    wrapper.unmount();
  });

  it("delegates arbitrary biological formats to the resumable queue", async () => {
    const wrapper = mountView();
    const input = wrapper.get('[data-test="research-files"]');
    const reads = new File(["reads"], "sample.bam", {
      type: "application/octet-stream",
    });

    expect(input.attributes("accept")).toBeUndefined();
    Object.defineProperty(input.element, "files", {
      configurable: true,
      value: [reads],
    });
    await input.trigger("change");

    expect(mocks.uploadQueue.queueFiles).toHaveBeenCalledWith([reads]);
    wrapper.unmount();
  });

  it("blocks a research submission while an upload is active", async () => {
    mocks.uploadQueue.hasBlockingUploads.value = true;
    const wrapper = mountView();
    await wrapper
      .get('[data-test="research-question"]')
      .setValue("Summarize a study");

    expect(wrapper.get('[data-test="research-submit"]').element).toHaveProperty(
      "disabled",
      true
    );
    await wrapper.get("form.research-agent-form").trigger("submit");
    expect(mocks.submit).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("submits attachments without client classification metadata", async () => {
    mocks.chatState.fileList = [
      {
        localId: "research-upload",
        assetId: "file_dataset",
        name: "counts.csv",
        size: 6,
        type: "text/csv",
        file: null,
        lastModified: 42,
        status: "completed",
        partSize: 6,
        partCount: 1,
        receivedParts: [1],
        loadedBytes: 6,
        speedBytesPerSecond: 0,
        etaSeconds: 0,
        retryCount: 0,
        errorCode: null,
      },
    ];
    mocks.uploadQueue.completedAssetIds.value = [{ asset_id: "file_dataset" }];
    const wrapper = mountView();

    await wrapper
      .get('[data-test="research-question"]')
      .setValue("Summarize the paper");
    await wrapper.get('[data-test="research-submit"]').trigger("click");

    expect(mocks.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "Summarize the paper",
        attachments: [{ asset_id: "file_dataset" }],
      })
    );
    expect(mocks.submit.mock.calls[0][0]).not.toHaveProperty("dataList");
    expect(mocks.submit.mock.calls[0][0]).not.toHaveProperty(
      "datasetDescription"
    );
    wrapper.unmount();
  });

  it("shows a safe degraded report without an invented file link", () => {
    const wrapper = mountView({ state: degradedState() });

    expect(wrapper.get('[data-test="research-degraded"]').exists()).toBe(true);
    expect(wrapper.find('a[href*="task"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("keeps Research watched beyond 24 seconds and renders intermediate and terminal history", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    mocks.submit.mockImplementationOnce(async () => {
      mocks.state.value = {
        ...mocks.state.value,
        phase: "running",
        dialogueId: "42",
        messageId: "19",
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
            dialogue_id: "42",
            tool_name: "InSilicoResearchAgent",
            bot_run_id: "run-research",
            status: "RUNNING",
            report_revision: 1,
            answer: JSON.stringify({
              intermediate_report: "Intermediate report",
            }),
          },
        ],
      })
      .mockResolvedValueOnce({
        code: 200,
        data: [
          {
            id: 19,
            dialogue_id: "42",
            tool_name: "InSilicoResearchAgent",
            bot_run_id: "run-research",
            status: "SUCCEEDED",
            report_revision: 2,
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
    await vi.advanceTimersByTimeAsync(30_000);

    expect(mocks.getAnswerCheck).toHaveBeenCalledWith({ dialogue_id: "42" });
    expect(wrapper.get('[data-test="research-report-text"]').text()).toBe(
      "Intermediate report"
    );

    await vi.advanceTimersByTimeAsync(1000);
    expect(wrapper.get('[data-test="research-report-text"]').text()).toBe(
      "Terminal report"
    );
    expect(wrapper.get('[data-test="bot-artifact-list"]').text()).toContain(
      "/obs/bucket/report"
    );
    expect(wrapper.find('a[href*="javascript"]').exists()).toBe(false);

    const callsAfterTerminal = mocks.getAnswerCheck.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.getAnswerCheck.mock.calls.length).toBe(callsAfterTerminal);

    wrapper.unmount();
  });
});
