import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DigitalDesignAgentView from "@/views/digital-design-agent/DigitalDesignAgentView.vue";
import GeneNetworkAgentView from "@/views/gene-network-agent/GeneNetworkAgentView.vue";
import ResearchAgentView from "@/views/research-agent/ResearchAgentView.vue";
import { REMOTE_AGENT_PRODUCT_REGISTRY } from "@/constants/agents";
import {
  parseBotProjection,
  type BotRunProjection,
} from "@/views/chat/botProjection";
import type { BotRemoteAgentRunState } from "@/views/chat/composables/useBotRemoteAgentRun";
import {
  initBotLifecycleState,
  reduceBotProjection,
} from "@/views/chat/streaming/botLifecycleReducer";
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
    cancel: vi.fn().mockReturnValue(true),
    reset: vi.fn(),
    chatState,
    uploadQueue,
    getChatState: vi.fn(() => chatState),
    getChatdownloadURL: vi.fn(),
    routerBack: vi.fn(),
    getAnswerCheck: vi.fn().mockResolvedValue({ code: 200, data: [] }),
  };
});

vi.mock("@/api/chat", () => ({
  getAnswerCheck: mocks.getAnswerCheck,
  getChatdownloadURL: mocks.getChatdownloadURL,
}));

vi.mock("@/components/MarkdownViewer.vue", () => ({
  default: {
    props: ["content"],
    template: '<article data-test="report-markdown">{{ content }}</article>',
  },
}));

vi.mock("@/views/chat/composables/useBotCapabilities", () => ({
  useBotCapabilities: () => mocks.capabilities,
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
  useChatStates: () => ({ getChatState: mocks.getChatState }),
}));

vi.mock("@/views/chat/composables/useResumableUploads", () => ({
  useResumableUploads: () => mocks.uploadQueue,
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({ back: mocks.routerBack }),
  useRoute: () => ({ query: {} }),
}));

const surfaces = {
  research: ResearchAgentView,
  design: DigitalDesignAgentView,
  network: GeneNetworkAgentView,
} as const;

const products = {
  research: REMOTE_AGENT_PRODUCT_REGISTRY.InSilicoResearchAgent,
  design: REMOTE_AGENT_PRODUCT_REGISTRY.DigitalDesignAgent,
  network: REMOTE_AGENT_PRODUCT_REGISTRY.GeneNetworkAgent,
} as const;

type TerminalFixture = {
  fixture_id: string;
  run_id: string;
  agent: string;
  status: string;
  result: {
    report_stage?: string;
    report_completeness?: string;
    report_revision?: number;
    report_updated_at?: string;
    intermediate_report?: string;
    final_report?: string;
    formatted?: { answer?: string };
    progress?: Record<string, unknown>;
    degraded?: boolean;
    degraded_reason?: string;
    failures?: unknown[];
    artifacts?: Array<{ output_dir?: string; paths?: string[] }>;
  };
};

const PRODUCT_FIXTURE_ROOT = resolve(
  __dirname,
  "../../../server/external/bot/testdata/head"
);

const PRODUCT_FIXTURE_MATRIX = [
  {
    surface: "research" as const,
    fixture: "research_terminal.json",
    fixtureId: "rc-web-004-research-terminal",
    agent: "research",
    report: "# Research terminal report",
    downloads: 2,
    warning: false,
  },
  {
    surface: "design" as const,
    fixture: "design_terminal.json",
    fixtureId: "rc-web-004-design-terminal",
    agent: "design",
    report: "# Design terminal answer",
    downloads: 0,
    warning: true,
  },
  {
    surface: "network" as const,
    fixture: "network_terminal.json",
    fixtureId: "rc-web-004-network-terminal",
    agent: "network",
    report: "# Network terminal report",
    downloads: 0,
    warning: true,
  },
] as const;

function readProductFixture(fileName: string): TerminalFixture {
  return JSON.parse(
    readFileSync(resolve(PRODUCT_FIXTURE_ROOT, fileName), "utf8")
  ) as TerminalFixture;
}

/**
 * Integration-boundary fixture: the checked-in Bot HEAD payloads intentionally
 * pass through the production wire decoder and lifecycle reducer before the
 * shared product surfaces are mounted. Parser and reducer behavior is owned by
 * their unit suites; the matrix below keeps literal report/download/warning
 * expectations as the independent surface oracle.
 */
function stateFromProductFixture(
  fixture: TerminalFixture
): BotRemoteAgentRunState {
  const result = fixture.result;
  const projection = parseBotProjection({
    bot_run_id: fixture.run_id,
    agent: fixture.agent,
    status: fixture.status,
    report_stage: result.report_stage,
    report_completeness: result.report_completeness,
    report_revision: result.report_revision,
    report_updated_at: result.report_updated_at,
    intermediate_report: result.intermediate_report,
    final_report: result.final_report,
    answer: result.formatted?.answer,
    progress: result.progress,
    degraded: result.degraded,
    degraded_reason: result.degraded_reason,
    failures: result.failures,
    artifacts: result.artifacts,
  });
  const lifecycle = reduceBotProjection(initBotLifecycleState(), projection);
  return {
    ...lifecycle,
    phase: "succeeded",
    requestId: null,
    uploadTransfer: null,
    projection,
    dialogueId: fixture.fixture_id,
    messageId: fixture.run_id,
    error: null,
  };
}

function syntheticDegradedState(): BotRemoteAgentRunState {
  const projection: BotRunProjection = {
    runId: "run-synthetic",
    agent: "SyntheticAgent",
    status: "RUNNING",
    reportStage: "intermediate",
    reportCompleteness: "partial",
    reportRevision: 1,
    reportUpdatedAt: "2026-07-16T08:30:00.000Z",
    reportPresentation: true,
    intermediateReport: "Synthetic report",
    finalReport: "",
    progress: {
      completed: 2,
      total: 4,
      failed: 0,
      pending: 2,
      briefGeneStatus: "running",
    },
    degraded: true,
    degradedReason: "Optional analysis unavailable",
    failures: ["Optional analysis unavailable"],
    artifacts: [
      {
        outputDir: "/obs/synthetic-bucket/root",
        paths: [
          "/obs/synthetic-bucket/root/report.txt",
          "/obs/synthetic-bucket/root/../secret.txt",
        ],
      },
    ],
    requestId: "request-synthetic",
    trackingDegraded: false,
  };

  return {
    runId: "run-synthetic",
    status: "RUNNING",
    reportRevision: 1,
    visibleReport: "Synthetic report",
    intermediateReport: "Synthetic report",
    finalReport: "",
    degraded: true,
    failures: ["Optional analysis unavailable"],
    artifacts: projection.artifacts,
    phase: "running",
    requestId: "request-synthetic",
    uploadTransfer: null,
    projection,
    dialogueId: "surface-matrix",
    messageId: "message-synthetic",
    error: null,
  };
}

function syntheticFailureState(): BotRemoteAgentRunState {
  const degradedState = syntheticDegradedState();
  const projection: BotRunProjection = {
    ...mustGet(degradedState.projection, "synthetic degraded projection"),
    status: "TIMED_OUT",
    reportStage: "final",
    reportCompleteness: "none",
    intermediateReport: "",
    finalReport: "",
    degraded: true,
    degradedReason: "Run timed out",
    failures: ["analysis task timed out"],
    artifacts: [],
  };
  return {
    ...degradedState,
    status: "FAILED",
    phase: "failed",
    visibleReport: "",
    intermediateReport: "",
    finalReport: "",
    degraded: true,
    failures: ["analysis task timed out"],
    artifacts: [],
    projection,
  };
}

function mountSurface(
  surface: keyof typeof surfaces,
  state: BotRemoteAgentRunState = syntheticDegradedState()
) {
  return createTestAppContext().mount(surfaces[surface], {
    props: { state },
    global: {
      stubs: {
        MarkdownViewer: {
          props: ["content"],
          template:
            '<article data-test="report-markdown">{{ content }}</article>',
        },
      },
    },
  });
}

describe("Bot remote-agent surface matrix", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.values(products).forEach((product) => {
      product.live = true;
    });
    mocks.capabilities.loaded.value = true;
    mocks.submit.mockResolvedValue(null);
  });

  afterEach(() => {
    Object.values(products).forEach((product) => {
      product.live = false;
    });
  });

  it.each(Object.keys(surfaces) as Array<keyof typeof surfaces>)(
    "renders one shared report contract for %s",
    (surface) => {
      const wrapper = mountSurface(surface);

      expect(wrapper.find('[data-test="bot-report-content"]').exists()).toBe(
        true
      );
      expect(wrapper.find('[data-test="bot-report-evidence"]').exists()).toBe(
        true
      );
      expect(wrapper.find('[data-test="bot-report-activity"]').exists()).toBe(
        true
      );
      expect(wrapper.find('[data-test="bot-report-downloads"]').exists()).toBe(
        true
      );
      expect(wrapper.find(".bot-report-state").exists()).toBe(true);
      expect(wrapper.find(".bot-artifact-list").exists()).toBe(true);
      expect(
        wrapper
          .find('.bot-report-state [data-test="bot-report-content"]')
          .text()
      ).toContain("Synthetic report");
      expect(
        wrapper.find('[data-test="bot-report-progress"]').text()
      ).toContain("2/4");
      expect(wrapper.find('[data-test="bot-report-updated-at"]').exists()).toBe(
        true
      );
      expect(
        wrapper.findAll('button[data-test="bot-artifact-download"]')
      ).toHaveLength(1);
      const scrollRoot =
        surface === "design"
          ? "digital-design"
          : surface === "network"
            ? "gene-network"
            : "research";
      expect(wrapper.attributes("data-scroll-root")).toBe(
        `${scrollRoot}-agent`
      );
      expect(wrapper.find("a[href]").exists()).toBe(false);
      expect(wrapper.text()).toContain("partial");
      expect(wrapper.text()).toContain("No safe downloads");
      expect(wrapper.text()).not.toContain("secret.txt");

      wrapper.unmount();
    }
  );

  it("keeps unsupported asset formats as Agent limitations", () => {
    const state = syntheticFailureState();
    state.failures = ["unsupported_asset_format"];
    const wrapper = mountSurface("research", state);

    const failure = wrapper.get('[data-test="bot-report-failure"]');
    expect(failure.text()).toContain(
      "This Agent cannot process that asset format"
    );
    expect(failure.text()).not.toContain("upload failed");
    expect(failure.text()).not.toContain("timed out");
    wrapper.unmount();
  });

  it.each(Object.keys(surfaces) as Array<keyof typeof surfaces>)(
    "keeps timeout failure and empty-artifact recovery bounded for %s",
    (surface) => {
      const wrapper = mountSurface(surface, syntheticFailureState());

      expect(wrapper.find('[data-test="bot-report-failure"]').exists()).toBe(
        true
      );
      expect(wrapper.find('[data-test="bot-artifact-warning"]').exists()).toBe(
        true
      );
      expect(wrapper.text()).toContain("Failed");
      expect(wrapper.find("a[href]").exists()).toBe(false);
      expect(wrapper.text()).not.toContain("run-synthetic");

      wrapper.unmount();
    }
  );

  it.each(PRODUCT_FIXTURE_MATRIX)(
    "renders the sanitized %s terminal fixture through the shared report surface",
    ({ surface, fixture, fixtureId, agent, report, downloads, warning }) => {
      const terminal = readProductFixture(fixture);
      expect(terminal.fixture_id).toBe(fixtureId);
      expect(terminal.agent).toBe(agent);
      expect(terminal.result.artifacts).toEqual(expect.any(Array));

      const state = stateFromProductFixture(terminal);
      expect(state.projection?.agent).toBe(agent);
      expect(state.visibleReport).toBe(report);
      const wrapper = mountSurface(surface, state);

      expect(wrapper.find('[data-test="bot-report-content"]').text()).toContain(
        report
      );
      expect(
        wrapper.findAll('button[data-test="bot-artifact-download"]')
      ).toHaveLength(downloads);
      expect(wrapper.find('[data-test="bot-artifact-warning"]').exists()).toBe(
        warning
      );
      expect(wrapper.find("a[href]").exists()).toBe(false);
      expect(wrapper.text()).not.toContain("synthetic-bucket");

      wrapper.unmount();
    }
  );

  it("retains research input after a retryable submit failure", async () => {
    const wrapper = createTestAppContext().mount(ResearchAgentView, {
      global: {
        stubs: {
          MarkdownViewer: {
            props: ["content"],
            template:
              '<article data-test="report-markdown">{{ content }}</article>',
          },
        },
      },
    });
    const question = "Keep this question for retry";
    await wrapper.find('[data-test="research-question"]').setValue(question);
    mocks.submit.mockRejectedValueOnce(new Error("timeout"));
    await wrapper.find("form").trigger("submit");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(
      (
        wrapper.find('[data-test="research-question"]')
          .element as HTMLTextAreaElement
      ).value
    ).toBe(question);
    expect(wrapper.find('[data-test="research-form-error"]').exists()).toBe(
      true
    );
    wrapper.unmount();
  });
});
