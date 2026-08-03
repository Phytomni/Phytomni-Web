import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REMOTE_AGENT_PRODUCT_REGISTRY } from "@/constants/agents";
import AnalystAgentView from "@/views/analyst-agent/AnalystAgentView.vue";
import { createTestAppContext } from "../../helpers/test-app-context";

const mocks = vi.hoisted(() => {
  const state = {
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
  return {
    state,
    load: vi.fn().mockResolvedValue([]),
    submit: vi.fn().mockResolvedValue(null),
    cancel: vi.fn(),
    reset: vi.fn(),
    dispose: vi.fn(),
    routerBack: vi.fn(),
    useBotRemoteAgentRun: vi.fn(() => ({
      state,
      submit: mocks.submit,
      cancel: mocks.cancel,
      reset: mocks.reset,
    })),
    uploadQueue: {
      completedAssetIds: { value: [] },
      hasBlockingUploads: { value: false, __v_isRef: true },
      queueFiles: vi.fn(),
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

vi.mock("vue-router", () => ({
  useRoute: () => ({ query: { dialogue_id: "analyst-demo-test" } }),
  useRouter: () => ({ back: mocks.routerBack }),
}));

vi.mock("vue-element-plus-x", () => ({
  Typewriter: { name: "Typewriter", template: "<div />" },
}));

vi.mock("@/views/chat/composables/useBotCapabilities", () => ({
  useBotCapabilities: () => ({
    loaded: { value: true },
    byTool: {
      value: {
        AnalystAgent: {
          enabled: true,
          execution: "agent_run",
          attachments: true,
          attachmentPurposes: ["document"],
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
  useBotRemoteAgentRun: mocks.useBotRemoteAgentRun,
}));

vi.mock("@/views/chat/composables/useChatStates", () => ({
  useChatStates: () => ({ getChatState: () => ({ fileList: [] }) }),
}));

vi.mock("@/views/chat/composables/useResumableUploads", () => ({
  useResumableUploads: () => mocks.uploadQueue,
}));

vi.mock("@/views/chat/composables/useRemoteAgentLifecycle", () => ({
  useRemoteAgentLifecycle: () => ({ dispose: mocks.dispose, reset: vi.fn() }),
}));

function mountAgent() {
  return createTestAppContext().mount(AnalystAgentView);
}

describe("Analyst Agent remote workspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    REMOTE_AGENT_PRODUCT_REGISTRY.AnalystAgent.live = false;
  });

  afterEach(() => {
    REMOTE_AGENT_PRODUCT_REGISTRY.AnalystAgent.live = false;
  });

  it("keeps the default-off Analyst product unavailable despite a granted capability", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const wrapper = mountAgent();

    expect(wrapper.get('[data-test="analyst-unavailable"]').exists()).toBe(
      true
    );
    expect(wrapper.find("form.analysis-agent-form").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("Static example");
    expect(wrapper.text()).not.toContain("callpeak_results.zip");
    expect(mocks.useBotRemoteAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: "AnalystAgent",
        dialogueId: "analyst-demo-test",
      })
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    wrapper.unmount();
  });

  it("keeps the guarded remote workspace Back control wired to the router", async () => {
    const wrapper = mountAgent();

    await wrapper.get('[data-test="analyst-back"]').trigger("click");

    expect(mocks.dispose).toHaveBeenCalledTimes(1);
    expect(mocks.routerBack).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });
});
