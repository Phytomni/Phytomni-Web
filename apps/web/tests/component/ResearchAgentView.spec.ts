import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
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
    },
  };
  return {
    state,
    submit: vi.fn().mockResolvedValue(null),
    cancel: vi.fn().mockReturnValue(true),
    reset: vi.fn(),
    load: vi.fn().mockResolvedValue([]),
    getChatState: vi.fn(() => ({})),
  };
});

vi.mock("@/views/chat/composables/useBotRemoteAgentRun", () => ({
  useBotRemoteAgentRun: () => ({
    state: mocks.state,
    submit: mocks.submit,
    cancel: mocks.cancel,
    reset: mocks.reset,
  }),
}));

vi.mock("@/views/chat/composables/useBotCapabilities", () => ({
  useBotCapabilities: () => ({
    loaded: { value: true },
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
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
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
            '<section><slot name="content"/><slot name="evidence"/><slot name="downloads"/></section>',
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
  });

  it("shows a safe degraded report without an invented file link", () => {
    const wrapper = mountView({ state: degradedState() });

    expect(wrapper.get('[data-test="research-degraded"]').exists()).toBe(true);
    expect(wrapper.find('a[href*="task"]').exists()).toBe(false);
  });
});
