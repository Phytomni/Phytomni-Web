import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import DigitalDesignAgentView from "@/views/digital-design-agent/index.vue";
import GeneNetworkAgentView from "@/views/gene-network-agent/index.vue";
import ResearchAgentView from "@/views/research-agent/index.vue";
import { REMOTE_AGENT_PRODUCT_REGISTRY } from "@/constants/agents";
import { datetimeFormats } from "@/locales/datetime-formats";
import enUS from "@/locales/langs/en-US";
import zhCN from "@/locales/langs/zh-CN";
import type { BotRunProjection } from "@/views/chat/botProjection";
import type { BotRemoteAgentRunState } from "@/views/chat/composables/useBotRemoteAgentRun";

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
  };
  return {
    state,
    capabilities,
    submit: vi.fn().mockResolvedValue(null),
    cancel: vi.fn().mockReturnValue(true),
    reset: vi.fn(),
    getChatState: vi.fn(() => ({})),
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

vi.mock("vue-router", () => ({
  useRouter: () => ({ back: mocks.routerBack }),
  useRoute: () => ({ query: {} }),
}));

const i18n = createI18n({
  legacy: false,
  locale: "en-US",
  fallbackLocale: "en-US",
  datetimeFormats,
  messages: { "en-US": enUS, "zh-CN": zhCN },
});

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

function syntheticDegradedState(): BotRemoteAgentRunState {
  const projection: BotRunProjection = {
    runId: "run-synthetic",
    agent: "SyntheticAgent",
    status: "RUNNING",
    reportStage: "intermediate",
    reportCompleteness: "partial",
    reportRevision: 1,
    reportUpdatedAt: "2026-07-16T08:30:00.000Z",
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

function mountSurface(surface: keyof typeof surfaces) {
  return mount(surfaces[surface], {
    props: { state: syntheticDegradedState() },
    global: {
      plugins: [i18n],
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
});
