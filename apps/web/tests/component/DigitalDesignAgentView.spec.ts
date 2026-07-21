import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { REMOTE_AGENT_PRODUCT_REGISTRY } from "@/constants/agents";
import enUS from "@/locales/langs/en-US";
import zhCN from "@/locales/langs/zh-CN";
import DigitalDesignAgentView from "@/views/digital-design-agent/index.vue";
import type { BotLifecycleState } from "@/views/chat/streaming/botLifecycleReducer";
import { mustGet } from "../helpers/mockFactories";

const i18n = createI18n({
  legacy: false,
  locale: "en-US",
  fallbackLocale: "en-US",
  messages: { "en-US": enUS, "zh-CN": zhCN },
});

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
  };
  return {
    state,
    capabilities,
    submit: vi.fn().mockResolvedValue(null),
    cancel: vi.fn().mockReturnValue(true),
    reset: vi.fn(),
    load: vi.fn().mockResolvedValue([]),
    getChatState: vi.fn(() => ({})),
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
  return mount(DigitalDesignAgentView, {
    props: options.state ? { state: options.state } : undefined,
    global: {
      plugins: [i18n],
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
    resetState();
    mocks.submit.mockResolvedValue(null);
    mocks.capabilities.load.mockResolvedValue([]);
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
    await wrapper.get("form.digital-design-form").trigger("submit");

    expect(mocks.submit).toHaveBeenCalledWith({
      query: "Design a stable protein",
      files: [context],
      resolver: { geneId: "AT1G01010", speciesCode: "ath" },
    });
    expect(mocks.submit.mock.calls[0][0].query).not.toContain("AT1G01010");
    expect(mocks.submit.mock.calls[0][0].query).not.toContain("ath");
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

    for (const field of ["enabled", "attachments", "artifacts"] as const) {
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
