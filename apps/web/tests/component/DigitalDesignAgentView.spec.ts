import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REMOTE_AGENT_PRODUCT_REGISTRY } from "@/constants/agents";
import DigitalDesignAgentView from "@/views/digital-design-agent/DigitalDesignAgentView.vue";
import type { BotLifecycleState } from "@/views/chat/streaming/botLifecycleReducer";
import { mustGet } from "../helpers/mockFactories";
import { createTestAppContext } from "../helpers/test-app-context";

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
    useBotRemoteAgentRun: vi.fn(),
    cancel: vi.fn().mockReturnValue(true),
    reset: vi.fn(),
    load: vi.fn().mockResolvedValue([]),
    chatState,
    uploadQueue,
    getChatState: vi.fn(() => chatState),
    getChatdownloadURL: vi.fn(),
    routerBack: vi.fn(),
  };
});

vi.mock("@/api/chat", () => ({
  getChatdownloadURL: mocks.getChatdownloadURL,
}));

vi.mock("@/views/chat/composables/useBotCapabilities", () => ({
  useBotCapabilities: () => mocks.capabilities,
}));

vi.mock("@/views/chat/composables/useBotRemoteAgentRun", () => ({
  useBotRemoteAgentRun: mocks.useBotRemoteAgentRun,
}));

mocks.useBotRemoteAgentRun.mockImplementation(() => ({
  state: mocks.state,
  submit: mocks.submit,
  cancel: mocks.cancel,
  reset: mocks.reset,
}));

vi.mock("@/views/chat/composables/useChatStates", () => ({
  useChatStates: () => ({ getChatState: mocks.getChatState }),
}));

vi.mock("@/views/chat/composables/useResumableUploads", () => ({
  useResumableUploads: () => mocks.uploadQueue,
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
            '<div data-test="bot-report-state"><span v-if="state.degraded" data-test="design-degraded">degraded</span></div>',
        },
        BotArtifactList: {
          template: '<div data-test="bot-artifact-list" />',
        },
      },
    },
  });
}

function resetState(): void {
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
    artifacts: true,
    enabled: true,
  };
}

afterEach(() => {
  REMOTE_AGENT_PRODUCT_REGISTRY.DigitalDesignAgent.live = false;
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
      cancel: mocks.cancel,
      reset: mocks.reset,
    }));
    resetState();
    mocks.submit.mockResolvedValue(null);
    mocks.capabilities.load.mockResolvedValue([]);
    mocks.chatState.fileList = [];
    mocks.uploadQueue.hasBlockingUploads.value = false;
    mocks.uploadQueue.completedAssetIds.value = [];
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
    const wrapper = mountView();
    const context = new File(["context"], "context.pdf", {
      type: "application/pdf",
    });

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
    await wrapper.get('[data-testid="chat-upload-pause"]').trigger("click");
    await wrapper.get('[data-testid="chat-upload-remove"]').trigger("click");
    expect(mocks.uploadQueue.pauseUpload).toHaveBeenCalledWith("upload-1");
    expect(mocks.uploadQueue.removeUploadById).toHaveBeenCalledWith("upload-1");
    wrapper.unmount();

    mocks.chatState.fileList = [{ ...item, status: "paused" }];
    wrapper = mountView();
    await wrapper.get('[data-testid="chat-upload-resume"]').trigger("click");
    expect(mocks.uploadQueue.resumeUpload).toHaveBeenCalledWith("upload-1");
    wrapper.unmount();

    mocks.chatState.fileList = [
      { ...item, status: "failed", errorCode: "upload_failed" },
    ];
    wrapper = mountView();
    await wrapper.get('[data-testid="chat-upload-retry"]').trigger("click");
    expect(mocks.uploadQueue.retryUpload).toHaveBeenCalledWith("upload-1");
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
});
