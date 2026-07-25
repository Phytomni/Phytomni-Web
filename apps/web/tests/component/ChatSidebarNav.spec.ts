import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createMemoryHistory, createRouter } from "vue-router";
import { nextTick } from "vue";
import ChatSidebarNav from "@/views/chat/components/ChatSidebarNav.vue";
import ChatSidebar from "@/views/chat/ChatSidebar.vue";
import { setViewport } from "../helpers/responsiveMatrix";
import { SIDEBAR_COLLAPSED_PREFERENCE_KEY } from "@/views/chat/composables/useSidebarResponsive";
import { createTestAppContext } from "../helpers/test-app-context";

const NAV_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/components/ChatSidebarNav.vue"),
  "utf8"
);

const baseProps = {
  collapsed: false,
  activeItem: "",
  userName: "Ada Lovelace",
  canExploreAgents: true,
  canHistory: true,
  canProfile: true,
  canCloudStorage: true,
  canUserManagement: true,
  canPermissionManagement: true,
  canSystemMonitor: true,
  canGlobalConfig: true,
  canAdminManagement: true,
  canHelp: true,
  showAgentsList: false,
};

const mountNav = (props: Record<string, unknown> = {}, slots = {}) =>
  createTestAppContext().mount(ChatSidebarNav, {
    props: { ...baseProps, ...props },
    slots,
    global: {
      mocks: {
        $t: (key: string) => `t:${key}`,
      },
      stubs: {
        ElButton: {
          emits: ["click"],
          template:
            '<button v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>',
        },
        ElIcon: {
          template: '<span class="icon-stub"><slot /></span>',
        },
        ElDropdown: {
          name: "ElDropdown",
          emits: ["command"],
          template:
            '<div class="dropdown-stub"><slot /><slot name="dropdown" /></div>',
        },
        ElDropdownMenu: {
          template: '<div class="dropdown-menu-stub"><slot /></div>',
        },
        ElDropdownItem: {
          props: ["command"],
          template: '<button class="dropdown-item-stub"><slot /></button>',
        },
        ElAvatar: {
          template: '<span class="avatar-stub"><slot /></span>',
        },
        LangSwitch: {
          template: '<button data-test="language-switch">Language</button>',
        },
        ThemeSwitch: {
          template: '<button data-test="theme-switch">Theme</button>',
        },
      },
    },
  });

const mountChatSidebarWithExistingStubs = () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/:pathMatch(.*)*", component: { template: "<div />" } }],
  });

  return createTestAppContext({ router }).mount(ChatSidebar, {
    props: { chatList: [] },
    global: {
      mocks: {
        $t: (key: string) => `t:${key}`,
      },
      stubs: {
        PhyAdaptiveSidebar: {
          props: ["collapsed"],
          emits: ["close"],
          template:
            '<aside class="phy-adaptive-sidebar" :class="{ \'is-collapsed\': collapsed }"><button data-test="sidebar-close" @click="$emit(\'close\')" /><slot /></aside>',
        },
        AgentDisplayName: {
          props: ["label"],
          template: "<span>{{ label }}</span>",
        },
        ChatHistoryList: true,
        ElButton: {
          emits: ["click"],
          template:
            '<button v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>',
        },
        ElIcon: { template: "<span><slot /></span>" },
        ElDropdown: {
          template: '<div><slot /><slot name="dropdown" /></div>',
        },
        ElDropdownMenu: { template: "<div><slot /></div>" },
        ElDropdownItem: { template: "<button><slot /></button>" },
        ElAvatar: true,
        ElDialog: true,
        ElForm: true,
        ElFormItem: true,
        ElInput: true,
        LangSwitch: true,
        ThemeSwitch: true,
      },
    },
  });
};

describe("ChatSidebarNav", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it("expands the compact rail only while the Agent list is open", async () => {
    localStorage.setItem(SIDEBAR_COLLAPSED_PREFERENCE_KEY, "true");
    setViewport(1024, 768);
    const wrapper = mountChatSidebarWithExistingStubs();
    await nextTick();

    await wrapper
      .get('[data-test="sidebar-nav-explore-agent"]')
      .trigger("click");
    expect(wrapper.get(".phy-adaptive-sidebar").classes()).not.toContain(
      "is-collapsed"
    );
    expect(localStorage.getItem(SIDEBAR_COLLAPSED_PREFERENCE_KEY)).toBe("true");

    await wrapper.get('[data-test="sidebar-close"]').trigger("click");
    expect(wrapper.get(".phy-adaptive-sidebar").classes()).toContain(
      "is-collapsed"
    );

    await wrapper
      .get('[data-test="sidebar-nav-explore-agent"]')
      .trigger("click");
    await wrapper.get('[data-test="sidebar-nav-favorites"]').trigger("click");
    expect(
      wrapper.find('[data-testid="chat-explore-agents-list"]').exists()
    ).toBe(false);

    await wrapper
      .get('[data-test="sidebar-nav-explore-agent"]')
      .trigger("click");
    await wrapper
      .get('[data-testid="chat-explore-agents-list"] .agent-option')
      .trigger("click");
    expect(wrapper.get(".phy-adaptive-sidebar").classes()).toContain(
      "is-collapsed"
    );
    wrapper.unmount();
  });

  it("closes compact disclosure when the viewport leaves the compact range", async () => {
    localStorage.setItem(SIDEBAR_COLLAPSED_PREFERENCE_KEY, "true");
    setViewport(1024, 768);
    const wrapper = mountChatSidebarWithExistingStubs();
    await nextTick();

    await wrapper
      .get('[data-test="sidebar-nav-explore-agent"]')
      .trigger("click");
    expect(wrapper.get(".phy-adaptive-sidebar").classes()).not.toContain(
      "is-collapsed"
    );

    setViewport(1280, 768);
    await nextTick();
    expect(wrapper.get(".phy-adaptive-sidebar").classes()).toContain(
      "is-collapsed"
    );

    setViewport(899, 768);
    vi.advanceTimersByTime(100);
    await nextTick();
    expect(wrapper.get(".phy-adaptive-sidebar").classes()).not.toContain(
      "is-collapsed"
    );
    expect(localStorage.getItem(SIDEBAR_COLLAPSED_PREFERENCE_KEY)).toBe("true");
    wrapper.unmount();
  });

  it("closes disclosure when resizing from 1280 into the compact range", async () => {
    localStorage.setItem(SIDEBAR_COLLAPSED_PREFERENCE_KEY, "true");
    setViewport(1280, 768);
    const wrapper = mountChatSidebarWithExistingStubs();
    await nextTick();

    await wrapper
      .get('[data-test="sidebar-nav-explore-agent"]')
      .trigger("click");
    expect(
      wrapper.find('[data-testid="chat-explore-agents-list"]').exists()
    ).toBe(true);

    setViewport(1279, 768);
    vi.advanceTimersByTime(100);
    await nextTick();

    expect(
      wrapper.find('[data-testid="chat-explore-agents-list"]').exists()
    ).toBe(false);
    expect(wrapper.get(".phy-adaptive-sidebar").classes()).toContain(
      "is-collapsed"
    );
    expect(localStorage.getItem(SIDEBAR_COLLAPSED_PREFERENCE_KEY)).toBe("true");
    wrapper.unmount();
  });

  it("renders expanded labels and compactly hides them", () => {
    const expanded = mountNav();
    expect(expanded.text()).toContain("t:chat.newChat");
    expect(expanded.text()).toContain("t:chat.exploreAgent");
    expect(expanded.text()).toContain("Ada Lovelace");

    const collapsed = mountNav({ collapsed: true });
    expect(collapsed.text()).not.toContain("t:chat.newChat");
    expect(
      collapsed.find('[data-testid="chat-account-identity"]').exists()
    ).toBe(true);
    expect(
      collapsed
        .find('[data-testid="chat-account-identity"]')
        .attributes("aria-hidden")
    ).toBe("true");
    expect(collapsed.find(".sidebar-nav").classes()).toContain("collapsed");
  });

  it("emits semantic navigation and collapse actions", async () => {
    const wrapper = mountNav();

    await wrapper.find('[data-test="sidebar-nav-new-chat"]').trigger("click");
    await wrapper
      .find('[data-test="sidebar-nav-gene-display"]')
      .trigger("click");
    await wrapper.find('[data-test="sidebar-nav-favorites"]').trigger("click");
    const helpDropdown = wrapper.findAllComponents({ name: "ElDropdown" })[0];
    helpDropdown.vm.$emit("command", "help");
    helpDropdown.vm.$emit("command", "tutorial");
    helpDropdown.vm.$emit("command", "architecture");
    await wrapper
      .find('[data-test="sidebar-nav-explore-agent"]')
      .trigger("click");
    await wrapper.find('[data-test="sidebar-nav-collapse"]').trigger("click");

    expect(wrapper.emitted("new-chat")).toHaveLength(1);
    expect(wrapper.emitted("gene-display")).toHaveLength(1);
    expect(wrapper.emitted("favorites")).toHaveLength(1);
    expect(wrapper.emitted("help")).toHaveLength(1);
    expect(wrapper.emitted("tutorial")).toHaveLength(1);
    expect(wrapper.emitted("show-architecture")).toHaveLength(1);
    expect(wrapper.emitted("explore-agent")).toHaveLength(1);
    expect(wrapper.emitted("toggle-collapse")).toHaveLength(1);
  });

  it("moves one selected state from Start New to Explore Agents", async () => {
    const wrapper = mountNav({ activeItem: "new-chat" });
    const newChat = wrapper.get('[data-test="sidebar-nav-new-chat"]');
    const explore = wrapper.get('[data-test="sidebar-nav-explore-agent"]');

    expect(wrapper.findAll(".sidebar-nav-row.is-active")).toHaveLength(1);
    expect(newChat.classes()).toContain("is-active");
    expect(newChat.attributes("aria-current")).toBe("page");
    expect(explore.classes()).not.toContain("is-active");

    await wrapper.setProps({ activeItem: "explore-agent" });

    expect(wrapper.findAll(".sidebar-nav-row.is-active")).toHaveLength(1);
    expect(newChat.classes()).not.toContain("is-active");
    expect(newChat.attributes("aria-current")).toBeUndefined();
    expect(explore.classes()).toContain("is-active");
    expect(explore.attributes("aria-current")).toBe("page");
  });

  it("forwards account commands and renders the temporary agent slot", async () => {
    const wrapper = mountNav(
      { showAgentsList: true },
      {
        "explore-agents":
          '<button data-test="agent-popover-anchor">Knowledge Agent</button>',
      }
    );

    expect(wrapper.find('[data-test="agent-popover-anchor"]').exists()).toBe(
      true
    );

    const dropdown = wrapper
      .findAllComponents({ name: "ElDropdown" })
      .find((item) => item.attributes("data-test") === "sidebar-nav-account");
    if (!dropdown) throw new Error("account dropdown not found");
    dropdown.vm.$emit("command", "profile");
    expect(wrapper.emitted("account-command")).toEqual([["profile"]]);
  });

  it("exposes the Explore Agents disclosure state", () => {
    const collapsed = mountNav({ showAgentsList: false });
    const expanded = mountNav({ showAgentsList: true });

    expect(
      collapsed
        .get('[data-test="sidebar-nav-explore-agent"]')
        .attributes("aria-expanded")
    ).toBe("false");
    expect(
      expanded
        .get('[data-test="sidebar-nav-explore-agent"]')
        .attributes("aria-expanded")
    ).toBe("true");
    expect(
      expanded
        .get('[data-test="sidebar-nav-explore-agent"]')
        .attributes("aria-controls")
    ).toBe("chat-explore-agents-list");
    expect(
      expanded.get("#chat-explore-agents-list").attributes("data-testid")
    ).toBe("chat-explore-agents-list");
  });

  it("keeps support and legal destinations in the sidebar", () => {
    const wrapper = mountNav();
    const hrefs = wrapper.findAll("a").map((link) => link.attributes("href"));
    expect(hrefs).toContain("/terms");
    expect(hrefs).toContain("/privacy");
    expect(hrefs.some((href) => href?.includes("beian.miit.gov.cn"))).toBe(
      true
    );
    expect(wrapper.find('[data-test="language-switch"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="theme-switch"]').exists()).toBe(true);
  });

  it("omits permission-hidden navigation items", () => {
    const wrapper = mountNav({
      canExploreAgents: false,
      canHistory: false,
      canProfile: false,
      canCloudStorage: false,
      canUserManagement: false,
      canPermissionManagement: false,
      canSystemMonitor: false,
      canGlobalConfig: false,
      canAdminManagement: false,
    });

    expect(
      wrapper.find('[data-test="sidebar-nav-explore-agent"]').exists()
    ).toBe(false);
    expect(wrapper.findAll(".dropdown-item-stub")).toHaveLength(6);
    expect(wrapper.text()).toContain("t:user.feedback");
    expect(wrapper.text()).toContain("t:user.changePassword");
    expect(wrapper.text()).toContain("t:user.logout");
  });

  it("exposes exactly one primary navigation action", () => {
    const wrapper = mountNav();
    const primaryActions = wrapper.findAll(
      '[data-testid="chat-primary-action"]'
    );
    expect(primaryActions).toHaveLength(1);
    expect(primaryActions[0].classes()).toContain("sidebar-primary-action");
    expect(
      wrapper.findAll(".sidebar-nav-row.sidebar-primary-action")
    ).toHaveLength(1);
  });

  it("locks the calm sidebar hierarchy to shared theme geometry", () => {
    expect(NAV_SOURCE).toContain("font-size: 20px;");
    expect(NAV_SOURCE).toContain("font-weight: 600;");
    expect(NAV_SOURCE).toContain("border-radius: var(--phy-radius-md);");
    expect(NAV_SOURCE).not.toContain(
      "min-height: var(--phy-control-height-primary);"
    );
    expect(NAV_SOURCE).not.toContain("border-radius: 50%;");
    expect(NAV_SOURCE).not.toContain("#f56c6c");
  });

  it("uses one soft pill selection skin for every primary destination", () => {
    expect(NAV_SOURCE).toContain("border-radius: var(--phy-radius-pill);");
    expect(NAV_SOURCE).toMatch(
      /\.sidebar-nav-row\s*\{[\s\S]*?&\.is-active[\s\S]*?background-color:\s*var\(--phy-color-primary-soft\);/
    );
    const primaryBlock = NAV_SOURCE.slice(
      NAV_SOURCE.indexOf(".sidebar-primary-action {"),
      NAV_SOURCE.indexOf(".sidebar-utility-row {")
    );
    expect(primaryBlock).not.toContain("var(--phy-color-action-fill)");
    expect(primaryBlock).not.toContain("var(--phy-color-on-action)");
    expect(primaryBlock).not.toContain("::before");
  });

  it("keeps secondary destinations as quiet rows without primary styling", () => {
    const wrapper = mountNav({ activeItem: "knowledge-base" });
    const secondaryRows = wrapper.findAll(
      ".sidebar-nav-row:not(.sidebar-primary-action)"
    );
    expect(secondaryRows.length).toBeGreaterThanOrEqual(3);
    secondaryRows.forEach((row) => {
      expect(row.classes()).not.toContain("sidebar-primary-action");
    });
    expect(
      wrapper.find('[data-test="sidebar-nav-gene-display"]').classes()
    ).toContain("is-active");
    expect(
      wrapper
        .find('[data-test="sidebar-nav-gene-display"]')
        .attributes("aria-current")
    ).toBe("page");
  });

  it("places help utilities in the bottom utility group once", () => {
    const wrapper = mountNav();
    const utility = wrapper.find(".sidebar-nav-utility");
    expect(utility.exists()).toBe(true);
    expect(utility.find('[data-test="sidebar-nav-tutorial"]').exists()).toBe(
      true
    );
    expect(wrapper.find(".sidebar-nav-secondary").exists()).toBe(true);
    expect(
      wrapper
        .find(".sidebar-nav-secondary")
        .find(".sidebar-nav-utility")
        .exists()
    ).toBe(false);
  });

  it("keeps compact accessibility labels and selected state", () => {
    const collapsed = mountNav({ collapsed: true, activeItem: "favorites" });
    const favorites = collapsed.find('[data-test="sidebar-nav-favorites"]');
    expect(favorites.attributes("aria-label")).toBeTruthy();
    expect(favorites.classes()).toContain("is-active");
    const primary = collapsed.find('[data-testid="chat-primary-action"]');
    expect(primary.attributes("aria-label")).toBeTruthy();
  });

  it("keeps stable capture hooks on the real controls", () => {
    const expanded = mountNav();
    expect(
      expanded.findAll('[data-testid="chat-primary-action"]')
    ).toHaveLength(1);
    expect(
      expanded.findAll('[data-testid="chat-account-identity"]')
    ).toHaveLength(1);
    expect(
      expanded.find('[data-testid="chat-account-identity"]').text()
    ).toContain("Ada Lovelace");
    expect(expanded.find(".app-title-label").attributes("title")).toBe(
      "t:chat.appTitle"
    );

    const collapsed = mountNav({ collapsed: true });
    expect(
      collapsed.findAll('[data-testid="chat-account-identity"]')
    ).toHaveLength(1);
    expect(
      collapsed
        .find('[data-testid="chat-account-identity"]')
        .attributes("aria-hidden")
    ).toBe("true");
  });

  it("keeps one identity hook across expanded, compact, and drawer mounts", () => {
    const expanded = mountNav();
    expect(
      expanded.findAll('[data-testid="chat-account-identity"]')
    ).toHaveLength(1);
    expect(
      expanded
        .find('[data-testid="chat-account-identity"]')
        .attributes("aria-hidden")
    ).toBeUndefined();

    const compact = mountNav({ collapsed: true });
    expect(
      compact.findAll('[data-testid="chat-account-identity"]')
    ).toHaveLength(1);
    expect(
      compact
        .find('[data-testid="chat-account-identity"]')
        .attributes("aria-hidden")
    ).toBe("true");

    const closedDrawer = mountNav({ offCanvas: true });
    expect(
      closedDrawer.findAll('[data-testid="chat-account-identity"]')
    ).toHaveLength(1);
    expect(
      closedDrawer
        .find('[data-testid="chat-account-identity"]')
        .attributes("aria-hidden")
    ).toBe("true");

    const openDrawer = mountNav({ offCanvas: false });
    expect(
      openDrawer.findAll('[data-testid="chat-account-identity"]')
    ).toHaveLength(1);
    expect(
      openDrawer
        .find('[data-testid="chat-account-identity"]')
        .attributes("aria-hidden")
    ).toBeUndefined();
  });

  it("exposes the primary action when the mobile drawer is open", () => {
    const closedDrawer = mountNav({ offCanvas: true });
    expect(
      closedDrawer.find('[data-testid="chat-primary-action"]').exists()
    ).toBe(true);
    expect(
      closedDrawer
        .find('[data-testid="chat-account-identity"]')
        .attributes("aria-hidden")
    ).toBe("true");

    const openDrawer = mountNav({ offCanvas: false });
    const primaryAction = openDrawer.find(
      '[data-testid="chat-primary-action"]'
    );
    expect(primaryAction.exists()).toBe(true);
    expect(primaryAction.classes()).toContain("sidebar-primary-action");
    expect(openDrawer.text()).toContain("t:chat.newChat");
    expect(
      openDrawer
        .find('[data-testid="chat-account-identity"]')
        .attributes("aria-hidden")
    ).toBeUndefined();
  });

  it("emits each help utility command once under guest permission state", async () => {
    const wrapper = mountNav({ canHelp: false });
    const helpDropdown = wrapper
      .findAllComponents({ name: "ElDropdown" })
      .find((item) => item.find('[data-test="sidebar-nav-tutorial"]').exists());
    if (!helpDropdown) throw new Error("utility help dropdown not found");
    helpDropdown.vm.$emit("command", "tutorial");
    expect(wrapper.emitted("tutorial")).toHaveLength(1);
    expect(wrapper.emitted("help")).toBeUndefined();
    expect(wrapper.emitted("show-architecture")).toBeUndefined();
  });
});
