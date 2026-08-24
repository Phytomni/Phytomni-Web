import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DigitalDesignAgentView from "@/views/digital-design-agent/DigitalDesignAgentView.vue";
import GeneNetworkAgentView from "@/views/gene-network-agent/GeneNetworkAgentView.vue";
import AnalystAgentView from "@/views/analyst-agent/AnalystAgentView.vue";
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
        AnalystAgent: {
          tool: "AnalystAgent",
          slug: "analyst",
          execution: "agent_run",
          stream: false,
          a2ui: false,
          resolver: false,
          attachments: true,
          attachmentPurposes: ["dataset"],
          artifacts: true,
          enabled: true,
        },
        InSilicoResearchAgent: {
          tool: "InSilicoResearchAgent",
          slug: "research",
          execution: "agent_run",
          stream: false,
          a2ui: false,
          resolver: false,
          attachments: true,
          attachmentPurposes: ["dataset"],
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
          attachmentPurposes: ["dataset"],
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
          attachmentPurposes: ["dataset"],
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
      value: {
        enabled: true,
        protocol: "research_input_resolution_v1",
        max_user_query_chars: 1_048_576,
        max_attachments_per_request: 10,
        max_research_dataset_paths: 10,
        max_research_input_references: 10,
      },
    },
  };
  const chatState = {
    fileList: [] as unknown[],
    archiveRetryingByMessageId: {} as Record<string, boolean>,
  };
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

vi.mock("@/components/ScientificMarkdown.vue", () => ({
  default: {
    props: ["source"],
    template: '<article data-test="report-markdown">{{ source }}</article>',
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
    abortTransport: vi.fn(),
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
  analyst: AnalystAgentView,
  research: ResearchAgentView,
  design: DigitalDesignAgentView,
  network: GeneNetworkAgentView,
} as const;

const products = {
  analyst: REMOTE_AGENT_PRODUCT_REGISTRY.AnalystAgent,
  research: REMOTE_AGENT_PRODUCT_REGISTRY.InSilicoResearchAgent,
  design: REMOTE_AGENT_PRODUCT_REGISTRY.DigitalDesignAgent,
  network: REMOTE_AGENT_PRODUCT_REGISTRY.GeneNetworkAgent,
} as const;

type TerminalFixture = {
  fixture_id: string;
  run_id: string;
  agent: string;
  status: string;
  answer?: string;
  result: {
    formatted?: { answer?: string };
    execution?: {
      delivery?: {
        schema_version?: number;
        required?: boolean;
        status?: string;
        revision?: number;
        archive?: {
          role?: string;
          name?: string;
          size_bytes?: number;
          download_ref?: string;
        } | null;
        error_code?: string | null;
        retryable?: boolean;
      };
    };
  };
};

const PRODUCT_FIXTURE_ROOT = resolve(
  __dirname,
  "../../../server/external/bot/testdata/head"
);

const PRODUCT_FIXTURE_MATRIX = [
  {
    surface: "analyst" as const,
    fixture: "analyst_terminal.json",
    agent: "analyst",
    report: "# Synthetic Analyst Result\n\nArchive ready.",
    archiveName: "analyst-results.zip",
  },
  {
    surface: "research" as const,
    fixture: "research_terminal.json",
    agent: "research",
    report: "# Synthetic Research Result\n\nArchive ready.",
    archiveName: "research-results.zip",
  },
  {
    surface: "design" as const,
    fixture: "design_terminal.json",
    agent: "design",
    report: "# Synthetic Design Result\n\nArchive ready.",
    archiveName: "design-results.zip",
  },
  {
    surface: "network" as const,
    fixture: "network_terminal.json",
    agent: "network",
    report: "# Synthetic Network Result\n\nArchive ready.",
    archiveName: "network-results.zip",
  },
] as const;

function readProductFixture(fileName: string): TerminalFixture {
  return JSON.parse(
    readFileSync(resolve(PRODUCT_FIXTURE_ROOT, fileName), "utf8")
  ) as TerminalFixture;
}

function deliveryFromProductFixture(fixture: TerminalFixture) {
  const delivery = fixture.result.execution?.delivery;
  const archive = delivery?.archive;
  if (
    delivery?.schema_version !== 1 ||
    delivery.required !== true ||
    delivery.status !== "ready" ||
    !Number.isSafeInteger(delivery.revision) ||
    delivery.revision < 1 ||
    !archive ||
    archive.role !== "result_archive" ||
    typeof archive.name !== "string" ||
    !Number.isSafeInteger(archive.size_bytes) ||
    archive.size_bytes <= 0 ||
    typeof archive.download_ref !== "string" ||
    !/^result-archive:sha256:[0-9a-f]{64}$/u.test(archive.download_ref) ||
    delivery.error_code !== null ||
    delivery.retryable !== false
  ) {
    throw new TypeError("invalid canonical result archive fixture");
  }
  return {
    schema_version: 1 as const,
    required: true as const,
    status: "ready" as const,
    revision: delivery.revision,
    name: archive.name,
    size_bytes: archive.size_bytes,
    error_code: null,
    retryable: false,
  };
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
  const delivery = deliveryFromProductFixture(fixture);
  const projection = parseBotProjection({
    bot_run_id: fixture.run_id,
    agent: fixture.agent,
    status: fixture.status,
    answer: result.formatted?.answer ?? fixture.answer,
    result_archive_v1: true,
    delivery,
  });
  const lifecycle = reduceBotProjection(initBotLifecycleState(), projection);
  return {
    ...lifecycle,
    phase: "succeeded",
    requestId: null,
    uploadTransfer: null,
    projection,
    artifactLinks: [
      { id: `archive-${fixture.agent}`, name: delivery.name, kind: "archive" },
    ],
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

function syntheticArchiveState(
  surface: keyof typeof surfaces
): BotRemoteAgentRunState {
  const base = syntheticDegradedState();
  const agent = products[surface].tool;
  const archiveName =
    surface === "analyst"
      ? "analyst-results.zip"
      : surface === "research"
        ? "research-results.zip"
        : surface === "network"
          ? "network-results.zip"
          : "design-results.zip";
  const projection: BotRunProjection = {
    ...mustGet(base.projection, "synthetic archive projection"),
    runId: `run-${surface}-archive`,
    agent,
    status: "SUCCEEDED",
    reportStage: "final",
    reportCompleteness: "complete",
    finalReport: `# ${surface} archive report`,
    intermediateReport: "",
    degraded: false,
    degradedReason: null,
    failures: [],
    artifacts: [],
    resultArchiveV1: true,
    delivery: {
      schema_version: 1,
      required: true,
      status: "ready",
      revision: 2,
      name: archiveName,
      size_bytes: 2048,
      error_code: null,
      retryable: false,
    },
  };
  const lifecycle = reduceBotProjection(initBotLifecycleState(), projection);
  return {
    ...lifecycle,
    phase: "succeeded",
    requestId: null,
    uploadTransfer: null,
    projection,
    artifactLinks: [
      { id: `archive-${surface}`, name: archiveName, kind: "archive" },
    ],
    dialogueId: `dialogue-${surface}`,
    messageId: "42",
    error: null,
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
        ScientificMarkdown: {
          props: ["source"],
          template:
            '<article data-test="report-markdown">{{ source }}</article>',
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

  it.each(["analyst", "design", "network"] as const)(
    "renders one shared report contract for %s",
    (surface) => {
      const wrapper = mountSurface(surface);

      expect(wrapper.find('[data-test="bot-report-content"]').exists()).toBe(
        true
      );
      expect(wrapper.find('[data-test="bot-report-evidence"]').exists()).toBe(
        false
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
        surface === "analyst"
          ? "analyst"
          : surface === "design"
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

  it("keeps active degraded Research progress-only", () => {
    const wrapper = mountSurface("research");

    expect(wrapper.find('[data-test="bot-report-content"]').exists()).toBe(
      false
    );
    expect(wrapper.find('[data-test="bot-report-evidence"]').exists()).toBe(
      false
    );
    expect(wrapper.find('[data-test="bot-report-activity"]').exists()).toBe(
      true
    );
    expect(wrapper.find('[data-test="bot-report-downloads"]').exists()).toBe(
      false
    );
    expect(wrapper.find(".bot-report-state").exists()).toBe(true);
    expect(wrapper.find('[data-test="bot-report-progress"]').exists()).toBe(
      true
    );
    expect(wrapper.get('[data-test="bot-report-progress"]').text()).toContain(
      "2/4"
    );
    expect(
      wrapper
        .find('.bot-report-state [data-test="bot-report-content"]')
        .exists()
    ).toBe(false);
    expect(wrapper.find(".bot-artifact-list").exists()).toBe(false);
    expect(wrapper.find('[data-test="bot-report-empty"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="research-evidence-empty"]').exists()).toBe(
      false
    );
    expect(
      wrapper.findAll('button[data-test="bot-artifact-download"]')
    ).toHaveLength(0);
    expect(wrapper.text()).toContain("partial");
    expect(wrapper.text()).not.toContain("Synthetic report");
    expect(wrapper.text()).not.toContain("secret.txt");

    wrapper.unmount();
  });

  it.each(Object.keys(surfaces) as Array<keyof typeof surfaces>)(
    "renders one opaque archive with its report and no legacy artifact list for active v1 %s",
    (surface) => {
      const wrapper = mountSurface(surface, syntheticArchiveState(surface));

      expect(wrapper.find('[data-test="bot-report-content"]').text()).toContain(
        `${surface} archive report`
      );
      expect(
        wrapper.find('[data-test="result-archive-delivery"]').exists()
      ).toBe(true);
      expect(
        wrapper.findAll('[data-test="result-archive-download"]')
      ).toHaveLength(1);
      expect(wrapper.find(".bot-artifact-list").exists()).toBe(false);
      expect(wrapper.text()).not.toContain("obs://");

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
        false
      );
      expect(wrapper.find('[data-test="bot-report-downloads"]').exists()).toBe(
        false
      );
      expect(wrapper.text()).toContain("Failed");
      expect(wrapper.find("a[href]").exists()).toBe(false);
      expect(wrapper.text()).not.toContain("run-synthetic");

      wrapper.unmount();
    }
  );

  it.each(PRODUCT_FIXTURE_MATRIX)(
    "renders the canonical %s delivery fixture through the shared report surface",
    ({ surface, fixture, agent, report, archiveName }) => {
      const terminal = readProductFixture(fixture);
      expect(terminal.agent).toBe(agent);
      expect(
        terminal.result.execution?.delivery?.archive?.download_ref
      ).toMatch(/^result-archive:sha256:[0-9a-f]{64}$/u);

      const state = stateFromProductFixture(terminal);
      expect(state.projection?.agent).toBe(agent);
      expect(state.visibleReport).toBe(report);
      expect(state.delivery?.name).toBe(archiveName);
      const wrapper = mountSurface(surface, state);

      expect(wrapper.find('[data-test="bot-report-content"]').text()).toContain(
        report
      );
      expect(
        wrapper.findAll('[data-test="result-archive-download"]')
      ).toHaveLength(1);
      expect(wrapper.find(".bot-artifact-list").exists()).toBe(false);
      expect(wrapper.find("a[href]").exists()).toBe(false);
      expect(wrapper.text()).not.toContain("result-archive:");

      wrapper.unmount();
    }
  );

  it("retains research input after a retryable submit failure", async () => {
    const wrapper = createTestAppContext().mount(ResearchAgentView, {
      global: {
        stubs: {
          ScientificMarkdown: {
            props: ["source"],
            template:
              '<article data-test="report-markdown">{{ source }}</article>',
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
