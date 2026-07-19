import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { REMOTE_AGENT_PRODUCT_REGISTRY } from "@/constants/agents";
import enUS from "@/locales/langs/en-US";
import zhCN from "@/locales/langs/zh-CN";
import GeneNetworkAgentView from "@/views/gene-network-agent/index.vue";
import type { BotLifecycleState } from "@/views/chat/streaming/botLifecycleReducer";

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
      '<section><button data-test="network-report-reset" @click="$emit(\'action\')">reset</button><slot name="content"/><slot name="evidence"/><slot name="activity"/><slot name="downloads"/></section>',
  },
}));
vi.mock("@/components/research/BotReportState.vue", () => ({
  default: {
    props: ["state"],
    template:
      '<div data-test="bot-report-state"><span v-if="state.degraded" data-test="network-degraded">degraded</span></div>',
  },
}));
vi.mock("@/components/research/BotArtifactList.vue", () => ({
  default: { template: '<div data-test="bot-artifact-list" />' },
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({ back: mocks.routerBack }),
  useRoute: () => ({ query: {} }),
}));

function mountView(options: { state?: BotLifecycleState } = {}) {
  return mount(GeneNetworkAgentView, {
    props: options.state ? { state: options.state } : undefined,
    global: {
      plugins: [i18n],
      stubs: {
        ResearchArtifactShell: {
          template:
            '<section><button data-test="network-report-reset" @click="$emit(\'action\')">reset</button><slot name="content"/><slot name="evidence"/><slot name="activity"/><slot name="downloads"/></section>',
        },
        BotReportState: {
          props: ["state"],
          template:
            '<div data-test="bot-report-state"><span v-if="state.degraded" data-test="network-degraded">degraded</span></div>',
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
  REMOTE_AGENT_PRODUCT_REGISTRY.GeneNetworkAgent.live = true;
  mocks.capabilities.byTool.value.GeneNetworkAgent = {
    tool: "GeneNetworkAgent",
    slug: "network",
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
  REMOTE_AGENT_PRODUCT_REGISTRY.GeneNetworkAgent.live = false;
});

function degradedState(): BotLifecycleState {
  return {
    runId: "run-network",
    status: "RUNNING",
    reportRevision: 1,
    visibleReport: "Partial network report",
    intermediateReport: "Partial network report",
    finalReport: "",
    degraded: true,
    failures: ["Optional network analysis unavailable"],
    artifacts: [],
  };
}

describe("GeneNetworkAgentView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
    mocks.submit.mockResolvedValue(null);
  });

  it("keeps loading and unavailable Back actions labeled and reachable", async () => {
    mocks.capabilities.loaded.value = false;
    const loading = mountView();
    expect(loading.get('[data-test="network-back"]').text()).toBe("Back");
    await loading.get('[data-test="network-back"]').trigger("click");
    expect(mocks.routerBack).toHaveBeenCalledTimes(1);
    loading.unmount();

    mocks.capabilities.loaded.value = true;
    REMOTE_AGENT_PRODUCT_REGISTRY.GeneNetworkAgent.live = false;
    const unavailable = mountView();
    expect(unavailable.get('[data-test="network-unavailable"]').exists()).toBe(
      true
    );
    expect(unavailable.get('[data-test="network-back"]').text()).toBe("Back");
    await unavailable.get('[data-test="network-back"]').trigger("click");
    expect(mocks.routerBack).toHaveBeenCalledTimes(2);
    unavailable.unmount();
  });

  it("submits a closed-set trait/species resolver without leaking ids into query", async () => {
    const wrapper = mountView();
    await wrapper
      .get('[data-test="network-question"]')
      .setValue("Analyze the trait network");
    await wrapper.get('[data-test="network-trait"]').setValue("TO:0000011");
    await wrapper.get('[data-test="network-species"]').setValue("ath");
    await wrapper.get("form.gene-network-form").trigger("submit");

    expect(mocks.submit).toHaveBeenCalledWith({
      query: "Analyze the trait network",
      resolver: { toId: "TO:0000011", speciesCode: "ath" },
    });
    expect(mocks.submit.mock.calls[0][0].query).not.toContain("TO:0000011");
    expect(mocks.submit.mock.calls[0][0].query).not.toContain("ath");
    expect(
      (wrapper.get('[data-test="network-trait"]').element as HTMLSelectElement)
        .value
    ).toBe("TO:0000011");
    expect(
      (
        wrapper.get('[data-test="network-species"]')
          .element as HTMLSelectElement
      ).value
    ).toBe("ath");
    wrapper.unmount();
  });

  it("blocks missing and malformed resolver values before transport", async () => {
    const wrapper = mountView();
    await wrapper
      .get('[data-test="network-question"]')
      .setValue("Analyze traits");
    await wrapper.get("form.gene-network-form").trigger("submit");
    expect(wrapper.get('[data-test="network-validation"]').text()).toContain(
      "Trait Ontology"
    );
    expect(wrapper.get('[data-test="network-validation"]').text()).toContain(
      "species"
    );
    expect(mocks.submit).not.toHaveBeenCalled();

    const trait = wrapper.get('[data-test="network-trait"]');
    const species = wrapper.get('[data-test="network-species"]');
    (trait.element as HTMLSelectElement).value = "TO:9999999";
    (species.element as HTMLSelectElement).value = "unknown";
    await trait.trigger("change");
    await species.trigger("change");
    await wrapper.get("form.gene-network-form").trigger("submit");
    expect(mocks.submit).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("renders localized validation for empty and oversized questions", async () => {
    const wrapper = mountView();
    await wrapper.get("form.gene-network-form").trigger("submit");
    expect(wrapper.get('[data-test="network-form-error"]').text()).toContain(
      "Enter a network question"
    );
    expect(mocks.submit).not.toHaveBeenCalled();

    await wrapper
      .get('[data-test="network-question"]')
      .setValue("x".repeat(4001));
    await wrapper.get('[data-test="network-trait"]').setValue("TO:0000011");
    await wrapper.get('[data-test="network-species"]').setValue("ath");
    await wrapper.get("form.gene-network-form").trigger("submit");
    expect(wrapper.get('[data-test="network-form-error"]').text()).toContain(
      "too long"
    );
    expect(mocks.submit).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("fails closed for dark and incomplete capability manifests", () => {
    REMOTE_AGENT_PRODUCT_REGISTRY.GeneNetworkAgent.live = false;
    let wrapper = mountView();
    expect(wrapper.get('[data-test="network-unavailable"]').exists()).toBe(
      true
    );
    expect(wrapper.find('[data-test="network-submit"]').exists()).toBe(false);
    wrapper.unmount();

    REMOTE_AGENT_PRODUCT_REGISTRY.GeneNetworkAgent.live = true;
    const baseCapability = {
      ...mocks.capabilities.byTool.value.GeneNetworkAgent,
    };
    for (const field of ["enabled", "resolver", "artifacts"] as const) {
      mocks.capabilities.byTool.value.GeneNetworkAgent = {
        ...baseCapability,
        [field]: false,
      };
      wrapper = mountView();
      expect(wrapper.get('[data-test="network-unavailable"]').exists()).toBe(
        true
      );
      expect(wrapper.find('[data-test="network-submit"]').exists()).toBe(false);
      wrapper.unmount();
    }

    mocks.capabilities.byTool.value.GeneNetworkAgent = {
      ...baseCapability,
      execution: "chat",
    };
    wrapper = mountView();
    expect(wrapper.get('[data-test="network-unavailable"]').exists()).toBe(
      true
    );
    wrapper.unmount();
  });

  it("renders degraded empty-artifact state without static task or download paths", () => {
    const wrapper = mountView({ state: degradedState() });
    expect(wrapper.get('[data-test="network-degraded"]').exists()).toBe(true);
    expect(wrapper.find('a[href*="task"]').exists()).toBe(false);
    expect(wrapper.html()).not.toContain("/static/downloads/");
    expect(wrapper.html()).not.toContain("8ab4434b");
    expect(wrapper.get('[data-test="network-empty-artifacts"]').exists()).toBe(
      true
    );
    expect(wrapper.get('[data-test="bot-artifact-list"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("keeps Reset, Back, and keyboard submit reachable", async () => {
    const wrapper = mountView({ state: degradedState() });
    await wrapper.get('[data-test="network-back"]').trigger("click");
    expect(mocks.routerBack).toHaveBeenCalledTimes(1);

    await wrapper
      .get('[data-test="network-question"]')
      .setValue("Analyze traits");
    await wrapper.get('[data-test="network-trait"]').setValue("TO:0000207");
    await wrapper.get('[data-test="network-species"]').setValue("osa");
    await wrapper.get('[data-test="network-submit"]').trigger("keydown.enter");
    expect(mocks.submit).toHaveBeenCalledTimes(1);

    await wrapper.get('[data-test="network-reset"]').trigger("click");
    expect(mocks.reset).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });
});
