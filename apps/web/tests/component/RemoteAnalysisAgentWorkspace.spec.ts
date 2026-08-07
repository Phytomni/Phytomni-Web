import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REMOTE_AGENT_PRODUCT_REGISTRY } from "@/constants/agents";
import RemoteAnalysisAgentWorkspace from "@/views/analysis-agent/RemoteAnalysisAgentWorkspace.vue";
import type { BotRemoteAgentRunState } from "@/views/chat/composables/useBotRemoteAgentRun";
import { createTestAppContext } from "../helpers/test-app-context";

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
  const chatState = {
    fileList: [
      {
        assetId: "file_dataset_1234567890",
        purpose: "dataset",
        status: "completed",
      },
    ],
  };
  return {
    state,
    chatState,
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
      removeUploadById: vi.fn(),
      cancelUpload: vi.fn(),
      pauseUpload: vi.fn(),
      resumeUpload: vi.fn(),
      retryUpload: vi.fn(),
      reselectUpload: vi.fn(),
    },
  };
});

vi.mock("@/views/chat/composables/useBotCapabilities", () => ({
  useBotCapabilities: () => ({
    loaded: { value: true },
    byTool: {
      value: {
        AnalystAgent: {
          enabled: true,
          execution: "agent_run",
          attachments: true,
          attachmentPurposes: ["document", "dataset"],
          artifacts: true,
        },
      },
    },
    upload: {
      value: {
        enabled: true,
        max_file_bytes: 10 * 1024 * 1024 * 1024,
        max_attachments: 10,
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
  useResumableUploads: () => mocks.uploadQueue,
}));

vi.mock("@/views/chat/composables/useRemoteAgentLifecycle", () => ({
  useRemoteAgentLifecycle: () => ({ dispose: vi.fn(), reset: vi.fn() }),
}));

vi.mock("vue-router", () => ({
  useRoute: () => ({ query: {} }),
  useRouter: () => ({ back: mocks.routerBack }),
}));

function mountWorkspace() {
  return createTestAppContext().mount(RemoteAnalysisAgentWorkspace, {
    props: { tool: "AnalystAgent", localePrefix: "agents.analyst" },
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

describe("RemoteAnalysisAgentWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    REMOTE_AGENT_PRODUCT_REGISTRY.AnalystAgent.live = true;
    mocks.submit.mockResolvedValue(null);
    mocks.chatState.fileList = [
      {
        assetId: "file_dataset_1234567890",
        purpose: "dataset",
        status: "completed",
      },
    ];
  });

  afterEach(() => {
    REMOTE_AGENT_PRODUCT_REGISTRY.AnalystAgent.live = false;
  });

  it("submits through the shared runner without separate attachment metadata", async () => {
    const wrapper = mountWorkspace();

    expect(wrapper.find("form.analysis-agent-form").exists()).toBe(true);
    expect(
      wrapper.find('[data-test="analyst-attachment-purpose"]').exists()
    ).toBe(false);
    expect(wrapper.find('[data-test="analyst-dataset"]').exists()).toBe(false);
    await wrapper
      .get('[data-testid="analyst-query"]')
      .setValue("Compare groups");
    await wrapper.get('[data-testid="analyst-submit"]').trigger("click");

    expect(mocks.submit).toHaveBeenCalledWith({
      query: "Compare groups",
      attachments: [{ asset_id: "file_dataset_1234567890" }],
    });
    wrapper.unmount();
  });

  it("queues files from one attach control with the transitional placeholder", async () => {
    const wrapper = mountWorkspace();
    const input = wrapper.get<HTMLInputElement>('[data-test="analyst-files"]');
    const file = new File(["counts"], "counts.csv", { type: "text/csv" });
    Object.defineProperty(input.element, "files", {
      configurable: true,
      value: [file],
    });

    await input.trigger("change");

    expect(wrapper.findAll('[data-test="analyst-files"]')).toHaveLength(1);
    expect(mocks.uploadQueue.queueFiles).toHaveBeenCalledWith(
      [file],
      "document"
    );
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
