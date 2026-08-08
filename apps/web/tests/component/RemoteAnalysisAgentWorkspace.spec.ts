import { flushPromises } from "@vue/test-utils";
import { reactive } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REMOTE_AGENT_PRODUCT_REGISTRY } from "@/constants/agents";
import RemoteAnalysisAgentWorkspace from "@/views/analysis-agent/RemoteAnalysisAgentWorkspace.vue";
import type { BotRemoteAgentRunState } from "@/views/chat/composables/useBotRemoteAgentRun";
import { createTestAppContext } from "../helpers/test-app-context";
import {
  assertUnifiedAttachmentBehaviorTable,
  type RetainedUploadStatus,
  type UnifiedAttachmentSurface,
} from "../helpers/unifiedAttachmentBehavior";

vi.mock("vue-element-plus-x", () => ({
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
  const chatState = { fileList: [] as unknown[] };
  const analystCapability = {
    enabled: true,
    execution: "agent_run",
    attachments: true,
    attachmentChannels: ["document", "dataset"],
    artifacts: true,
  };
  return {
    state,
    chatState,
    analystCapability,
    submit: vi.fn().mockResolvedValue(null),
    cancel: vi.fn(),
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
    upload: {
      value: {
        enabled: true,
        max_file_bytes: 10 * 1024 * 1024 * 1024,
        max_attachments: 64,
      },
    },
    researchInput: {
      value: {
        enabled: true,
        protocol: "research_input_resolution_v1",
        max_user_query_chars: 131072,
        max_attachments_per_request: 64,
        max_research_dataset_paths: 64,
        max_research_input_references: 128,
      },
    },
    load: mocks.load,
  }),
}));

vi.mock("@/views/chat/composables/useBotRemoteAgentRun", () => ({
  useBotRemoteAgentRun: () => ({
    state: mocks.state,
    submit: mocks.submit,
    cancel: mocks.cancel,
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
  useRemoteAgentLifecycle: () => ({ dispose: vi.fn(), reset: vi.fn() }),
}));

vi.mock("vue-router", () => ({
  useRoute: () => ({ query: {} }),
  useRouter: () => ({ back: mocks.routerBack }),
}));

function mountWorkspace(
  tool: "AnalystAgent" | "InSilicoResearchAgent" = "AnalystAgent"
) {
  const research = tool === "InSilicoResearchAgent";
  return createTestAppContext().mount(RemoteAnalysisAgentWorkspace, {
    attachTo: document.body,
    props: {
      tool,
      localePrefix: research ? "agents.research" : "agents.analyst",
    },
    global: {
      stubs: {
        ResearchArtifactShell: {
          template:
            '<section><slot name="content" /><slot name="downloads" /></section>',
        },
        BotReportState: { template: '<div data-test="bot-report-state" />' },
        BotArtifactList: { template: '<div data-test="bot-artifact-list" />' },
      },
    },
  });
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
    mocks.state.value = {
      ...mocks.state.value,
      phase: "idle",
      projection: null,
      degraded: false,
    };
    REMOTE_AGENT_PRODUCT_REGISTRY.AnalystAgent.live = true;
    REMOTE_AGENT_PRODUCT_REGISTRY.InSilicoResearchAgent.live = true;
    mocks.submit.mockResolvedValue(null);
    mocks.chatState.fileList = [
      completedUpload("upload-existing", "counts.csv"),
    ];
    mocks.analystCapability.attachments = true;
    mocks.analystCapability.attachmentChannels = ["document", "dataset"];
  });

  afterEach(() => {
    REMOTE_AGENT_PRODUCT_REGISTRY.AnalystAgent.live = false;
    REMOTE_AGENT_PRODUCT_REGISTRY.InSilicoResearchAgent.live = false;
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
