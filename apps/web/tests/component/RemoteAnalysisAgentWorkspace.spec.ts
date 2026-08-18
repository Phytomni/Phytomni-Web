import { flushPromises } from "@vue/test-utils";
import { computed, reactive } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AgentTaskLifecycle } from "@/api/types";
import { REMOTE_AGENT_PRODUCT_REGISTRY } from "@/constants/agents";
import RemoteAnalysisAgentWorkspace from "@/views/analysis-agent/RemoteAnalysisAgentWorkspace.vue";
import type {
  BotRunProjection,
  BotWorkStage,
} from "@/views/chat/botProjection";
import type { BotRemoteAgentRunState } from "@/views/chat/composables/useBotRemoteAgentRun";
import { createTestAppContext } from "../helpers/test-app-context";
import {
  assertUnifiedAttachmentBehaviorTable,
  type RetainedUploadStatus,
  type UnifiedAttachmentSurface,
} from "../helpers/unifiedAttachmentBehavior";

const WORKSPACE_SOURCE = readFileSync(
  resolve(
    __dirname,
    "../../src/views/analysis-agent/RemoteAnalysisAgentWorkspace.vue"
  ),
  "utf8"
);
const PAGE_STYLE =
  WORKSPACE_SOURCE.match(/\.analysis-agent-page\s*\{[^}]*\}/)?.[0] ?? "";
const FORM_STYLE =
  WORKSPACE_SOURCE.match(/\.analysis-agent-form\s*\{[^}]*\}/)?.[0] ?? "";
const FILE_INPUT_STYLE =
  WORKSPACE_SOURCE.match(
    /\.analysis-agent-field input\[type="file"\]\s*\{[^}]*\}/
  )?.[0] ?? "";

const SAFE_RESEARCH_PATH_LINES = [
  "/fixtures/rice-root/GSE146033_RAW/GSM4363196_9311RPM.txt.gz",
  "/fixtures/rice-root/GSE146033_RAW/GSM4363198_Nip_RPM.txt.gz",
  "/fixtures/rice-root/GSM4363200_9311/GSM4363200_9311_barcodes.tsv.gz",
  "/fixtures/rice-root/GSM4363200_9311/GSM4363200_9311_genes.tsv.gz",
  "/fixtures/rice-root/GSM4363200_9311/GSM4363200_9311_matrix.mtx.gz",
  "/fixtures/rice-root/GSM4363201_Nip/GSM4363201_Nip_barcodes.tsv.gz",
  "/fixtures/rice-root/GSM4363201_Nip/GSM4363201_Nip_genes.tsv.gz",
  "/fixtures/rice-root/GSM4363201_Nip/GSM4363201_Nip_matrix.mtx.gz",
  "/fixtures/rice-root/Orthologues/Orthologues_A_thaliana_pep/A_thaliana_pep__v__NIP_genome_pep.tsv",
  "/fixtures/rice-root/Orthologues/Orthologues_NIP_genome_pep/NIP_genome_pep__v__A_thaliana_pep.tsv",
  "/fixtures/rice-root/org.Osativa.eg.db.tar.gz",
] as const;

vi.mock("vue-element-plus-x", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue-element-plus-x")>()),
  Typewriter: { name: "Typewriter", template: "<div />" },
}));

const mocks = vi.hoisted(() => {
  const state: { value: BotRemoteAgentRunState } = {
    value: {
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
    },
  };
  const lifecycleSnapshot = {
    value: null as AgentTaskLifecycle | null,
  };
  const chatState = { fileList: [] as unknown[] };
  const analystCapability = {
    enabled: true,
    execution: "agent_run",
    attachments: true,
    attachmentChannels: ["document", "dataset"],
    artifacts: true,
  };
  const researchInputCapability = {
    enabled: true,
    protocol: "research_input_resolution_v1",
    max_user_query_chars: 131072,
    max_attachments_per_request: 64,
    max_research_dataset_paths: 64,
    max_research_input_references: 128,
  };
  const uploadCapability = {
    value: {
      enabled: true,
      protocol: "obs-multipart-v2",
      upload_origin: "https://upload.example.test",
      max_file_bytes: 10 * 1024 * 1024 * 1024,
      max_attachments: 64,
    },
  };
  return {
    state,
    lifecycleSnapshot,
    chatState,
    analystCapability,
    researchInputCapability,
    uploadCapability,
    submit: vi.fn().mockResolvedValue(null),
    cancel: vi.fn(),
    abortTransport: vi.fn(),
    reset: vi.fn(),
    load: vi.fn().mockResolvedValue([]),
    routerBack: vi.fn(),
    uploadQueue: {
      completedAssetIds: {
        value: [{ asset_id: "file_dataset_1234567890" }],
      },
      hasBlockingUploads: { value: false, __v_isRef: true },
      queueFiles: vi.fn().mockResolvedValue(undefined),
      removeUpload: vi.fn().mockResolvedValue(undefined),
      removeUploadById: vi.fn().mockResolvedValue(undefined),
      cancelUpload: vi.fn().mockResolvedValue(undefined),
      pauseUpload: vi.fn().mockResolvedValue(undefined),
      resumeUpload: vi.fn().mockResolvedValue(undefined),
      retryUpload: vi.fn().mockResolvedValue(undefined),
      reselectUpload: vi.fn(),
    },
    uploadOptions: null as {
      uploadCapability?: { value: { max_attachments: number } };
      onDuplicate?: (localId: string, fileName: string) => void;
      onValidationError?: (error: { code: string; fileName?: string }) => void;
    } | null,
  };
});

vi.mock("@/views/chat/composables/useBotCapabilities", () => ({
  useBotCapabilities: () => ({
    loaded: { value: true },
    byTool: {
      value: {
        AnalystAgent: {
          ...mocks.analystCapability,
        },
        InSilicoResearchAgent: {
          ...mocks.analystCapability,
        },
      },
    },
    upload: mocks.uploadCapability,
    researchInput: {
      value: mocks.researchInputCapability,
    },
    load: mocks.load,
  }),
}));

vi.mock("@/views/chat/composables/useBotRemoteAgentRun", () => ({
  useBotRemoteAgentRun: () => ({
    state: mocks.state,
    submit: mocks.submit,
    cancel: mocks.cancel,
    abortTransport: mocks.abortTransport,
    reset: mocks.reset,
  }),
}));

vi.mock("@/views/chat/composables/useChatStates", () => ({
  useChatStates: () => ({ getChatState: () => mocks.chatState }),
}));

vi.mock("@/views/chat/composables/useResumableUploads", () => ({
  useResumableUploads: (options: {
    onDuplicate?: (localId: string, fileName: string) => void;
    onValidationError?: (error: { code: string; fileName?: string }) => void;
  }) => {
    mocks.uploadOptions = options;
    return mocks.uploadQueue;
  },
}));

vi.mock("@/views/chat/composables/useRemoteAgentLifecycle", () => ({
  useRemoteAgentLifecycle: () => ({
    snapshot: computed(() => mocks.lifecycleSnapshot.value),
    dispose: vi.fn(),
    reset: vi.fn(),
  }),
}));

vi.mock("vue-router", () => ({
  useRoute: () => ({ query: {} }),
  useRouter: () => ({ back: mocks.routerBack }),
}));

function mountWorkspace(
  tool: "AnalystAgent" | "InSilicoResearchAgent" = "AnalystAgent",
  options: {
    realArtifactShell?: boolean;
    realBotArtifactList?: boolean;
    realBotReportState?: boolean;
    locale?: "en-US" | "zh-CN";
  } = {}
) {
  const research = tool === "InSilicoResearchAgent";
  const artifactShellStub = options.realArtifactShell
    ? {}
    : {
        ResearchArtifactShell: {
          template:
            '<section><slot name="content" /><slot name="downloads" /></section>',
        },
      };
  const botReportStateStub = options.realBotReportState
    ? {}
    : {
        BotReportState: {
          template: '<div data-test="bot-report-state" />',
        },
      };
  const botArtifactListStub = options.realBotArtifactList
    ? {}
    : {
        BotArtifactList: {
          template: '<div data-test="bot-artifact-list" />',
        },
      };
  return createTestAppContext({ locale: options.locale }).mount(
    RemoteAnalysisAgentWorkspace,
    {
      attachTo: document.body,
      props: {
        tool,
        localePrefix: research ? "agents.research" : "agents.analyst",
      },
      global: {
        stubs: {
          ...artifactShellStub,
          ...botReportStateStub,
          ...botArtifactListStub,
        },
      },
    }
  );
}

function lifecycle(phase: AgentTaskLifecycle["phase"]): AgentTaskLifecycle {
  const terminal = ["SUCCEEDED", "FAILED", "TIMED_OUT", "CANCELLED"].includes(
    phase
  );
  return {
    id: 19,
    phase,
    terminal,
    child_task_count: phase === "PREPARING" ? 0 : 1,
    child_work_accepted: phase !== "PREPARING",
    report_revision: terminal ? 1 : 0,
    artifact_summary: {
      image_count: 0,
      output_directory_count: 0,
      has_report: phase === "SUCCEEDED",
    },
    reconciliation: "FRESH",
    tracking_degraded: false,
    error_code: null,
  };
}

async function expectResearchStatusSurfaces(
  wrapper: ReturnType<typeof mountWorkspace>,
  label: string
): Promise<void> {
  expect(wrapper.get(".research-artifact-header__status").text()).toBe(label);
  expect(wrapper.get(".bot-report-state__status-label").text()).toBe(label);
  await wrapper.get('[data-tab-id="activity"]').trigger("click");
  const activityPanel = wrapper.get('[data-panel-id="activity"]');
  const activityStatus = wrapper.get('[data-test="research-progress"]');
  expect(activityPanel.attributes("hidden")).toBeUndefined();
  expect(activityStatus.isVisible()).toBe(true);
  expect(activityStatus.text()).toBe(label);
}

function setActiveRun(
  options: {
    phase?: BotRemoteAgentRunState["phase"];
    projectionStatus?: BotRunProjection["status"];
    workStage?: BotWorkStage | null;
    includeProjection?: boolean;
  } = {}
): void {
  const phase = options.phase ?? "running";
  const projectionStatus = options.projectionStatus ?? "RUNNING";
  const workStage = options.workStage ?? null;
  const projection: BotRunProjection | null =
    options.includeProjection === false
      ? null
      : {
          runId: "run-research-stages",
          agent: "InSilicoResearchAgent",
          status: projectionStatus,
          workStage,
          reportPresentation: false,
          reportStage: null,
          reportCompleteness: "none",
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
          resultArchiveV1: false,
          requestId: "request-research-stages",
          trackingDegraded: false,
        };

  mocks.state.value = {
    ...mocks.state.value,
    runId: "run-research-stages",
    status: "RUNNING",
    workStage,
    phase,
    projection,
    dialogueId: "research-agent",
    messageId: "19",
  };
}

function setReportMaterial(options: {
  finalReport: string;
  reportStage: "final" | null;
  agent?: BotRunProjection["agent"];
  outputDir: string;
}): void {
  const projection = mocks.state.value.projection;
  if (!projection) throw new Error("active projection required");
  const artifacts = [
    {
      outputDir: options.outputDir,
      paths: [`${options.outputDir}/report.txt`],
    },
  ];
  mocks.state.value = {
    ...mocks.state.value,
    ...(options.reportStage ? { reportStage: options.reportStage } : {}),
    visibleReport: options.finalReport,
    finalReport: options.finalReport,
    artifacts,
    projection: {
      ...projection,
      agent: options.agent ?? projection.agent,
      reportStage: options.reportStage,
      reportCompleteness: "complete",
      finalReport: options.finalReport,
      artifacts,
    },
  } as BotRemoteAgentRunState;
}

function completedUpload(localId: string, name: string) {
  return {
    localId,
    assetId: "file_dataset_1234567890",
    name,
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
  };
}

function makeUnifiedAttachmentSurface(): UnifiedAttachmentSurface {
  let wrapper: ReturnType<typeof mountWorkspace> | null = null;

  const reset = (): void => {
    wrapper?.unmount();
    wrapper = null;
    mocks.uploadOptions = null;
    mocks.chatState.fileList = [];
    mocks.uploadQueue.hasBlockingUploads.value = false;
    mocks.analystCapability.attachments = true;
    mocks.analystCapability.attachmentChannels = ["document", "dataset"];
    Object.assign(mocks.researchInputCapability, {
      enabled: true,
      protocol: "research_input_resolution_v1",
      max_user_query_chars: 131072,
      max_attachments_per_request: 64,
      max_research_dataset_paths: 64,
      max_research_input_references: 128,
    });
    mocks.submit.mockReset();
    mocks.submit.mockResolvedValue(null);
    mocks.uploadQueue.queueFiles.mockClear();
    mocks.uploadQueue.pauseUpload.mockClear();
    mocks.uploadQueue.resumeUpload.mockClear();
    mocks.uploadQueue.retryUpload.mockClear();
    mocks.uploadQueue.reselectUpload.mockClear();
    mocks.uploadQueue.cancelUpload.mockClear();
    mocks.uploadQueue.removeUploadById.mockClear();
    mocks.uploadQueue.removeUpload.mockReset();
    mocks.uploadQueue.removeUpload.mockImplementation(async (item) => {
      mocks.chatState.fileList = mocks.chatState.fileList.filter(
        (candidate) => candidate !== item
      );
    });
  };

  const mountSurface = () => {
    wrapper = mountWorkspace();
    return wrapper;
  };

  const activeUpload = (status: RetainedUploadStatus) => ({
    ...completedUpload("upload-active", "counts.csv"),
    status,
    file:
      status === "failed" || status === "expired"
        ? null
        : new File([], "counts.csv"),
  });

  return {
    reset,
    async attach() {
      const current = mountSurface();
      const input = current.get<HTMLInputElement>("[data-test=analyst-files]");
      const file = new File(["counts"], "counts.csv", { type: "text/csv" });
      Object.defineProperty(input.element, "files", {
        configurable: true,
        value: [file],
      });
      await input.trigger("change");
      return {
        attachActionCount: current.findAll("[data-test=analyst-files]").length,
        queuedFileCount: mocks.uploadQueue.queueFiles.mock.calls.length,
        purposeFree:
          mocks.uploadQueue.queueFiles.mock.calls[0]?.length === 1 &&
          Array.isArray(mocks.uploadQueue.queueFiles.mock.calls[0]?.[0]) &&
          mocks.uploadQueue.queueFiles.mock.calls[0]?.[0]?.[0] === file,
        purposeControls: current.findAll(
          '[data-test="analyst-attachment-purpose"]'
        ).length,
        descriptionControls: current.findAll('[data-test="analyst-dataset"]')
          .length,
      };
    },
    async typingDuringUpload() {
      mocks.chatState.fileList = [activeUpload("uploading")];
      const current = mountSurface();
      const query = current.get('[data-testid="analyst-query"]');
      await query.setValue("draft while uploading");
      return {
        query: String((query.element as HTMLInputElement).value),
        editorDisabled: Boolean((query.element as HTMLInputElement).disabled),
      };
    },
    async sendBlocked(statuses) {
      const result = {} as Record<RetainedUploadStatus, boolean>;
      for (const status of statuses) {
        wrapper?.unmount();
        mocks.chatState.fileList = [activeUpload(status)];
        mocks.uploadQueue.hasBlockingUploads.value = status !== "completed";
        const current = mountSurface();
        result[status] = Boolean(
          (
            current.get('[data-testid="analyst-submit"]')
              .element as HTMLButtonElement
          ).disabled
        );
      }
      return result;
    },
    async duplicate() {
      mocks.chatState.fileList = [
        completedUpload("upload-existing", "counts.csv"),
      ];
      const current = mountSurface();
      mocks.uploadOptions?.onDuplicate?.("upload-existing", "counts.csv");
      await flushPromises();
      return {
        announcement: current
          .get('[data-testid="attachment-chip-live-region"]')
          .text(),
        focused:
          document.activeElement ===
          current.get('[data-testid="attachment-chip"]').element,
      };
    },
    async lifecycle() {
      const item = completedUpload("upload-active", "counts.csv");
      const result = {
        pause: false,
        resume: false,
        retry: false,
        reselect: false,
        cancel: false,
        remove: false,
      };
      mocks.chatState.fileList = [{ ...item, status: "uploading" }];
      let current = mountSurface();
      await current.get('[data-testid="attachment-chip"]').trigger("click");
      await current
        .get('[data-testid="attachment-chip-detail-pause"]')
        .trigger("click");
      await current
        .get('[data-testid="attachment-chip-detail-cancel"]')
        .trigger("click");
      await current
        .get('[data-testid="attachment-chip-detail-remove"]')
        .trigger("click");
      result.pause = mocks.uploadQueue.pauseUpload.mock.calls.length > 0;
      result.cancel = mocks.uploadQueue.cancelUpload.mock.calls.length > 0;
      result.remove = mocks.uploadQueue.removeUploadById.mock.calls.length > 0;
      current.unmount();

      mocks.chatState.fileList = [{ ...item, status: "paused" }];
      current = mountSurface();
      await current.get('[data-testid="attachment-chip"]').trigger("click");
      await current
        .get('[data-testid="attachment-chip-detail-resume"]')
        .trigger("click");
      result.resume = mocks.uploadQueue.resumeUpload.mock.calls.length > 0;
      current.unmount();

      mocks.chatState.fileList = [{ ...item, status: "failed", file: null }];
      current = mountSurface();
      await current.get('[data-testid="attachment-chip"]').trigger("click");
      await current
        .get('[data-testid="attachment-chip-detail-retry"]')
        .trigger("click");
      await current
        .get('[data-testid="attachment-chip-detail-reselect"]')
        .trigger("click");
      const input = current.get<HTMLInputElement>(
        "[data-testid=attachment-chip-reselect-input]"
      );
      const replacement = new File(["counts"], "counts.csv", {
        type: "text/csv",
      });
      Object.defineProperty(input.element, "files", {
        configurable: true,
        value: [replacement],
      });
      await input.trigger("change");
      result.retry = mocks.uploadQueue.retryUpload.mock.calls.length > 0;
      result.reselect = mocks.uploadQueue.reselectUpload.mock.calls.length > 0;
      return result;
    },
    async submission() {
      const item = completedUpload("upload-submit", "counts.csv");
      mocks.chatState.fileList = [item];
      let current = mountSurface();
      await current.get('[data-testid="analyst-query"]').setValue("Run it");
      await current.get('[data-testid="analyst-submit"]').trigger("click");
      await flushPromises();
      const successfulClear = !current
        .find('[data-testid="attachment-chip"]')
        .exists();
      current.unmount();

      const failedItem = completedUpload("upload-failed", "counts.csv");
      mocks.chatState.fileList = [failedItem];
      mocks.submit.mockRejectedValueOnce(new Error("submit failed"));
      current = mountSurface();
      await current.get('[data-testid="analyst-query"]').setValue("Keep draft");
      await current.get('[data-testid="analyst-submit"]').trigger("click");
      await flushPromises();
      const failedPreservation = current
        .find('[data-testid="attachment-chip"]')
        .exists();
      return { successfulClear, failedPreservation };
    },
    async incompatible() {
      mocks.analystCapability.attachmentChannels = [];
      const item = completedUpload("upload-incompatible", "counts.csv");
      mocks.chatState.fileList = [item];
      const current = mountSurface();
      const zeroChannelRejected = Boolean(
        (
          current.get('[data-testid="analyst-submit"]')
            .element as HTMLButtonElement
        ).disabled
      );
      const incompatiblePreserved = current
        .find('[data-testid="attachment-chip"]')
        .exists();
      return { zeroChannelRejected, incompatiblePreserved };
    },
  };
}

describe("RemoteAnalysisAgentWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.uploadOptions = null;
    mocks.chatState = reactive({ fileList: [] as unknown[] });
    mocks.state = reactive(mocks.state);
    mocks.lifecycleSnapshot = reactive({ value: null });
    mocks.state.value = {
      ...mocks.state.value,
      status: "RUNNING",
      workStage: null,
      phase: "idle",
      projection: null,
      visibleReport: "",
      intermediateReport: "",
      finalReport: "",
      artifacts: [],
      degraded: false,
      failures: [],
    };
    delete (
      mocks.state.value as BotRemoteAgentRunState & {
        reportStage?: "final";
      }
    ).reportStage;
    mocks.lifecycleSnapshot.value = null;
    REMOTE_AGENT_PRODUCT_REGISTRY.AnalystAgent.live = true;
    REMOTE_AGENT_PRODUCT_REGISTRY.InSilicoResearchAgent.live = true;
    mocks.submit.mockResolvedValue(null);
    mocks.uploadQueue.completedAssetIds.value = [
      { asset_id: "file_dataset_1234567890" },
    ];
    mocks.chatState.fileList = [
      completedUpload("upload-existing", "counts.csv"),
    ];
    mocks.analystCapability.attachments = true;
    mocks.analystCapability.attachmentChannels = ["document", "dataset"];
    Object.assign(mocks.researchInputCapability, {
      enabled: true,
      protocol: "research_input_resolution_v1",
      max_user_query_chars: 131072,
      max_attachments_per_request: 64,
      max_research_dataset_paths: 64,
      max_research_input_references: 128,
    });
    Object.assign(mocks.uploadCapability.value, {
      enabled: true,
      protocol: "obs-multipart-v2",
      upload_origin: "https://upload.example.test",
      max_file_bytes: 10 * 1024 * 1024 * 1024,
      max_attachments: 64,
    });
  });

  afterEach(() => {
    REMOTE_AGENT_PRODUCT_REGISTRY.AnalystAgent.live = false;
    REMOTE_AGENT_PRODUCT_REGISTRY.InSilicoResearchAgent.live = false;
  });

  it("constrains the vertical scroll owner's grid and intrinsic form width", () => {
    expect(PAGE_STYLE).toContain("overflow-y: auto;");
    expect(PAGE_STYLE).toContain("overflow-x: hidden;");
    expect.soft(PAGE_STYLE).toContain("grid-template-columns: minmax(0, 1fr);");
    expect.soft(FORM_STYLE).toContain("box-sizing: border-box;");
    expect.soft(FILE_INPUT_STYLE).toMatch(/\n\s*width:\s*100%;/);
  });

  it("applies the shared attachment behavior contract", async () => {
    const surface = makeUnifiedAttachmentSurface();
    await assertUnifiedAttachmentBehaviorTable(surface);
    await surface.reset();
  });

  it("submits through the shared runner without separate attachment metadata", async () => {
    const wrapper = mountWorkspace();

    expect(wrapper.find("form.analysis-agent-form").exists()).toBe(true);
    expect(wrapper.find('[data-testid="attachment-chip-strip"]').exists()).toBe(
      true
    );
    expect(wrapper.find('[data-testid="chat-upload-card"]').exists()).toBe(
      false
    );
    expect(
      wrapper.find('[data-test="analyst-attachment-purpose"]').exists()
    ).toBe(false);
    expect(wrapper.find('[data-test="analyst-dataset"]').exists()).toBe(false);
    await wrapper
      .get('[data-testid="analyst-query"]')
      .setValue("  Compare groups  ");
    await wrapper.get('[data-testid="analyst-submit"]').trigger("click");

    expect(mocks.submit).toHaveBeenCalledWith({
      query: "Compare groups",
      attachments: [{ asset_id: "file_dataset_1234567890" }],
    });
    wrapper.unmount();
  });

  it("preserves leading and trailing newlines for negotiated Research input", async () => {
    const wrapper = mountWorkspace("InSilicoResearchAgent");
    const rawQuery = "\n  Compare complete paper evidence  \n";

    await wrapper.get('[data-testid="research-query"]').setValue(rawQuery);
    await wrapper.get('[data-testid="research-submit"]').trigger("click");

    expect(mocks.submit).toHaveBeenCalledWith({
      query: rawQuery,
      attachments: [{ asset_id: "file_dataset_1234567890" }],
    });
    wrapper.unmount();
  });

  it("submits a PDF asset and pasted data block without client path parsing", async () => {
    const wrapper = mountWorkspace("InSilicoResearchAgent");
    const rawQuery = [
      "Reproduce the synthetic analysis using the attached paper.",
      "",
      "data:",
      ...SAFE_RESEARCH_PATH_LINES,
    ].join("\n");
    mocks.uploadQueue.completedAssetIds.value = [
      { asset_id: "file_pdf_fixture_19" },
    ];
    mocks.chatState.fileList = [
      {
        ...completedUpload("upload-paper", "synthetic-paper.pdf"),
        assetId: "file_pdf_fixture_19",
        type: "application/pdf",
      },
    ];

    await wrapper.get('[data-testid="research-query"]').setValue(rawQuery);
    await wrapper.get('[data-testid="research-submit"]').trigger("click");

    const request = mocks.submit.mock.calls[0][0];
    expect(request).toEqual({
      query: rawQuery,
      attachments: [{ asset_id: "file_pdf_fixture_19" }],
    });
    expect(Object.keys(request).sort()).toEqual(["attachments", "query"]);
    expect(request).not.toHaveProperty("data_list");
    expect(request).not.toHaveProperty("obs_file_list");
    expect(request).not.toHaveProperty("dataset_description");
    expect(request.query.split("\n").slice(-11)).toEqual(
      SAFE_RESEARCH_PATH_LINES
    );
    wrapper.unmount();
  });

  it("renders the existing unavailable surface for incompatible Research input", () => {
    Object.assign(mocks.researchInputCapability, {
      enabled: false,
      max_user_query_chars: 0,
      max_attachments_per_request: 0,
      max_research_dataset_paths: 0,
      max_research_input_references: 0,
    });

    const wrapper = mountWorkspace("InSilicoResearchAgent");
    const unavailable = wrapper.get('[data-test="research-unavailable"]');

    expect(unavailable.attributes("role")).toBe("status");
    expect(unavailable.attributes("aria-live")).toBe("polite");
    expect(wrapper.find("form.research-agent-form").exists()).toBe(false);
    expect(mocks.submit).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("renders each authoritative live Research stage in the shell and activity status", async () => {
    setActiveRun({ workStage: "execution" });
    const wrapper = mountWorkspace("InSilicoResearchAgent", {
      realArtifactShell: true,
      realBotReportState: true,
    });

    for (const [phase, label] of [
      ["PREPARING", "Preparing"],
      ["RESOLVING_INPUTS", "Resolving inputs"],
      ["PLANNING", "Planning tasks"],
      ["RUNNING", "Running"],
      ["FINALIZING", "Finalizing"],
    ] as const) {
      mocks.lifecycleSnapshot.value = lifecycle(phase);
      await wrapper.vm.$nextTick();
      expect(wrapper.get(".research-artifact-header__status").text()).toBe(
        label
      );
      expect(
        wrapper
          .findAll('[role="tab"]')
          .map((tab) => tab.attributes("data-tab-id"))
      ).toEqual(["activity"]);
      expect(
        wrapper
          .findAll('[role="tabpanel"]')
          .map((panel) => panel.attributes("data-panel-id"))
      ).toEqual(["activity"]);
      const activityPanel = wrapper.get('[data-panel-id="activity"]');
      const activityStatus = wrapper.get('[data-test="research-progress"]');
      expect(activityPanel.attributes("hidden")).toBeUndefined();
      expect(activityStatus.isVisible()).toBe(true);
      expect(activityStatus.text()).toContain(label);
      expect(
        activityPanel.get('[data-test="bot-report-progress"]').text()
      ).toContain("0/1");
      expect(wrapper.find('[data-tab-id="content"]').exists()).toBe(false);
      expect(wrapper.find('[data-tab-id="evidence"]').exists()).toBe(false);
      expect(wrapper.find('[data-tab-id="downloads"]').exists()).toBe(false);
      expect(wrapper.find('[data-panel-id="content"]').exists()).toBe(false);
      expect(wrapper.find('[data-panel-id="evidence"]').exists()).toBe(false);
      expect(wrapper.find('[data-panel-id="downloads"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="bot-report-empty"]').exists()).toBe(
        false
      );
      expect(
        wrapper.find('[data-test="research-evidence-empty"]').exists()
      ).toBe(false);
      expect(wrapper.find('[data-test="bot-artifact-list"]').exists()).toBe(
        false
      );
    }

    wrapper.unmount();
  });

  it.each([
    [
      "initial RUNNING projection",
      null,
      "execution",
      null,
      "Premature final report",
      "Running",
    ],
    [
      "live FINALIZING snapshot",
      "FINALIZING",
      "report_assembly",
      "final",
      "",
      "Finalizing",
    ],
    [
      "hydrated RUNNING history",
      null,
      "report_assembly",
      "final",
      "Premature hydrated report",
      "Finalizing",
    ],
  ] as const)(
    "keeps %s progress-only despite premature terminal material",
    async (
      _source,
      snapshotPhase,
      workStage,
      reportStage,
      finalReport,
      expectedLabel
    ) => {
      setActiveRun({ workStage });
      setReportMaterial({
        finalReport,
        reportStage,
        outputDir: "/obs/bucket/premature",
      });
      if (snapshotPhase) {
        mocks.lifecycleSnapshot.value = lifecycle(snapshotPhase);
      }
      const wrapper = mountWorkspace("InSilicoResearchAgent", {
        realArtifactShell: true,
        realBotArtifactList: true,
        realBotReportState: true,
      });

      expect(wrapper.get(".research-artifact-header__status").text()).toBe(
        expectedLabel
      );
      expect(
        wrapper.get(".bot-report-state").attributes("data-report-status")
      ).toBe("loading");
      expect(wrapper.get(".bot-report-state__status-label").text()).toBe(
        expectedLabel
      );
      const reportState = wrapper.get(".bot-report-state");
      expect(
        reportState.find('[data-test="bot-report-content"]').exists()
      ).toBe(false);
      expect(reportState.find('[data-test="bot-report-empty"]').exists()).toBe(
        false
      );
      expect(wrapper.find('[data-test="bot-artifact-list"]').exists()).toBe(
        false
      );
      expect(wrapper.text()).not.toContain("Report ready");
      expect(wrapper.text()).not.toContain("Finished");
      if (finalReport) {
        expect(wrapper.text()).not.toContain(finalReport);
      }
      await wrapper.get('[data-tab-id="activity"]').trigger("click");
      expect(wrapper.get('[data-test="research-progress"]').text()).toContain(
        expectedLabel
      );

      wrapper.unmount();
    }
  );

  it("renders Research report content and artifacts after success", async () => {
    setActiveRun({
      phase: "succeeded",
      projectionStatus: "SUCCEEDED",
      workStage: "report_assembly",
    });
    setReportMaterial({
      finalReport: "Successful Research report",
      reportStage: "final",
      outputDir: "/obs/bucket/succeeded",
    });
    mocks.state.value = {
      ...mocks.state.value,
      status: "SUCCEEDED",
    };
    const wrapper = mountWorkspace("InSilicoResearchAgent", {
      realArtifactShell: true,
      realBotReportState: true,
    });

    await expectResearchStatusSurfaces(wrapper, "Report ready");
    expect(
      wrapper
        .findAll('[role="tab"]')
        .map((tab) => tab.attributes("data-tab-id"))
    ).toEqual(["content", "evidence", "activity", "downloads"]);
    expect(wrapper.findAll('[role="tabpanel"]')).toHaveLength(4);
    expect(
      wrapper
        .get(".bot-report-state")
        .get('[data-test="bot-report-content"]')
        .text()
    ).toContain("Successful Research report");
    expect(wrapper.find('[data-test="bot-artifact-list"]').exists()).toBe(true);

    wrapper.unmount();
  });

  it.each([
    ["SUCCEEDED", "Report ready", "complete", true],
    ["FAILED", "Failed", "failed", false],
    ["CANCELLED", "Cancelled", "failed", false],
    ["TIMED_OUT", "Timed out", "failed", false],
  ] as const)(
    "uses a live %s Research snapshot for the report body and downloads",
    async (snapshotPhase, label, reportState, successful) => {
      setActiveRun({
        phase: "running",
        projectionStatus: "RUNNING",
        workStage: "report_assembly",
      });
      setReportMaterial({
        finalReport: `Live ${snapshotPhase} Research report`,
        reportStage: "final",
        outputDir: `/obs/bucket/live-${snapshotPhase.toLowerCase()}`,
      });
      mocks.lifecycleSnapshot.value = lifecycle(snapshotPhase);
      const wrapper = mountWorkspace("InSilicoResearchAgent", {
        realArtifactShell: true,
        realBotArtifactList: true,
        realBotReportState: true,
      });

      await expectResearchStatusSurfaces(wrapper, label);
      const report = wrapper.get(".bot-report-state");
      expect(report.attributes("data-report-status")).toBe(reportState);
      expect(report.find('[data-test="bot-report-content"]').exists()).toBe(
        successful
      );
      expect(wrapper.find(".bot-artifact-list").exists()).toBe(true);
      expect(
        wrapper.findAll('button[data-test="bot-artifact-download"]')
      ).toHaveLength(successful ? 1 : 0);
      if (successful) {
        expect(report.text()).toContain(
          `Live ${snapshotPhase} Research report`
        );
      } else {
        expect(report.text()).not.toContain(
          `Live ${snapshotPhase} Research report`
        );
        expect(wrapper.text()).not.toContain("Report ready");
        expect(wrapper.text()).not.toContain("Finished");
      }

      wrapper.unmount();
    }
  );

  it("keeps Analyst active report and artifact rendering unchanged", async () => {
    setActiveRun({ workStage: "report_assembly" });
    setReportMaterial({
      finalReport: "Active Analyst report",
      reportStage: "final",
      agent: "AnalystAgent",
      outputDir: "/obs/bucket/analyst",
    });
    const wrapper = mountWorkspace("AnalystAgent", {
      realArtifactShell: true,
      realBotReportState: true,
    });

    expect(wrapper.get(".research-artifact-header__status").text()).toBe(
      "Analysis run in progress"
    );
    expect(
      wrapper
        .get(".bot-report-state")
        .get('[data-test="bot-report-content"]')
        .text()
    ).toContain("Active Analyst report");
    expect(wrapper.find('[data-test="bot-artifact-list"]').exists()).toBe(true);
    expect(
      wrapper
        .findAll('[role="tab"]')
        .map((tab) => tab.attributes("data-tab-id"))
    ).toEqual(["content", "evidence", "activity", "downloads"]);
    await wrapper.get('[data-tab-id="activity"]').trigger("click");
    expect(wrapper.get('[data-test="analyst-progress"]').text()).toBe(
      "Analysis run in progress"
    );

    wrapper.unmount();
  });

  it("offers request cancellation while a Research run is active", () => {
    setActiveRun({
      phase: "running",
      projectionStatus: "RUNNING",
      workStage: "execution",
    });
    const wrapper = mountWorkspace("InSilicoResearchAgent");

    expect(wrapper.find('[data-test="research-cancel"]').exists()).toBe(true);
    expect(mocks.cancel).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("offers cancellation only while the Research submit request is in flight", async () => {
    let resolveSubmit: ((value: null) => void) | undefined;
    mocks.submit.mockImplementationOnce(
      () =>
        new Promise<null>((resolveSubmitPromise) => {
          resolveSubmit = resolveSubmitPromise;
        })
    );
    const wrapper = mountWorkspace("InSilicoResearchAgent");

    await wrapper
      .get('[data-testid="research-query"]')
      .setValue("Resolve this full paper input");
    await wrapper.get('[data-testid="research-submit"]').trigger("click");

    const cancel = wrapper.find('[data-test="research-cancel"]');
    const cancelVisible = cancel.exists();
    if (cancelVisible) await cancel.trigger("click");
    const abortCalled = mocks.cancel.mock.calls.length === 1;

    resolveSubmit?.(null);
    await flushPromises();
    wrapper.unmount();

    expect(cancelVisible).toBe(true);
    expect(abortCalled).toBe(true);
  });

  it.each([
    ["submitting", "PENDING", null, false, "Preparing"],
    ["running", "PENDING", null, true, "Preparing"],
    ["running", "QUEUED", null, true, "Preparing"],
    ["running", "RUNNING", "input_resolution", true, "Resolving inputs"],
    ["running", "RUNNING", "planning", true, "Planning tasks"],
    ["running", "RUNNING", "execution", true, "Running"],
    ["running", "RUNNING", "report_assembly", true, "Finalizing"],
    ["running", "RUNNING", null, true, "Running"],
  ] as const)(
    "maps the initial Research run phase=%s status=%s stage=%s projection=%s to %s",
    (phase, projectionStatus, workStage, includeProjection, label) => {
      setActiveRun({
        phase,
        projectionStatus,
        workStage,
        includeProjection,
      });
      const wrapper = mountWorkspace("InSilicoResearchAgent", {
        realArtifactShell: true,
      });

      expect(wrapper.get(".research-artifact-header__status").text()).toBe(
        label
      );

      wrapper.unmount();
    }
  );

  it("renders local Research cancellation as authoritative across every status surface", async () => {
    setActiveRun({
      phase: "cancelled",
      projectionStatus: "CANCELLED",
      workStage: "report_assembly",
    });
    mocks.state.value = {
      ...mocks.state.value,
      status: "FAILED",
      degraded: true,
      failures: ["analysis task cancelled"],
    };
    mocks.lifecycleSnapshot.value = lifecycle("FINALIZING");
    const wrapper = mountWorkspace("InSilicoResearchAgent", {
      realArtifactShell: true,
      realBotReportState: true,
    });

    await expectResearchStatusSurfaces(wrapper, "Cancelled");
    expect(wrapper.text()).not.toContain(
      "The report is partial because some analysis was unavailable."
    );
    expect(wrapper.text()).not.toContain("Finalizing");
    expect(wrapper.text()).not.toContain("Failed");

    wrapper.unmount();
  });

  it("renders hydrated Research cancellation ahead of its retained work stage", async () => {
    setActiveRun({
      phase: "running",
      projectionStatus: "CANCELLED",
      workStage: "report_assembly",
    });
    mocks.state.value = {
      ...mocks.state.value,
      status: "FAILED",
    };
    const wrapper = mountWorkspace("InSilicoResearchAgent", {
      realArtifactShell: true,
      realBotReportState: true,
    });

    await expectResearchStatusSurfaces(wrapper, "Cancelled");
    expect(wrapper.text()).not.toContain("Finalizing");
    expect(wrapper.text()).not.toContain("Failed");

    wrapper.unmount();
  });

  it("keeps a live CANCELLED Research snapshot authoritative", async () => {
    setActiveRun({
      phase: "running",
      projectionStatus: "RUNNING",
      workStage: "report_assembly",
    });
    mocks.lifecycleSnapshot.value = lifecycle("CANCELLED");
    const wrapper = mountWorkspace("InSilicoResearchAgent", {
      realArtifactShell: true,
      realBotReportState: true,
    });

    await expectResearchStatusSurfaces(wrapper, "Cancelled");
    expect(wrapper.text()).not.toContain("Finalizing");
    expect(wrapper.text()).not.toContain("Failed");

    wrapper.unmount();
  });

  it("keeps hydrated Research timeout ahead of a stale CANCELLED snapshot", async () => {
    setActiveRun({
      phase: "timed_out",
      projectionStatus: "CANCELLED",
    });
    mocks.state.value = {
      ...mocks.state.value,
      status: "TIMED_OUT",
    };
    mocks.lifecycleSnapshot.value = lifecycle("CANCELLED");
    const wrapper = mountWorkspace("InSilicoResearchAgent", {
      realArtifactShell: true,
      realBotReportState: true,
    });

    await expectResearchStatusSurfaces(wrapper, "Timed out");
    expect(wrapper.text()).not.toContain("Cancelled");

    wrapper.unmount();
  });

  it.each([
    ["initial projection", "projection"],
    ["live lifecycle snapshot", "snapshot"],
    ["hydrated history state", "history"],
  ] as const)(
    "renders a timed-out Research %s across every status surface",
    async (_name, source) => {
      setActiveRun({
        phase: source === "history" ? "timed_out" : "running",
        projectionStatus: source === "projection" ? "TIMED_OUT" : "RUNNING",
        workStage: "report_assembly",
        includeProjection: source !== "history",
      });
      mocks.state.value = {
        ...mocks.state.value,
        status: source === "history" ? "TIMED_OUT" : "RUNNING",
      };
      if (source === "snapshot") {
        mocks.lifecycleSnapshot.value = lifecycle("TIMED_OUT");
      }
      const wrapper = mountWorkspace("InSilicoResearchAgent", {
        realArtifactShell: true,
        realBotReportState: true,
      });

      await expectResearchStatusSurfaces(wrapper, "Timed out");
      expect(wrapper.find('[data-test="bot-report-empty"]').exists()).toBe(
        false
      );
      expect(wrapper.text()).not.toContain("not available yet");
      expect(wrapper.text()).not.toContain("Finalizing");
      expect(wrapper.text()).not.toContain("Failed");
      expect(wrapper.text()).not.toContain("Report ready");

      wrapper.unmount();
    }
  );

  it.each([
    ["succeeded", "SUCCEEDED", "Report ready"],
    ["failed", "FAILED", "Failed"],
    ["cancelled", "CANCELLED", "Cancelled"],
  ] as const)(
    "keeps committed Research %s ahead of a stale TIMED_OUT snapshot",
    async (phase, status, label) => {
      setActiveRun({
        phase,
        projectionStatus: status,
        workStage: "report_assembly",
      });
      mocks.state.value = {
        ...mocks.state.value,
        status: status === "CANCELLED" ? "FAILED" : status,
      };
      mocks.lifecycleSnapshot.value = lifecycle("TIMED_OUT");
      const wrapper = mountWorkspace("InSilicoResearchAgent", {
        realArtifactShell: true,
        realBotReportState: true,
      });

      await expectResearchStatusSurfaces(wrapper, label);
      expect(wrapper.text()).not.toContain("Timed out");

      wrapper.unmount();
    }
  );

  it.each([
    ["succeeded", "SUCCEEDED", "Report ready"],
    ["failed", "FAILED", "Failed"],
  ] as const)(
    "keeps committed Research %s ahead of a stale CANCELLED snapshot",
    async (phase, status, label) => {
      setActiveRun({
        phase,
        projectionStatus: status,
        workStage: "report_assembly",
      });
      mocks.state.value = {
        ...mocks.state.value,
        status,
      };
      mocks.lifecycleSnapshot.value = lifecycle("CANCELLED");
      const wrapper = mountWorkspace("InSilicoResearchAgent", {
        realArtifactShell: true,
        realBotReportState: true,
      });

      await expectResearchStatusSurfaces(wrapper, label);
      expect(wrapper.text()).not.toContain("Cancelled");

      wrapper.unmount();
    }
  );

  it("keeps the Analyst shell and activity on the existing generic progress label", async () => {
    setActiveRun({ workStage: "report_assembly" });
    mocks.lifecycleSnapshot.value = lifecycle("FINALIZING");
    const wrapper = mountWorkspace("AnalystAgent", {
      realArtifactShell: true,
    });

    expect(wrapper.get(".research-artifact-header__status").text()).toBe(
      "Analysis run in progress"
    );
    await wrapper.get('[data-tab-id="activity"]').trigger("click");
    expect(wrapper.get('[data-test="analyst-progress"]').text()).toBe(
      "Analysis run in progress"
    );
    expect(wrapper.text()).not.toContain("Finalizing");

    wrapper.unmount();
  });

  it.each([
    ["succeeded", "SUCCEEDED", false, "Report ready"],
    ["failed", "FAILED", false, "Failed"],
    [
      "running",
      "RUNNING",
      true,
      "The report is partial because some analysis was unavailable.",
    ],
  ] as const)(
    "preserves the Research %s terminal or degraded status",
    async (phase, status, degraded, label) => {
      setActiveRun({
        phase,
        projectionStatus: status,
        workStage: "report_assembly",
      });
      mocks.state.value = {
        ...mocks.state.value,
        status,
        degraded,
      };
      mocks.lifecycleSnapshot.value = lifecycle("FINALIZING");
      const wrapper = mountWorkspace("InSilicoResearchAgent", {
        realArtifactShell: true,
        realBotReportState: true,
      });

      expect(wrapper.get(".research-artifact-header__status").text()).toBe(
        label
      );
      await wrapper.get('[data-tab-id="activity"]').trigger("click");
      expect(wrapper.get('[data-test="research-progress"]').text()).toContain(
        label
      );

      wrapper.unmount();
    }
  );

  it("retains the existing 4000-character limit for Analyst", async () => {
    const wrapper = mountWorkspace();

    await wrapper
      .get('[data-testid="analyst-query"]')
      .setValue("x".repeat(4001));
    await wrapper.get('[data-testid="analyst-submit"]').trigger("click");

    expect(mocks.submit).not.toHaveBeenCalled();
    expect(wrapper.get('[data-test="analyst-form-error"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("renders the negotiated Analyst upload limits in English", () => {
    const wrapper = mountWorkspace();

    expect(wrapper.get("input[type=file] + .analysis-agent-hint").text()).toBe(
      "Attach supported documents or biological data, up to 64 files and 10.0 GB each."
    );
    wrapper.unmount();
  });

  it("renders changed Research upload limits in Chinese", () => {
    Object.assign(mocks.uploadCapability.value, {
      max_file_bytes: 5 * 1024 * 1024 * 1024,
      max_attachments: 32,
    });
    const wrapper = mountWorkspace("InSilicoResearchAgent", {
      locale: "zh-CN",
    });

    const hint = wrapper.get("input[type=file] + .analysis-agent-hint").text();
    expect(hint).toContain("32");
    expect(hint).toContain("5.0 GB");
    expect(hint).not.toMatch(/\{(?:maxFiles|maxFileSize)\}/);
    wrapper.unmount();
  });

  it("queues files from one purpose-free attach control", async () => {
    const wrapper = mountWorkspace();
    const input = wrapper.get<HTMLInputElement>('[data-test="analyst-files"]');
    const file = new File(["counts"], "counts.csv", { type: "text/csv" });
    Object.defineProperty(input.element, "files", {
      configurable: true,
      value: [file],
    });

    await input.trigger("change");

    expect(wrapper.findAll('[data-test="analyst-files"]')).toHaveLength(1);
    expect(wrapper.findAll("textarea")).toHaveLength(1);
    expect(wrapper.findAll('input:not([type="file"])')).toHaveLength(0);
    expect(input.attributes("type")).toBe("file");
    expect(mocks.uploadOptions?.uploadCapability?.value.max_attachments).toBe(
      64
    );
    expect(input.attributes("accept")).toBeUndefined();
    expect(mocks.uploadQueue.queueFiles).toHaveBeenCalledWith([file]);
    wrapper.unmount();
  });

  it("routes shared chip lifecycle actions to the existing upload queue", async () => {
    const item = completedUpload("upload-active", "reads.fastq.gz");
    mocks.chatState.fileList = [
      { ...item, status: "uploading", loadedBytes: 3 },
    ];
    const wrapper = mountWorkspace();

    await wrapper.get('[data-testid="attachment-chip"]').trigger("click");
    await wrapper
      .get('[data-testid="attachment-chip-detail-pause"]')
      .trigger("click");
    await wrapper
      .get('[data-testid="attachment-chip-detail-cancel"]')
      .trigger("click");
    await wrapper
      .get('[data-testid="attachment-chip-detail-remove"]')
      .trigger("click");

    expect(mocks.uploadQueue.pauseUpload).toHaveBeenCalledWith("upload-active");
    expect(mocks.uploadQueue.cancelUpload).toHaveBeenCalledWith(
      "upload-active"
    );
    expect(mocks.uploadQueue.removeUploadById).toHaveBeenCalledWith(
      "upload-active"
    );
    wrapper.unmount();
  });

  it("keeps resume, retry, and reselect wired through the shared strip", async () => {
    const item = completedUpload("upload-paused", "reads.fastq.gz");
    mocks.chatState.fileList = [{ ...item, status: "paused" }];
    let wrapper = mountWorkspace();

    await wrapper.get('[data-testid="attachment-chip"]').trigger("click");
    await wrapper
      .get('[data-testid="attachment-chip-detail-resume"]')
      .trigger("click");
    expect(mocks.uploadQueue.resumeUpload).toHaveBeenCalledWith(
      "upload-paused"
    );
    wrapper.unmount();

    mocks.chatState.fileList = [
      { ...item, localId: "upload-failed", status: "failed", file: null },
    ];
    wrapper = mountWorkspace();
    await wrapper.get('[data-testid="attachment-chip"]').trigger("click");
    await wrapper
      .get('[data-testid="attachment-chip-detail-retry"]')
      .trigger("click");
    await wrapper
      .get('[data-testid="attachment-chip-detail-reselect"]')
      .trigger("click");

    const replacement = new File(["replacement"], "replacement.fastq.gz", {
      type: "application/gzip",
    });
    const input = wrapper.get<HTMLInputElement>(
      '[data-testid="attachment-chip-reselect-input"]'
    );
    Object.defineProperty(input.element, "files", {
      configurable: true,
      value: [replacement],
    });
    await input.trigger("change");

    expect(mocks.uploadQueue.retryUpload).toHaveBeenCalledWith("upload-failed");
    expect(mocks.uploadQueue.reselectUpload).toHaveBeenCalledWith(
      "upload-failed",
      replacement
    );
    wrapper.unmount();
  });

  it("announces a duplicate and focuses the retained workspace item", async () => {
    const wrapper = mountWorkspace();

    mocks.uploadOptions?.onDuplicate?.("upload-existing", "counts.csv");
    await flushPromises();

    expect(
      wrapper.get('[data-testid="attachment-chip-live-region"]').text()
    ).toBe("Already attached: counts.csv");
    expect(wrapper.attributes("data-focused-upload-id")).toBe(
      "upload-existing"
    );
    expect(document.activeElement).toBe(
      wrapper.get('[data-testid="attachment-chip"]').element
    );
    wrapper.unmount();
  });

  it("bounds duplicate and rejection filenames before the live region", async () => {
    const wrapper = mountWorkspace();
    const craftedName = `<${"gene".repeat(40)}>`;

    mocks.uploadOptions?.onDuplicate?.("upload-existing", craftedName);
    await flushPromises();
    const duplicateAnnouncement = wrapper.get(
      '[data-testid="attachment-chip-live-region"]'
    );
    expect(duplicateAnnouncement.text()).not.toContain("<");
    expect(duplicateAnnouncement.text()).not.toContain(">");
    expect(duplicateAnnouncement.text()).toContain("…");
    expect(duplicateAnnouncement.text()).not.toContain("gene".repeat(30));

    mocks.uploadOptions?.onValidationError?.({
      code: "unsupported_type",
      fileName: craftedName,
    });
    await flushPromises();
    const rejectionAnnouncement = wrapper.get(
      '[data-testid="attachment-chip-live-region"]'
    );
    expect(rejectionAnnouncement.text()).not.toContain("<");
    expect(rejectionAnnouncement.text()).not.toContain(">");
    expect(rejectionAnnouncement.text()).toContain("gene");
    expect(rejectionAnnouncement.text()).not.toContain("gene".repeat(30));

    const normalizedName = `\u0000e\u0301e\u0301e\u0301`;
    mocks.uploadOptions?.onDuplicate?.("upload-existing", normalizedName);
    await flushPromises();
    const normalizedAnnouncement = wrapper.get(
      '[data-testid="attachment-chip-live-region"]'
    );
    expect(normalizedAnnouncement.text()).not.toContain("\u0000");
    expect(normalizedAnnouncement.text()).toContain("ééé");
    wrapper.unmount();
  });

  it("clears chips only after a successful submission", async () => {
    mocks.uploadQueue.removeUpload.mockImplementation(async (item) => {
      mocks.chatState.fileList = mocks.chatState.fileList.filter(
        (candidate) => candidate !== item
      );
    });
    const wrapper = mountWorkspace();
    await wrapper.get('[data-testid="analyst-query"]').setValue("Run it");
    await wrapper.get('[data-testid="analyst-submit"]').trigger("click");
    await flushPromises();

    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[data-testid="attachment-chip"]').exists()).toBe(
      false
    );
    expect(mocks.uploadQueue.removeUpload).toHaveBeenCalledWith(
      expect.objectContaining({ localId: "upload-existing" })
    );
    wrapper.unmount();

    mocks.chatState.fileList = [
      completedUpload("upload-failed-submit", "counts.csv"),
    ];
    mocks.submit.mockRejectedValueOnce(new Error("submit failed"));
    const rejected = mountWorkspace();
    await rejected
      .get('[data-testid="analyst-query"]')
      .setValue("Keep this draft");
    await rejected.get('[data-testid="analyst-submit"]').trigger("click");
    await flushPromises();

    expect(
      rejected.get('[data-testid="analyst-query"]').element
    ).toHaveProperty("value", "Keep this draft");
    expect(rejected.find('[data-testid="attachment-chip"]').exists()).toBe(
      true
    );
    expect(mocks.uploadQueue.removeUpload).not.toHaveBeenCalledWith(
      expect.objectContaining({ localId: "upload-failed-submit" })
    );
    rejected.unmount();

    mocks.chatState.fileList = [
      completedUpload("upload-cleanup-failed", "counts.csv"),
    ];
    mocks.submit.mockResolvedValueOnce(null);
    mocks.uploadQueue.removeUpload.mockRejectedValueOnce(
      new Error("cleanup failed")
    );
    const cleanupFailure = mountWorkspace();
    await cleanupFailure
      .get('[data-testid="analyst-query"]')
      .setValue("Keep accepted run");
    await cleanupFailure.get('[data-testid="analyst-submit"]').trigger("click");
    await flushPromises();

    expect(
      cleanupFailure.find('[data-test="analyst-form-error"]').exists()
    ).toBe(false);
    expect(cleanupFailure.get('[data-test="analyst-file-error"]').text()).toBe(
      "Upload failed"
    );
    expect(
      cleanupFailure.find('[data-testid="attachment-chip"]').exists()
    ).toBe(true);
    cleanupFailure.unmount();
  });

  it("keeps the query editable but blocks attachment submission when the Agent has zero channels", async () => {
    mocks.analystCapability.attachmentChannels = [];
    const wrapper = mountWorkspace();

    const query = wrapper.get('[data-testid="analyst-query"]');
    await query.setValue("Keep this draft");

    expect(query.element).toHaveProperty("disabled", false);
    expect(wrapper.get('[data-test="analyst-files"]').element).toHaveProperty(
      "disabled",
      true
    );
    expect(
      wrapper.get('[data-testid="analyst-submit"]').element
    ).toHaveProperty("disabled", true);
    expect(
      wrapper.get('[data-test="analyst-attachment-target-status"]').text()
    ).toBe(
      "This agent can't accept attachments. Remove them or choose a compatible agent."
    );

    await wrapper.get("form.analysis-agent-form").trigger("submit");
    expect(mocks.submit).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("blocks a second submit after acceptance when cleanup leaves chips visible", async () => {
    mocks.submit.mockImplementationOnce(async () => {
      mocks.state.value = {
        ...mocks.state.value,
        phase: "running",
      };
    });
    mocks.uploadQueue.removeUpload.mockRejectedValueOnce(
      new Error("cleanup failed")
    );
    const wrapper = mountWorkspace();

    await wrapper.get('[data-testid="analyst-query"]').setValue("Run once");
    const submit = wrapper.get('[data-testid="analyst-submit"]');
    await submit.trigger("click");
    await flushPromises();

    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(submit.element).toHaveProperty("disabled", true);
    expect(wrapper.find('[data-testid="attachment-chip"]').exists()).toBe(true);

    await submit.trigger("click");
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("renders terminal reports and artifact lists through the shared surface", () => {
    const terminal = {
      ...mocks.state.value,
      phase: "succeeded" as const,
      visibleReport: "Terminal report",
      artifacts: [
        { outputDir: "/obs/bucket/run", paths: ["/obs/bucket/run/report.txt"] },
      ],
    };
    const wrapper = createTestAppContext().mount(RemoteAnalysisAgentWorkspace, {
      props: {
        tool: "AnalystAgent",
        localePrefix: "agents.analyst",
        state: terminal,
      },
      global: {
        stubs: {
          ResearchArtifactShell: {
            template:
              '<section><slot name="content" /><slot name="downloads" /></section>',
          },
          BotReportState: { template: '<div data-test="bot-report-state" />' },
          BotArtifactList: {
            template: '<div data-test="bot-artifact-list" />',
          },
        },
      },
    });

    expect(wrapper.get('[data-test="bot-report-state"]').exists()).toBe(true);
    expect(wrapper.get('[data-test="bot-artifact-list"]').exists()).toBe(true);
    wrapper.unmount();
  });
});
