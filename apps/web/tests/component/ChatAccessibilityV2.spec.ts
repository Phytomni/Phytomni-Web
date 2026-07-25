/**
 * Chat accessibility lock-in — keyboard order/activation, ARIA semantics,
 * progress live-region restraint, and focus-visible ownership.
 * Test-only; mounts production Chat surface components without network.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import enUS from "@/locales/langs/en-US";
import zhCN from "@/locales/langs/zh-CN";
import {
  FIXTURE_ACTIVITY_BLOCKS,
  FIXTURE_ACTIVITY_STATE_KEY,
  FIXTURE_A2UI_REQUIRED_BLOCK,
  FIXTURE_PROGRESS_STARTED_AT,
} from "../fixtures/chat";
import ChatSidebarNav from "@/views/chat/components/ChatSidebarNav.vue";
import ChatAgentPicker from "@/views/chat/components/ChatAgentPicker.vue";
import ChatActivity from "@/views/chat/components/ChatActivity.vue";
import ChatMessageActions from "@/views/chat/components/ChatMessageActions.vue";
import SendProgress from "@/views/chat/components/SendProgress.vue";
import AgentSurfaceBlock from "@/views/chat/components/blocks/AgentSurfaceBlock.vue";
import FormWidget from "@/views/chat/components/blocks/a2ui/FormWidget.vue";
import ChoiceWidget from "@/views/chat/components/blocks/a2ui/ChoiceWidget.vue";
import StreamMessage from "@/views/chat/components/StreamMessage.vue";
import PhyAdaptiveSidebar from "@/components/shell/PhyAdaptiveSidebar.vue";
import AgentCapabilityPopover from "@/components/agent/AgentCapabilityPopover.vue";
import { CANONICAL_AGENT_PRESENTATIONS } from "@/components/agent";
import { CANONICAL_AGENT_TOOLS } from "@/constants/agents";
import type { A2uiOpenSurface } from "@/views/chat/streaming/a2uiContract";
import {
  A2UI_LIFECYCLE_LONG_BODY,
  A2UI_LIFECYCLE_LONG_LABEL,
  buildA2uiLifecycleMessages,
} from "../visual/chat/fixture-data";
import { mustGet } from "../helpers/mockFactories";
import {
  createTestAppContext,
  type TestAppContext,
} from "../helpers/test-app-context";

const mount: TestAppContext["mount"] = ((component, mountOptions) =>
  createTestAppContext().mount(
    component,
    mountOptions
  )) as TestAppContext["mount"];

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
const A2UI_SOURCE = readFileSync(
  resolve(
    __dirname,
    "../../src/views/chat/components/blocks/AgentSurfaceBlock.vue"
  ),
  "utf8"
);

const A2UI_LIFECYCLE_KEYS = [
  "submitting",
  "submitted",
  "cancelled",
  "rejected",
  "advanced",
  "temporarilyRejected",
  "retry",
  "expired",
  "unknown",
  "protocolError",
  "notSent",
  "refreshRequired",
] as const;

describe("ChatAccessibilityV2 — A2UI lifecycle semantics", () => {
  it("keeps lifecycle copy bilingual and free of upstream error details", () => {
    const english = enUS.chat.a2ui as Record<string, string>;
    const chinese = zhCN.chat.a2ui as Record<string, string>;
    for (const key of A2UI_LIFECYCLE_KEYS) {
      expect(english[key]).toBeTruthy();
      expect(chinese[key]).toBeTruthy();
    }

    const block = {
      ...FIXTURE_A2UI_REQUIRED_BLOCK,
      a2ui: {
        ...mustGet(FIXTURE_A2UI_REQUIRED_BLOCK.a2ui, "required A2UI fixture"),
        state: {
          status: "unknown" as const,
          round: 1 as const,
          actionId: "action-unknown",
          code: "secret-upstream-detail",
        },
      },
    };
    const wrapper = mount(AgentSurfaceBlock, {
      props: { block },
      global: {},
    });

    expect(wrapper.find(".a2ui-status").text()).toBe(english.unknown);
    expect(wrapper.text()).not.toContain("secret-upstream-detail");
    expect(wrapper.find('[data-test="a2ui-retry"]').exists()).toBe(false);
  });

  it("announces submitting state and focuses a fresh round two once", async () => {
    const focusSpy = vi.spyOn(HTMLElement.prototype, "focus");
    const roundTwo = {
      ...FIXTURE_A2UI_REQUIRED_BLOCK,
      a2ui: {
        ...mustGet(FIXTURE_A2UI_REQUIRED_BLOCK.a2ui, "required A2UI fixture"),
        state: { status: "ready" as const, round: 2 as const },
      },
    };
    const wrapper = mount(AgentSurfaceBlock, {
      props: { block: roundTwo },
      global: {},
      attachTo: document.body,
    });
    await flushPromises();
    await nextTick();

    const root = wrapper.find(".agent-surface-block");
    const rootFocusCount = () =>
      focusSpy.mock.instances.filter((instance) => instance === root.element)
        .length;
    expect(root.attributes("tabindex")).toBe("-1");
    expect(root.attributes("aria-busy")).toBeUndefined();
    expect(document.activeElement).toBe(root.element);
    expect(rootFocusCount()).toBe(1);

    await wrapper.setProps({
      block: {
        ...roundTwo,
        a2ui: {
          ...mustGet(roundTwo.a2ui, "round-two A2UI fixture"),
          state: {
            status: "submitting" as const,
            round: 2 as const,
            envelope: {
              surface_id: mustGet(roundTwo.a2ui, "round-two A2UI fixture")
                .surface.surface_id,
              widget: "form",
              action_id: "round-two-action",
              run_id: "round-two-run",
              payload: { fields: { species: "Oryza sativa" } },
            },
          },
        },
      },
    });
    await nextTick();
    expect(root.attributes("aria-busy")).toBe("true");
    expect(root.find(".a2ui-status").attributes("role")).toBe("status");
    expect(root.find(".a2ui-status").attributes("aria-live")).toBe("polite");
    expect(root.find(".a2ui-status").text()).toBe(enUS.chat.a2ui.submitting);
    expect(rootFocusCount()).toBe(1);

    wrapper.unmount();
    focusSpy.mockRestore();
  });

  it("does not steal focus on the initial round and keeps widget controls named", () => {
    const roundOne = structuredClone(FIXTURE_A2UI_REQUIRED_BLOCK);
    const wrapper = mount(AgentSurfaceBlock, {
      props: { block: roundOne },
      global: {},
    });
    expect(document.activeElement).not.toBe(
      wrapper.find(".agent-surface-block").element
    );
    expect(A2UI_SOURCE).toContain(":focus-visible");
    expect(A2UI_SOURCE).toContain("--phy-color-focus");
    expect(A2UI_SOURCE).toContain("pointer: coarse");
    expect(A2UI_SOURCE).toContain("--phy-control-height-default");
    expect(A2UI_SOURCE).not.toContain("@keydown");
    wrapper.unmount();

    const formSurface: Extract<A2uiOpenSurface, { widget: "form" }>["props"] = {
      title: "Enter species",
      fields: [
        {
          name: "species",
          label: "Species",
          type: "text" as const,
          required: true,
        },
      ],
    };
    const form = mount(FormWidget, {
      props: { surface: formSurface, disabled: false },
      global: {},
    });
    expect(form.find("label[for='a2ui-field-species']").text()).toBe("Species");
    expect(form.find("input").attributes("aria-label")).toBe("Species");
    expect(form.find("button[type='submit']").attributes("aria-label")).toBe(
      enUS.chat.a2ui.submit
    );
    expect(
      form.find('[data-test="a2ui-form-cancel"]').attributes("aria-label")
    ).toBe(enUS.chat.a2ui.cancel);
    form.unmount();

    const choice = mount(ChoiceWidget, {
      props: {
        surface: {
          title: "Pick",
          options: [{ id: "rice", label: "Rice" }],
          multiple: false,
        },
        disabled: false,
      },
      global: {},
    });
    expect(
      choice.find('[data-test="a2ui-choice-submit"]').attributes("aria-label")
    ).toBe(enUS.chat.a2ui.submit);
    expect(
      choice.find('[data-test="a2ui-choice-cancel"]').attributes("aria-label")
    ).toBe(enUS.chat.a2ui.cancel);
    choice.unmount();
  });

  it("renders the bounded lifecycle fixture in both supported locales", () => {
    const blocks = buildA2uiLifecycleMessages()[0].blocks ?? [];
    expect(A2UI_LIFECYCLE_LONG_BODY).toHaveLength(4096);
    expect(A2UI_LIFECYCLE_LONG_LABEL).toHaveLength(256);

    for (const locale of ["en-US", "zh-CN"] as const) {
      const localeContext = createTestAppContext({ locale });
      const wrapper = localeContext.mount(StreamMessage, {
        props: { blocks: structuredClone(blocks) },
        global: {},
      });

      expect(wrapper.findAll(".agent-surface-block")).toHaveLength(7);
      expect(
        wrapper.findAll('[role="status"][aria-live="polite"]')
      ).toHaveLength(5);
      expect(wrapper.find('[data-test="a2ui-retry"]').exists()).toBe(true);
      expect(wrapper.find(".a2ui-body").text()).toHaveLength(
        A2UI_LIFECYCLE_LONG_BODY.length
      );
      expect(wrapper.find(".a2ui-form label").text()).toHaveLength(
        A2UI_LIFECYCLE_LONG_LABEL.length
      );

      const statusText = wrapper
        .findAll(".a2ui-status")
        .map((node) => node.text())
        .join(" ");
      if (locale === "zh-CN") {
        expect(statusText).toContain("操作");
      } else {
        expect(statusText).toContain("action");
      }
      expect(statusText).not.toContain("fixture_gateway_disabled");
      wrapper.unmount();
    }
  });
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
  it("names and activates collapsed and expanded navigation controls", async () => {
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

    const expand = wrapper.find('[data-test="sidebar-nav-expand"]');
    expect(expand.element.tagName).toBe("BUTTON");
    expect(expand.attributes("aria-label")).toBe(enUS.chat.expandNavigation);
    await expand.trigger("click");
    expect(wrapper.emitted("toggle-collapse")).toHaveLength(1);

    await wrapper.setProps({ collapsed: false });
    const collapse = wrapper.find('[data-test="sidebar-nav-collapse"]');
    expect(collapse.attributes("aria-label")).toBe(
      enUS.chat.collapseNavigation
    );
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

  it("removes a closed mobile drawer from focus order when it is off canvas", async () => {
    const wrapper = mount(PhyAdaptiveSidebar, {
      props: { collapsed: false, drawerOpen: false, offCanvas: true },
      slots: {
        close: "<span>Close</span>",
        default: '<button type="button">Navigation item</button>',
      },
      attachTo: document.body,
    });

    expect(wrapper.element.hasAttribute("inert")).toBe(true);
    expect(wrapper.attributes("aria-hidden")).toBe("true");

    await wrapper.setProps({ drawerOpen: true, offCanvas: false });
    await nextTick();

    expect(wrapper.get('[data-testid="sidebar-drawer-close"]').exists()).toBe(
      true
    );
    expect(wrapper.element.hasAttribute("inert")).toBe(false);
    expect(wrapper.attributes("aria-hidden")).toBeUndefined();
    wrapper.unmount();
  });

  it("closes the mobile drawer from Escape or the scrim and restores opener focus", async () => {
    const opener = document.createElement("button");
    opener.type = "button";
    document.body.append(opener);
    opener.focus();

    const wrapper = mount(PhyAdaptiveSidebar, {
      props: { drawerOpen: false },
      slots: {
        close: "Close",
        default: '<button type="button">Navigation item</button>',
      },
      attachTo: document.body,
    });

    await wrapper.setProps({ drawerOpen: true });
    await nextTick();
    const close = wrapper.get('[data-testid="sidebar-drawer-close"]');
    expect(document.activeElement).toBe(close.element);

    await close.trigger("keydown", { key: "Escape" });
    expect(wrapper.emitted("close")).toHaveLength(1);
    await wrapper.setProps({ drawerOpen: false });
    await nextTick();
    expect(document.activeElement).toBe(opener);

    await wrapper.setProps({ drawerOpen: true });
    await nextTick();
    await wrapper.get(".phy-adaptive-sidebar__scrim").trigger("click");
    expect(wrapper.emitted("close")).toHaveLength(2);
    await wrapper.setProps({ drawerOpen: false });
    await nextTick();
    expect(document.activeElement).toBe(opener);

    wrapper.unmount();
    opener.remove();
  });

  it("keeps compact navigation actions in the sequential keyboard order", () => {
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

    const actionables = wrapper.findAll("button, a");
    expect(actionables.length).toBeGreaterThan(3);
    for (const actionable of actionables) {
      expect(actionable.attributes("disabled")).toBeUndefined();
      expect(actionable.attributes("tabindex")).not.toBe("-1");
    }
    wrapper.unmount();
  });
});

describe("ChatAccessibilityV2 — Composer picker keyboard", () => {
  it("opens, arrows, activates, and returns focus on Escape", async () => {
    const tools = [...CANONICAL_AGENT_TOOLS];
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
    expect(loading.text()).toContain(enUS.chat.agentPicker.loading);
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
  const regionId = "chat-activity-stream%3Afixture-activity-msg%3Aactivity-0";

  it("links the disclosure control to the region and restores focus after toggle", async () => {
    const wrapper = mount(ChatActivity, {
      props: {
        blocks: FIXTURE_ACTIVITY_BLOCKS,
        stateKey: FIXTURE_ACTIVITY_STATE_KEY,
        expanded: false,
        streaming: true,
      },
      global: {},
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
      global: { stubs: actionStubs },
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
      global: { stubs: actionStubs },
    });
    const refresh = wrapper.find('[data-testid="action-refresh"]');
    expect(refresh.attributes("aria-busy")).toBe("true");
    expect(refresh.attributes("disabled")).toBeDefined();
    expect(refresh.classes()).toContain("is-loading");
  });
});

describe("ChatAccessibilityV2 — A2UI required input", () => {
  it("keeps the required field focusable and rejects empty submit", async () => {
    const wrapper = mount(AgentSurfaceBlock, {
      props: {
        block: FIXTURE_A2UI_REQUIRED_BLOCK,
      },
      global: {},
      attachTo: document.body,
    });

    expect(wrapper.find(".a2ui-form").exists()).toBe(true);
    const input = wrapper.find("input");
    expect(input.exists()).toBe(true);
    expect(input.attributes("disabled")).toBeUndefined();
    (input.element as HTMLElement).focus();
    expect(document.activeElement).toBe(input.element);

    await wrapper.find("form").trigger("submit.prevent");
    expect(wrapper.emitted("action")).toBeUndefined();

    await input.setValue("Oryza sativa");
    await wrapper.find("form").trigger("submit.prevent");
    expect(wrapper.emitted("action")).toEqual([
      [{ widget: "form", payload: { fields: { species: "Oryza sativa" } } }],
    ]);

    wrapper.unmount();
  });

  it("hides interaction when the surface cannot send", () => {
    const block = {
      ...FIXTURE_A2UI_REQUIRED_BLOCK,
      a2ui: {
        ...mustGet(FIXTURE_A2UI_REQUIRED_BLOCK.a2ui, "required A2UI fixture"),
        state: {
          status: "expired" as const,
          round: 1 as const,
          code: "a2ui_not_found",
        },
      },
    };
    const wrapper = mount(AgentSurfaceBlock, {
      props: {
        block,
      },
      global: {},
    });
    expect(wrapper.text()).toContain(enUS.chat.a2ui.expired);
    expect(wrapper.find(".a2ui-status").attributes("role")).toBe("status");
    expect(wrapper.find(".a2ui-status").attributes("aria-live")).toBe("polite");
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
      global: {},
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

describe("ChatAccessibilityV2 — Agent preview focus recovery", () => {
  it("keeps outside control focus when the preview closes from a pointer", async () => {
    const wrapper = mount(AgentCapabilityPopover, {
      props: {
        presentation: CANONICAL_AGENT_PRESENTATIONS.ChatAgent,
      },
      global: {},
      attachTo: document.body,
    });
    const trigger = wrapper.get("button");
    const outside = document.createElement("button");
    outside.type = "button";
    outside.textContent = "Outside";
    document.body.append(outside);

    await trigger.trigger("focus");
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
    outside.focus();
    outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    await nextTick();

    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(document.activeElement).toBe(outside);

    outside.remove();
    wrapper.unmount();
  });

  it("restores trigger focus when Escape closes the preview", async () => {
    const wrapper = mount(AgentCapabilityPopover, {
      props: {
        presentation: CANONICAL_AGENT_PRESENTATIONS.ChatAgent,
      },
      global: {},
      attachTo: document.body,
    });
    const trigger = wrapper.get("button");

    await trigger.trigger("focus");
    await wrapper.get('[role="dialog"]').trigger("keydown", { key: "Escape" });
    await nextTick();

    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(document.activeElement).toBe(trigger.element);

    wrapper.unmount();
  });
});
