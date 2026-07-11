import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import ChatSidebarNav from "@/views/chat/components/ChatSidebarNav.vue";

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
  mount(ChatSidebarNav, {
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

describe("ChatSidebarNav", () => {
  it("renders expanded labels and compactly hides them", () => {
    const expanded = mountNav();
    expect(expanded.text()).toContain("t:chat.newChat");
    expect(expanded.text()).toContain("Ada Lovelace");

    const collapsed = mountNav({ collapsed: true });
    expect(collapsed.text()).not.toContain("t:chat.newChat");
    expect(collapsed.text()).not.toContain("Ada Lovelace");
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
});
