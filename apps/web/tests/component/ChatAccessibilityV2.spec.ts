/**
 * Chat accessibility lock-in — keyboard order/activation, ARIA semantics,
 * progress live-region restraint, and focus-visible ownership.
 * Test-only; mounts production Chat surface components without network.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import enUS from "@/locales/langs/en-US";
import {
  FIXTURE_ACTIVITY_BLOCKS,
  FIXTURE_ACTIVITY_STATE_KEY,
  FIXTURE_A2UI_REQUIRED_BLOCK,
  FIXTURE_PROGRESS_STARTED_AT,
} from "../fixtures/chat";
import { activityRegionDomId } from "@/views/chat/streaming/presentation";
import { createMemoryA2uiTransport } from "@/views/chat/streaming/a2uiAction";
import ChatSidebarNav from "@/views/chat/components/ChatSidebarNav.vue";
import ChatAgentPicker from "@/views/chat/components/ChatAgentPicker.vue";
import ChatActivity from "@/views/chat/components/ChatActivity.vue";
import ChatMessageActions from "@/views/chat/components/ChatMessageActions.vue";
import SendProgress from "@/views/chat/components/SendProgress.vue";
import AgentSurfaceBlock from "@/views/chat/components/blocks/AgentSurfaceBlock.vue";
import PhyAdaptiveSidebar from "@/components/shell/PhyAdaptiveSidebar.vue";
import { CANONICAL_AT_ABLE_TOOLS } from "@/constants/agents";

const ACTIONS_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/components/ChatMessageActions.vue"),
  "utf8"
);
const SIDEBAR_SOURCE = readFileSync(
  resolve(__dirname, "../../src/components/shell/PhyAdaptiveSidebar.vue"),
  "utf8"
);
const NAV_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/components/ChatSidebarNav.vue"),
  "utf8"
);
const FOLLOW_UP_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/FollowUpQuestions.vue"),
  "utf8"
);
const GLOBAL_CSS = readFileSync(
  resolve(__dirname, "../../src/assets/main.css"),
  "utf8"
);

const i18n = createI18n({
  legacy: false,
  locale: "en-US",
  messages: { "en-US": enUS },
});

const makeOptions = (tools: string[]) =>
  tools.map((tool) => ({
    tool,
    label: tool,
    labelKey: `chat.agents.${tool.charAt(0).toLowerCase()}${tool.slice(1)}`,
  }));

const actionStubs = {
  ElIcon: true,
  ElTooltip: {
    name: "ElTooltip",
    template: "<div><slot /></div>",
  },
  ElDropdown: {
    name: "ElDropdown",
    template:
      '<div class="dropdown-stub"><slot /><slot name="dropdown" /></div>',
  },
  ElDropdownMenu: {
    template: '<div class="dropdown-menu-stub"><slot /></div>',
  },
  ElDropdownItem: {
    template: '<button type="button"><slot /></button>',
  },
};

describe("ChatAccessibilityV2 — sidebar keyboard and labels", () => {
  it("activates New Chat via click and keeps a collapsed aria-label", async () => {
    const wrapper = mount(ChatSidebarNav, {
      props: {
        collapsed: true,
        activeItem: "",
        userName: "Synthetic user",
        canExploreAgents: true,
        canHistory: true,
        canProfile: true,
        canCloudStorage: false,
        canUserManagement: false,
        canPermissionManagement: false,
        canSystemMonitor: false,
        canGlobalConfig: false,
        canAdminManagement: false,
        canHelp: true,
        showAgentsList: false,
        offCanvas: false,
      },
      global: {
        plugins: [i18n],
        stubs: {
          ElIcon: true,
          ElButton: {
            name: "ElButton",
            template: '<button type="button"><slot /></button>',
          },
          ElDropdown: true,
          ElDropdownMenu: true,
          ElDropdownItem: true,
          LangSwitch: true,
          ThemeSwitch: true,
        },
      },
    });

    const primary = wrapper.find('[data-testid="chat-primary-action"]');
    expect(primary.exists()).toBe(true);
    expect(primary.attributes("aria-label")).toBe(enUS.chat.newChat);
    expect(primary.element.tagName).toBe("BUTTON");

    await primary.trigger("click");
    expect(wrapper.emitted("new-chat")).toHaveLength(1);
  });

  it("exposes adaptive sidebar toggle/close with aria-expanded and focus-visible", async () => {
    const wrapper = mount(PhyAdaptiveSidebar, {
      props: { collapsed: false, drawerOpen: true },
      slots: {
        toggle: "<span>Toggle</span>",
        close: "<span>Close</span>",
        default: "<nav>Nav</nav>",
      },
    });

    const toggle = wrapper.find('[data-action="toggle"]');
    expect(toggle.attributes("aria-expanded")).toBe("true");
    expect(toggle.attributes("aria-label")).toBe("Toggle sidebar");

    await toggle.trigger("click");
    expect(wrapper.emitted("toggle")).toHaveLength(1);

    const close = wrapper.findAll('[data-action="close"]');
    expect(close.length).toBeGreaterThanOrEqual(1);
    await close[0].trigger("click");
    expect(wrapper.emitted("close")).toHaveLength(1);

    expect(SIDEBAR_SOURCE).toMatch(
      /\.phy-adaptive-sidebar__toggle button:focus-visible/
    );
    expect(SIDEBAR_SOURCE).toMatch(
      /\.phy-adaptive-sidebar__close button:focus-visible/
    );
  });
});

describe("ChatAccessibilityV2 — Composer picker keyboard", () => {
  it("opens, arrows, activates, and returns focus on Escape", async () => {
    const tools = [...CANONICAL_AT_ABLE_TOOLS];
    const wrapper = mount(ChatAgentPicker, {
      props: {
        options: makeOptions(tools),
        rolesLoading: false,
        selectedAgent: "",
        disabled: false,
      },
      global: {
        mocks: { $t: (key: string) => key },
      },
      attachTo: document.body,
    });

    const combobox = wrapper.find('[role="combobox"]');
    expect(combobox.exists()).toBe(true);
    (combobox.element as HTMLElement).focus();
    expect(document.activeElement).toBe(combobox.element);

    await combobox.trigger("click");
    await nextTick();
    expect(combobox.attributes("aria-expanded")).toBe("true");
    expect(wrapper.find('[role="listbox"]').exists()).toBe(true);

    await combobox.trigger("keydown", { key: "ArrowDown" });
    expect(combobox.attributes("aria-activedescendant")).toContain(
      "agent-option-1"
    );

    await combobox.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("select")?.[0]?.[0]).toMatch(/^@/);

    await combobox.trigger("click");
    await nextTick();
    await combobox.trigger("keydown", { key: "Escape" });
    await flushPromises();
    expect(combobox.attributes("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(combobox.element);

    wrapper.unmount();
  });

  it("announces loading and disabled states without a combobox", () => {
    const loading = mount(ChatAgentPicker, {
      props: {
        options: [],
        rolesLoading: true,
        selectedAgent: "",
      },
      global: { mocks: { $t: (key: string) => key } },
    });
    expect(loading.text()).toContain("chat.agentPicker.loading");
    expect(loading.find('[role="combobox"]').exists()).toBe(false);

    const disabled = mount(ChatAgentPicker, {
      props: {
        options: makeOptions(["ChatAgent"]),
        rolesLoading: false,
        selectedAgent: "",
        disabled: true,
      },
      global: { mocks: { $t: (key: string) => key } },
    });
    const box = disabled.find('[role="combobox"]');
    expect(box.exists()).toBe(true);
    expect(box.attributes("aria-disabled")).toBe("true");
  });
});

describe("ChatAccessibilityV2 — Activity disclosure linkage", () => {
  const regionId = activityRegionDomId(FIXTURE_ACTIVITY_STATE_KEY);

  it("links the disclosure control to the region and restores focus after toggle", async () => {
    const wrapper = mount(ChatActivity, {
      props: {
        blocks: FIXTURE_ACTIVITY_BLOCKS,
        stateKey: FIXTURE_ACTIVITY_STATE_KEY,
        expanded: false,
        streaming: true,
      },
      global: { plugins: [i18n] },
      attachTo: document.body,
    });

    const btn = wrapper.find("button");
    expect(btn.attributes("aria-expanded")).toBe("false");
    expect(btn.attributes("aria-controls")).toBe(regionId);
    (btn.element as HTMLElement).focus();
    expect(document.activeElement).toBe(btn.element);

    await btn.trigger("click");
    expect(wrapper.emitted("update:expanded")?.[0]).toEqual([true]);
    expect(document.activeElement).toBe(btn.element);

    await wrapper.setProps({ expanded: true });
    await nextTick();
    const region = wrapper.find(`#${CSS.escape(regionId)}`);
    expect(region.exists()).toBe(true);
    expect(region.attributes("role")).toBe("region");
    expect(wrapper.find("button").attributes("aria-expanded")).toBe("true");

    wrapper.unmount();
  });
});

describe("ChatAccessibilityV2 — message actions and downloads", () => {
  it("orders toolbar actions and keeps labeled download activation", async () => {
    const wrapper = mount(ChatMessageActions, {
      props: {
        role: "assistant",
        canRefresh: true,
        canReact: true,
        reactionActive: 0,
        copied: false,
        refreshBusy: false,
        directDownloads: [{ kind: "file", path: "/synthetic-path" }],
        generatedFormats: ["PDF"],
      },
      global: { plugins: [i18n], stubs: actionStubs },
      attachTo: document.body,
    });

    const toolbar = wrapper.find('[data-testid="chat-message-actions"]');
    expect(toolbar.attributes("role")).toBe("toolbar");

    const copy = wrapper.find('[data-testid="action-copy"]');
    const refresh = wrapper.find('[data-testid="action-refresh"]');
    const like = wrapper.find('[data-testid="action-like"]');
    const dislike = wrapper.find('[data-testid="action-dislike"]');
    const direct = wrapper.find('[data-testid="action-direct-downloads"]');
    const generated = wrapper.find('[data-testid="action-generated-download"]');

    expect(copy.attributes("aria-label")).toBe(enUS.chat.copy);
    expect(refresh.attributes("aria-label")).toBe(enUS.chat.refreshReply);
    expect(like.attributes("aria-label")).toBe(enUS.chat.actions.like);
    expect(dislike.attributes("aria-label")).toBe(enUS.chat.actions.dislike);
    expect(direct.attributes("aria-label")).toBeTruthy();
    expect(generated.attributes("aria-label")).toBeTruthy();

    const order = [
      copy.element,
      refresh.element,
      like.element,
      dislike.element,
      direct.element,
      generated.element,
    ];
    for (let i = 1; i < order.length; i += 1) {
      const position = order[i - 1].compareDocumentPosition(order[i]);
      expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }

    (copy.element as HTMLElement).focus();
    await copy.trigger("click");
    expect(wrapper.emitted("copy")).toHaveLength(1);
    expect(document.activeElement).toBe(copy.element);

    await direct.trigger("click");
    const item = wrapper.find(
      '[data-testid="direct-download-/synthetic-path"]'
    );
    expect(item.exists()).toBe(true);

    wrapper.unmount();
  });

  it("marks busy refresh disabled with aria-busy and loading class", () => {
    const wrapper = mount(ChatMessageActions, {
      props: {
        role: "assistant",
        canRefresh: true,
        refreshBusy: true,
      },
      global: { plugins: [i18n], stubs: actionStubs },
    });
    const refresh = wrapper.find('[data-testid="action-refresh"]');
    expect(refresh.attributes("aria-busy")).toBe("true");
    expect(refresh.attributes("disabled")).toBeDefined();
    expect(refresh.classes()).toContain("is-loading");
  });
});

describe("ChatAccessibilityV2 — A2UI required input", () => {
  it("keeps the required field focusable and rejects empty submit", async () => {
    const sink: Array<Record<string, unknown>> = [];
    const transport = createMemoryA2uiTransport(sink as never);
    const wrapper = mount(AgentSurfaceBlock, {
      props: {
        block: FIXTURE_A2UI_REQUIRED_BLOCK,
        runId: "fixture-run",
        transport,
      },
      global: { plugins: [i18n, ElementPlus] },
      attachTo: document.body,
    });

    expect(wrapper.find(".a2ui-form").exists()).toBe(true);
    const input = wrapper.find("input");
    expect(input.exists()).toBe(true);
    expect(input.attributes("disabled")).toBeUndefined();
    (input.element as HTMLElement).focus();
    expect(document.activeElement).toBe(input.element);

    await wrapper.find("form").trigger("submit.prevent");
    expect(sink).toHaveLength(0);

    await input.setValue("Oryza sativa");
    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();
    expect(sink.length).toBeGreaterThanOrEqual(1);

    wrapper.unmount();
  });

  it("hides interaction when the surface cannot send", () => {
    const wrapper = mount(AgentSurfaceBlock, {
      props: {
        block: FIXTURE_A2UI_REQUIRED_BLOCK,
        runId: "",
        transport: null,
      },
      global: { plugins: [i18n, ElementPlus] },
    });
    expect(wrapper.text()).toContain(enUS.chat.a2ui.expired);
  });
});

describe("ChatAccessibilityV2 — progressbar and live-region restraint", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("exposes min/max/now/valuetext and keeps percent out of the live region", async () => {
    const wrapper = mount(SendProgress, {
      props: {
        startedAt: FIXTURE_PROGRESS_STARTED_AT,
        agentName: "ChatAgent",
        completing: false,
        stageLabel: "Retrieving",
      },
      global: { plugins: [i18n] },
    });
    vi.advanceTimersByTime(7500);
    await nextTick();

    const root = wrapper.find('[data-test="send-progress"]');
    expect(root.attributes("role")).toBe("progressbar");
    expect(root.attributes("aria-valuemin")).toBe("0");
    expect(root.attributes("aria-valuemax")).toBe("100");
    const nowVal = Number(root.attributes("aria-valuenow"));
    expect(nowVal).toBeGreaterThanOrEqual(0);
    expect(nowVal).toBeLessThanOrEqual(98);
    expect(root.attributes("aria-valuetext")).toBe(`Processing, ${nowVal}%`);

    const label = wrapper.find('[data-test="progress-label"]');
    expect(label.attributes("aria-live")).toBe("polite");
    expect(label.text()).toBe("Retrieving");

    const percent = wrapper.find('[data-test="progress-percent"]');
    expect(percent.attributes("aria-hidden")).toBe("true");
    expect(percent.attributes("aria-live")).toBeUndefined();
    // Percent ticks must not share the stage live region.
    expect(label.text()).not.toContain("%");
  });
});

describe("ChatAccessibilityV2 — focus-visible ownership", () => {
  it("locks focus-visible styles on actions, sidebar nav, follow-ups, and shell", () => {
    expect(ACTIONS_SOURCE).toMatch(/&:focus-visible\s*\{/);
    expect(NAV_SOURCE).toMatch(/&:focus-visible\s*\{/);
    expect(FOLLOW_UP_SOURCE).toMatch(/&:focus-visible\s*\{/);
    expect(SIDEBAR_SOURCE).toMatch(/:focus-visible/);
    expect(GLOBAL_CSS).toContain("a:focus-visible");
  });
});
