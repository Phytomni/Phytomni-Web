import { flushPromises } from "@vue/test-utils";
import { nextTick, reactive, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTaskLifecycle } from "@/api/types";
import { REMOTE_AGENT_PRODUCT_REGISTRY } from "@/constants/agents";
import DigitalDesignAgentView from "@/views/digital-design-agent/DigitalDesignAgentView.vue";
import type { BotRunProjection } from "@/views/chat/botProjection";
import type { BotRemoteAgentRunState } from "@/views/chat/composables/useBotRemoteAgentRun";
import type { BotLifecycleState } from "@/views/chat/streaming/botLifecycleReducer";
import { mustGet } from "../helpers/mockFactories";
import { createTestAppContext } from "../helpers/test-app-context";
import {
  assertUnifiedAttachmentBehaviorTable,
  type RetainedUploadStatus,
  type UnifiedAttachmentSurface,
} from "../helpers/unifiedAttachmentBehavior";

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
        DigitalDesignAgent: {
          tool: "DigitalDesignAgent",
          slug: "design",
          execution: "agent_run",
          stream: false,
          a2ui: false,
          resolver: true,
          attachments: true,
          attachmentChannels: ["document", "dataset"],
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
  };
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
  return {
    state,
    capabilities,
    submit: vi.fn().mockResolvedValue(null),
    hydrate: vi.fn(),
    useBotRemoteAgentRun: vi.fn(),
    cancel: vi.fn().mockReturnValue(true),
    reset: vi.fn(),
    load: vi.fn().mockResolvedValue([]),
    chatState,
    uploadQueue,
    uploadOptions: null as {
      onDuplicate?: (localId: string, fileName: string) => void;
      onValidationError?: (error: { code: string; fileName?: string }) => void;
    } | null,
    getChatState: vi.fn(() => chatState),
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

vi.mock("@/views/chat/composables/useResumableUploads", () => ({
  useResumableUploads: (options: {
    onDuplicate?: (localId: string, fileName: string) => void;
    onValidationError?: (error: { code: string; fileName?: string }) => void;
  }) => {
    mocks.uploadOptions = options;
    return mocks.uploadQueue;
  },
}));

vi.mock("@/components/research/ResearchArtifactShell.vue", () => ({
  default: {
    template:
      '<section><button data-test="design-reset" @click="$emit(\'action\')">reset</button><slot name="content"/><slot name="evidence"/><slot name="activity"/><slot name="downloads"/></section>',
  },
}));
vi.mock("@/components/research/BotReportState.vue", () => ({
  default: { template: '<div data-test="bot-report-state" />' },
}));
vi.mock("@/components/research/BotArtifactList.vue", () => ({
  default: { template: '<div data-test="bot-artifact-list" />' },
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({ back: mocks.routerBack }),
  useRoute: () => ({ query: {} }),
}));

function mountView(options: { state?: BotLifecycleState } = {}) {
  return createTestAppContext().mount(DigitalDesignAgentView, {
    attachTo: document.body,
    props: options.state ? { state: options.state } : undefined,
    global: {
      stubs: {
        ResearchArtifactShell: {
          template:
            '<section><button data-test="design-reset" @click="$emit(\'action\')">reset</button><slot name="content"/><slot name="evidence"/><slot name="activity"/><slot name="downloads"/></section>',
        },
        BotReportState: {
          props: ["state"],
          template:
            '<div data-test="bot-report-state"><span v-if="state.degraded" data-test="design-degraded">degraded</span><span data-test="design-report-text">{{ state.visibleReport }}</span></div>',
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
  REMOTE_AGENT_PRODUCT_REGISTRY.DigitalDesignAgent.live = true;
  mocks.capabilities.byTool.value.DigitalDesignAgent = {
    tool: "DigitalDesignAgent",
    slug: "design",
    execution: "agent_run",
    stream: false,
    a2ui: false,
    resolver: true,
    attachments: true,
    attachmentChannels: ["document", "dataset"],
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

function completedUpload(localId: string, name: string) {
  return {
    localId,
    assetId: "file_context",
    name,
    size: 7,
    type: "application/pdf",
    file: null,
    lastModified: 42,
    status: "completed",
    partSize: 7,
    partCount: 1,
    receivedParts: [1],
    loadedBytes: 7,
    speedBytesPerSecond: 0,
    etaSeconds: 0,
    retryCount: 0,
    errorCode: null,
  };
}

function makeUnifiedAttachmentSurface(): UnifiedAttachmentSurface {
  let wrapper: ReturnType<typeof mountView> | null = null;

  const reset = (): void => {
    wrapper?.unmount();
    wrapper = null;
    mocks.uploadOptions = null;
    mocks.chatState.fileList = reactive([]);
    mocks.uploadQueue.hasBlockingUploads.value = false;
    mocks.uploadQueue.completedAssetIds.value = [];
    mocks.capabilities.byTool.value.DigitalDesignAgent = {
      tool: "DigitalDesignAgent",
      slug: "design",
      execution: "agent_run",
      stream: false,
      a2ui: false,
      resolver: true,
      attachments: true,
      attachmentChannels: ["document", "dataset"],
      artifacts: true,
      enabled: true,
    };
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
      const remaining = mocks.chatState.fileList.filter(
        (candidate) => candidate.localId !== item.localId
      );
      mocks.chatState.fileList.splice(
        0,
        mocks.chatState.fileList.length,
        ...remaining
      );
    });
  };

  const setFileList = (items: unknown[]): void => {
    mocks.chatState.fileList.splice(
      0,
      mocks.chatState.fileList.length,
      ...items
    );
  };

  const mountSurface = () => {
    wrapper = mountView();
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

  const fillForm = async (
    current: ReturnType<typeof mountView>,
    query: string
  ) => {
    await current.get('[data-test="design-question"]').setValue(query);
    await current.get('[data-test="design-gene-id"]').setValue("AT1G01010");
    await current.get('[data-test="design-species-code"]').setValue("ath");
  };

  return {
    reset,
    async attach() {
      const current = mountSurface();
      const input = current.get<HTMLInputElement>("[data-test=design-files]");
      const file = new File(["counts"], "counts.csv", { type: "text/csv" });
      Object.defineProperty(input.element, "files", {
        configurable: true,
        value: [file],
      });
      await input.trigger("change");
      return {
        attachActionCount: current.findAll("[data-test=design-files]").length,
        queuedFileCount: mocks.uploadQueue.queueFiles.mock.calls.length,
        purposeFree:
          mocks.uploadQueue.queueFiles.mock.calls[0]?.length === 1 &&
          Array.isArray(mocks.uploadQueue.queueFiles.mock.calls[0]?.[0]) &&
          mocks.uploadQueue.queueFiles.mock.calls[0]?.[0]?.[0] === file,
        purposeControls: current.findAll(
          '[data-test="design-attachment-purpose"]'
        ).length,
        descriptionControls: current.findAll('[data-test="design-dataset"]')
          .length,
      };
    },
    async typingDuringUpload() {
      setFileList([activeUpload("uploading")]);
      const current = mountSurface();
      const query = current.get('[data-test="design-question"]');
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
        setFileList([activeUpload(status)]);
        mocks.uploadQueue.hasBlockingUploads.value = true;
        const current = mountSurface();
        result[status] = Boolean(
          (
            current.get('[data-test="design-submit"]')
              .element as HTMLButtonElement
          ).disabled
        );
      }
      return result;
    },
    async duplicate() {
      setFileList([completedUpload("upload-existing", "counts.csv")]);
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
      setFileList([{ ...item, status: "uploading" }]);
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

      setFileList([{ ...item, status: "paused" }]);
      current = mountSurface();
      await current.get('[data-testid="attachment-chip"]').trigger("click");
      await current
        .get('[data-testid="attachment-chip-detail-resume"]')
        .trigger("click");
      result.resume = mocks.uploadQueue.resumeUpload.mock.calls.length > 0;
      current.unmount();

      setFileList([{ ...item, status: "failed", file: null }]);
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
      setFileList([item]);
      mocks.uploadQueue.completedAssetIds.value = [
        { asset_id: "file_context" },
      ];
      let current = mountSurface();
      await fillForm(current, "Run it");
      await current.get('[data-test="design-submit"]').trigger("click");
      await flushPromises();
      await nextTick();
      const successfulClear = !current
        .find('[data-testid="attachment-chip"]')
        .exists();
      current.unmount();

      const failedItem = completedUpload("upload-failed", "counts.csv");
      setFileList([failedItem]);
      mocks.uploadQueue.removeUpload.mockClear();
      mocks.submit.mockRejectedValueOnce(new Error("submit failed"));
      current = mountSurface();
      await fillForm(current, "Keep draft");
      await current.get('[data-test="design-submit"]').trigger("click");
      await flushPromises();
      const failedPreservation = current
        .find('[data-testid="attachment-chip"]')
        .exists();
      return { successfulClear, failedPreservation };
    },
    async incompatible() {
      mocks.capabilities.byTool.value.DigitalDesignAgent.attachmentChannels =
        [];
      const item = completedUpload("upload-incompatible", "counts.csv");
      setFileList([item]);
      const current = mountSurface();
      const zeroChannelRejected = Boolean(
        (
          current.get('[data-test="design-submit"]')
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

afterEach(() => {
  REMOTE_AGENT_PRODUCT_REGISTRY.DigitalDesignAgent.live = false;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function degradedState(): BotLifecycleState {
  return {
    runId: "run-design",
    status: "RUNNING",
    reportRevision: 1,
    visibleReport: "Partial design report",
    intermediateReport: "Partial design report",
    finalReport: "",
    degraded: true,
    failures: ["Optional design analysis unavailable"],
    artifacts: [],
  };
}

describe("DigitalDesignAgentView", () => {
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
    mocks.chatState.fileList = [];
    mocks.uploadOptions = null;
    mocks.uploadQueue.hasBlockingUploads.value = false;
    mocks.uploadQueue.completedAssetIds.value = [];
  });

  it("applies the shared attachment behavior contract", async () => {
    const surface = makeUnifiedAttachmentSurface();
    await assertUnifiedAttachmentBehaviorTable(surface);
    await surface.reset();
  });

  it("passes the Digital Design tool to the shared product runner", () => {
    const view = mountView();
    expect(view.get('[data-scroll-root="digital-design-agent"]').exists()).toBe(
      true
    );
    expect(mocks.useBotRemoteAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "DigitalDesignAgent" })
    );
    view.unmount();
  });

  it("keeps loading and unavailable Back actions labeled and reachable", async () => {
    mocks.capabilities.loaded.value = false;
    const loading = mountView();
    expect(loading.get('[data-test="design-back"]').text()).toBe("Back");
    await loading.get('[data-test="design-back"]').trigger("click");
    expect(mocks.routerBack).toHaveBeenCalledTimes(1);
    loading.unmount();

    mocks.capabilities.loaded.value = true;
    REMOTE_AGENT_PRODUCT_REGISTRY.DigitalDesignAgent.live = false;
    const unavailable = mountView();
    expect(unavailable.get('[data-test="design-unavailable"]').exists()).toBe(
      true
    );
    expect(unavailable.get('[data-test="design-back"]').text()).toBe("Back");
    await unavailable.get('[data-test="design-back"]').trigger("click");
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

  it("submits structured gene/species resolver values without leaking them into query", async () => {
    mocks.chatState.fileList = [
      completedUpload("upload-context", "context.pdf"),
    ];
    const wrapper = mountView();
    const context = new File(["context"], "context.pdf", {
      type: "application/pdf",
    });

    expect(wrapper.find('[data-testid="attachment-chip-strip"]').exists()).toBe(
      true
    );
    expect(wrapper.find('[data-testid="chat-upload-card"]').exists()).toBe(
      false
    );

    await wrapper
      .get('[data-test="design-question"]')
      .setValue("Design a stable protein");
    await wrapper.get('[data-test="design-gene-id"]').setValue("AT1G01010");
    await wrapper.get('[data-test="design-species-code"]').setValue("ath");
    const fileInput = wrapper.get('[data-test="design-files"]');
    Object.defineProperty(fileInput.element, "files", {
      configurable: true,
      value: [context],
    });
    await fileInput.trigger("change");

    mocks.uploadQueue.completedAssetIds.value = [{ asset_id: "file_context" }];
    expect(mocks.uploadQueue.queueFiles).toHaveBeenCalledWith([context]);
    await wrapper.get("form.digital-design-form").trigger("submit");
    expect(mocks.submit).toHaveBeenCalledWith({
      query: "Design a stable protein",
      attachments: [{ asset_id: "file_context" }],
      resolver: { geneId: "AT1G01010", speciesCode: "ath" },
    });
    expect(mocks.submit.mock.calls[0][0].query).not.toContain("AT1G01010");
    expect(mocks.submit.mock.calls[0][0].query).not.toContain("ath");
    wrapper.unmount();
  });

  it("delegates arbitrary biological formats to the resumable queue", async () => {
    const wrapper = mountView();
    const input = wrapper.get('[data-test="design-files"]');
    const reads = new File(["reads"], "sample.fastq.gz", {
      type: "application/gzip",
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

  it("announces a duplicate and focuses the retained design item", async () => {
    mocks.chatState.fileList = [
      completedUpload("upload-existing", "context.pdf"),
    ];
    const wrapper = mountView();

    mocks.uploadOptions?.onDuplicate?.("upload-existing", "context.pdf");
    await flushPromises();

    expect(
      wrapper.get('[data-testid="attachment-chip-live-region"]').text()
    ).toBe("Already attached: context.pdf");
    expect(wrapper.attributes("data-focused-upload-id")).toBe(
      "upload-existing"
    );
    expect(
      wrapper.find('[data-upload-local-id="upload-existing"]').exists()
    ).toBe(false);
    expect(document.activeElement).toBe(
      wrapper.get('[data-testid="attachment-chip"]').element
    );
    wrapper.unmount();
  });

  it("bounds duplicate and rejection filenames before the live region", async () => {
    const wrapper = mountView();
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

  it("sends completed asset IDs and clears chips only after acceptance", async () => {
    const item = completedUpload("upload-accepted", "context.pdf");
    mocks.chatState.fileList = [item];
    mocks.uploadQueue.completedAssetIds.value = [{ asset_id: "file_context" }];
    const wrapper = mountView();

    await wrapper
      .get('[data-test="design-question"]')
      .setValue("Keep this design draft");
    await wrapper.get('[data-test="design-gene-id"]').setValue("AT1G01010");
    await wrapper.get('[data-test="design-species-code"]').setValue("ath");
    await wrapper.get("form.digital-design-form").trigger("submit");
    await flushPromises();

    expect(mocks.submit).toHaveBeenCalledWith({
      query: "Keep this design draft",
      attachments: [{ asset_id: "file_context" }],
      resolver: { geneId: "AT1G01010", speciesCode: "ath" },
    });
    expect(mocks.uploadQueue.removeUpload).toHaveBeenCalledWith(item);
    wrapper.unmount();

    const failedItem = completedUpload("upload-rejected", "context.pdf");
    mocks.chatState.fileList = [failedItem];
    mocks.uploadQueue.removeUpload.mockClear();
    mocks.submit.mockRejectedValueOnce(new Error("submit failed"));
    const rejected = mountView();
    await rejected
      .get('[data-test="design-question"]')
      .setValue("Keep failed design draft");
    await rejected.get('[data-test="design-gene-id"]').setValue("AT1G01010");
    await rejected.get('[data-test="design-species-code"]').setValue("ath");
    await rejected.get("form.digital-design-form").trigger("submit");
    await flushPromises();

    expect(
      rejected.get('[data-test="design-question"]').element
    ).toHaveProperty("value", "Keep failed design draft");
    expect(mocks.uploadQueue.removeUpload).not.toHaveBeenCalled();
    expect(rejected.find('[data-testid="attachment-chip"]').exists()).toBe(
      true
    );
    rejected.unmount();
  });

  it("keeps file-free runs available when Agent attachments are disabled", async () => {
    mocks.capabilities.byTool.value.DigitalDesignAgent.attachments = false;
    const wrapper = mountView();

    expect(wrapper.get('[data-test="design-files"]').element).toHaveProperty(
      "disabled",
      true
    );
    await wrapper
      .get('[data-test="design-question"]')
      .setValue("Design a protein without an upload");
    await wrapper.get('[data-test="design-gene-id"]').setValue("AT1G01010");
    await wrapper.get('[data-test="design-species-code"]').setValue("ath");
    await wrapper.get("form.digital-design-form").trigger("submit");

    expect(mocks.submit).toHaveBeenCalledWith({
      query: "Design a protein without an upload",
      attachments: [],
      resolver: { geneId: "AT1G01010", speciesCode: "ath" },
    });
    wrapper.unmount();
  });

  it("keeps form fields editable but blocks attachment submission when the Agent has zero channels", async () => {
    mocks.capabilities.byTool.value.DigitalDesignAgent.attachmentChannels = [];
    mocks.chatState.fileList = [
      {
        localId: "upload-incompatible",
        assetId: "file_incompatible",
        name: "counts.csv",
        size: 1,
        type: "text/csv",
        file: null,
        lastModified: 0,
        status: "completed",
        partSize: 1,
        partCount: 1,
        receivedParts: [1],
        loadedBytes: 1,
        speedBytesPerSecond: 0,
        etaSeconds: 0,
        retryCount: 0,
        errorCode: null,
      },
    ];
    const wrapper = mountView();

    const question = wrapper.get('[data-test="design-question"]');
    await question.setValue("Keep this draft");

    expect(question.element).toHaveProperty("disabled", false);
    expect(wrapper.get('[data-test="design-files"]').element).toHaveProperty(
      "disabled",
      true
    );
    expect(wrapper.get('[data-test="design-submit"]').element).toHaveProperty(
      "disabled",
      true
    );
    expect(
      wrapper.get('[data-test="design-attachment-target-status"]').text()
    ).toBe(
      "This agent can't accept attachments. Remove them or choose a compatible agent."
    );

    await wrapper.get("form.digital-design-form").trigger("submit");
    expect(mocks.submit).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("blocks submission while a queued asset is still active", async () => {
    mocks.uploadQueue.hasBlockingUploads.value = true;
    const wrapper = mountView();
    await wrapper
      .get('[data-test="design-question"]')
      .setValue("Design a protein");
    await wrapper.get('[data-test="design-gene-id"]').setValue("AT1G01010");
    await wrapper.get('[data-test="design-species-code"]').setValue("ath");

    expect(wrapper.get('[data-test="design-submit"]').element).toHaveProperty(
      "disabled",
      true
    );
    await wrapper.get("form.digital-design-form").trigger("submit");
    expect(mocks.submit).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("blocks a second submit after an accepted run becomes active", async () => {
    mocks.submit.mockImplementationOnce(async () => {
      mocks.state.value = {
        ...mocks.state.value,
        phase: "running",
        requestId: null,
      };
    });
    const wrapper = mountView();
    await wrapper.get('[data-test="design-question"]').setValue("Run once");
    await wrapper.get('[data-test="design-gene-id"]').setValue("AT1G01010");
    await wrapper.get('[data-test="design-species-code"]').setValue("ath");
    const submit = wrapper.get('[data-test="design-submit"]');

    await submit.trigger("click");
    await flushPromises();

    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(submit.element).toHaveProperty("disabled", true);

    await submit.trigger("click");
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("wires pause, resume, retry, and remove actions to the shared queue", async () => {
    const item = {
      localId: "upload-1",
      file: null,
      assetId: null,
      name: "sample.fastq.gz",
      size: 3,
      type: "application/gzip",
      lastModified: 1,
      status: "uploading",
      partSize: 1,
      partCount: 3,
      receivedParts: [],
      loadedBytes: 1,
      speedBytesPerSecond: 1,
      etaSeconds: 2,
      retryCount: 0,
      errorCode: null,
    };
    mocks.chatState.fileList = [item];
    let wrapper = mountView();
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
    expect(mocks.uploadQueue.pauseUpload).toHaveBeenCalledWith("upload-1");
    expect(mocks.uploadQueue.cancelUpload).toHaveBeenCalledWith("upload-1");
    expect(mocks.uploadQueue.removeUploadById).toHaveBeenCalledWith("upload-1");
    wrapper.unmount();

    mocks.chatState.fileList = [{ ...item, status: "paused" }];
    wrapper = mountView();
    await wrapper.get('[data-testid="attachment-chip"]').trigger("click");
    await wrapper
      .get('[data-testid="attachment-chip-detail-resume"]')
      .trigger("click");
    expect(mocks.uploadQueue.resumeUpload).toHaveBeenCalledWith("upload-1");
    wrapper.unmount();

    mocks.chatState.fileList = [
      { ...item, status: "failed", errorCode: "upload_failed" },
    ];
    wrapper = mountView();
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
    const reselectInput = wrapper.get<HTMLInputElement>(
      '[data-testid="attachment-chip-reselect-input"]'
    );
    Object.defineProperty(reselectInput.element, "files", {
      configurable: true,
      value: [replacement],
    });
    await reselectInput.trigger("change");
    expect(mocks.uploadQueue.retryUpload).toHaveBeenCalledWith("upload-1");
    expect(mocks.uploadQueue.reselectUpload).toHaveBeenCalledWith(
      "upload-1",
      replacement
    );
    wrapper.unmount();
  });

  it("blocks missing or malformed resolver values before transport", async () => {
    const wrapper = mountView();
    await wrapper
      .get('[data-test="design-question"]')
      .setValue("Design a protein");
    await wrapper.get('[data-test="design-gene-id"]').setValue("bad gene");
    await wrapper.get('[data-test="design-species-code"]').setValue("A");
    await wrapper.get("form.digital-design-form").trigger("submit");

    expect(wrapper.get('[data-test="design-validation"]').text()).toContain(
      "gene"
    );
    expect(wrapper.get('[data-test="design-validation"]').text()).toContain(
      "species"
    );
    expect(mocks.submit).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("renders localized validation for empty and oversized values", async () => {
    const wrapper = mountView();
    await wrapper.get("form.digital-design-form").trigger("submit");

    expect(wrapper.get('[data-test="design-form-error"]').text()).toContain(
      "Enter a design question"
    );
    expect(wrapper.get('[data-test="design-validation"]').text()).toContain(
      "gene ID"
    );
    expect(wrapper.get('[data-test="design-validation"]').text()).toContain(
      "species code"
    );
    expect(mocks.submit).not.toHaveBeenCalled();

    await wrapper
      .get('[data-test="design-question"]')
      .setValue("x".repeat(4001));
    await wrapper.get('[data-test="design-gene-id"]').setValue("A".repeat(129));
    await wrapper
      .get('[data-test="design-species-code"]')
      .setValue("a".repeat(33));
    await wrapper.get("form.digital-design-form").trigger("submit");

    expect(wrapper.get('[data-test="design-form-error"]').text()).toContain(
      "too long"
    );
    expect(wrapper.get('[data-test="design-validation"]').text()).toContain(
      "gene ID"
    );
    expect(wrapper.get('[data-test="design-validation"]').text()).toContain(
      "species code"
    );
    expect(mocks.submit).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("does not submit an otherwise-complete capability while the product is dark", async () => {
    REMOTE_AGENT_PRODUCT_REGISTRY.DigitalDesignAgent.live = false;
    const wrapper = mountView();

    expect(wrapper.get('[data-test="design-unavailable"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="design-submit"]').exists()).toBe(false);
    expect(mocks.submit).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("fails closed when the resolver capability is unavailable", async () => {
    mocks.capabilities.byTool.value.DigitalDesignAgent = {
      ...mustGet(
        mocks.capabilities.byTool.value.DigitalDesignAgent,
        "DigitalDesignAgent capability"
      ),
      resolver: false,
    };
    const wrapper = mountView();

    expect(wrapper.get('[data-test="design-unavailable"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="design-submit"]').exists()).toBe(false);
    expect(wrapper.html()).not.toContain("/static/downloads/");
    await Promise.resolve();
    expect(mocks.submit).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("fails closed for disabled execution, attachment, and artifact gates", () => {
    const baseCapability = {
      ...mustGet(
        mocks.capabilities.byTool.value.DigitalDesignAgent,
        "DigitalDesignAgent capability"
      ),
    };

    for (const field of ["enabled", "artifacts"] as const) {
      mocks.capabilities.byTool.value.DigitalDesignAgent = {
        ...baseCapability,
        [field]: false,
      };
      const wrapper = mountView();

      expect(wrapper.get('[data-test="design-unavailable"]').exists()).toBe(
        true
      );
      expect(wrapper.find('[data-test="design-submit"]').exists()).toBe(false);
      wrapper.unmount();
    }

    mocks.capabilities.byTool.value.DigitalDesignAgent = {
      ...baseCapability,
      execution: "chat",
    };
    const wrapper = mountView();
    expect(wrapper.get('[data-test="design-unavailable"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="design-submit"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("renders a degraded state without inventing a task or download link", () => {
    const wrapper = mountView({ state: degradedState() });

    expect(wrapper.get('[data-test="design-degraded"]').exists()).toBe(true);
    expect(wrapper.find('a[href*="task"]').exists()).toBe(false);
    expect(wrapper.html()).not.toContain("/static/downloads/");
    wrapper.unmount();
  });

  it("keeps reset and back controls reachable", async () => {
    const wrapper = mountView({ state: degradedState() });
    await wrapper.get('[data-test="design-back"]').trigger("click");
    await wrapper
      .get('[data-test="design-question"]')
      .setValue("Design a protein");
    await wrapper.get('[data-test="design-gene-id"]').setValue("AT1G01010");
    await wrapper.get('[data-test="design-species-code"]').setValue("ath");
    await wrapper.get('[data-test="design-submit"]').trigger("keydown.enter");
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    await wrapper.get('[data-test="design-reset"]').trigger("click");
    expect(mocks.reset).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("reconciles preparing, running, and terminal design reports after 24 seconds", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const runningProjection: BotRunProjection = {
      runId: "run-design",
      agent: "DigitalDesignAgent",
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
        runId: "run-design",
        phase: "running",
        projection: runningProjection,
        dialogueId: "dialogue-design",
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
            dialogue_id: "dialogue-design",
            tool_name: "DigitalDesignAgent",
            bot_run_id: "run-design",
            status: "RUNNING",
            report_revision: 1,
            answer: JSON.stringify({
              intermediate_report: "Design intermediate",
            }),
          },
        ],
      })
      .mockResolvedValueOnce({
        code: 200,
        data: [
          {
            id: 19,
            dialogue_id: "dialogue-design",
            tool_name: "DigitalDesignAgent",
            bot_run_id: "run-design",
            status: "SUCCEEDED",
            report_revision: 2,
            answer: JSON.stringify({ final_report: "Design final" }),
            download_path: "/obs/bucket/design",
          },
        ],
      });

    const wrapper = mountView();
    await wrapper
      .get('[data-test="design-question"]')
      .setValue("Design a stable protein");
    await wrapper.get('[data-test="design-gene-id"]').setValue("AT1G01010");
    await wrapper.get('[data-test="design-species-code"]').setValue("ath");
    await wrapper.get("form.digital-design-form").trigger("submit");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(wrapper.get('[data-test="design-report-text"]').text()).toBe(
      "Design intermediate"
    );

    await vi.advanceTimersByTimeAsync(1000);
    expect(wrapper.get('[data-test="design-report-text"]').text()).toBe(
      "Design final"
    );
    expect(wrapper.get('[data-test="bot-artifact-list"]').text()).toContain(
      "/obs/bucket/design"
    );
    wrapper.unmount();
  });
});
