import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mount } from "@vue/test-utils";
import PhyAdaptiveSidebar from "@/components/shell/PhyAdaptiveSidebar.vue";

const CHAT_SIDEBAR_SOURCE = readFileSync(
  resolve(__dirname, "../../../src/views/chat/sidebar.vue"),
  "utf8"
);

describe("PhyAdaptiveSidebar", () => {
  it("renders expanded and collapsed presentation states", () => {
    const expanded = mount(PhyAdaptiveSidebar, {
      slots: { default: '<nav data-test="navigation">Navigation</nav>' },
    });
    const collapsed = mount(PhyAdaptiveSidebar, {
      props: { collapsed: true },
      slots: { default: '<nav data-test="navigation">Navigation</nav>' },
    });

    expect(expanded.classes()).not.toContain("is-collapsed");
    expect(collapsed.classes()).toContain("is-collapsed");
    expect(collapsed.find("[data-test=navigation]").exists()).toBe(true);
  });

  it("emits toggle only from the optional toggle control slot", async () => {
    const wrapper = mount(PhyAdaptiveSidebar, {
      slots: {
        toggle: '<span data-test="toggle-label">Toggle</span>',
      },
    });

    await wrapper.find('[data-action="toggle"]').trigger("click");

    expect(wrapper.emitted("toggle")).toHaveLength(1);
    expect(wrapper.emitted("close")).toBeUndefined();
  });

  it("emits close when the open drawer scrim is activated", async () => {
    const wrapper = mount(PhyAdaptiveSidebar, {
      props: { drawerOpen: true },
      slots: { default: "<p>History</p>" },
    });

    expect(wrapper.classes()).toContain("is-drawer-open");
    await wrapper.find('[data-action="close"]').trigger("click");

    expect(wrapper.emitted("close")).toHaveLength(1);
    expect(wrapper.emitted("toggle")).toBeUndefined();
  });

  it("accepts only presentational state props and emits", () => {
    const props = PhyAdaptiveSidebar.props ?? {};

    expect(Object.keys(props)).toEqual(
      expect.arrayContaining(["collapsed", "drawerOpen"])
    );
    const wrapper = mount(PhyAdaptiveSidebar, {
      props: {
        drawerOpen: true,
        closeLabel: "Close navigation",
      },
      slots: {
        toggle: "Toggle",
        close: "Close",
      },
    });

    expect(wrapper.find('[data-action="toggle"]').exists()).toBe(true);
    const closeControl = wrapper.find('[data-testid="sidebar-drawer-close"]');
    expect(closeControl.exists()).toBe(true);
    expect(closeControl.attributes("aria-label")).toBe("Close navigation");
  });

  it("shows the explicit close control only for an open drawer", async () => {
    const wrapper = mount(PhyAdaptiveSidebar, {
      props: { drawerOpen: false },
      slots: { close: "Close" },
    });

    expect(wrapper.find('[data-testid="sidebar-drawer-close"]').exists()).toBe(
      false
    );
    await wrapper.setProps({ drawerOpen: true });
    await wrapper.find('[data-testid="sidebar-drawer-close"]').trigger("click");

    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("keeps navigation, history, and account regions inside one surface", () => {
    const wrapper = mount(PhyAdaptiveSidebar, {
      slots: {
        default: `
          <div class="sidebar">
            <nav data-test="top-navigation">Navigation</nav>
            <section data-test="history-region">History</section>
            <footer data-test="account-actions">Account</footer>
          </div>
        `,
      },
    });

    expect(wrapper.find(".phy-adaptive-sidebar__surface").exists()).toBe(true);
    expect(wrapper.find("[data-test=top-navigation]").exists()).toBe(true);
    expect(wrapper.find("[data-test=history-region]").exists()).toBe(true);
    expect(wrapper.find("[data-test=account-actions]").exists()).toBe(true);
  });

  it("removes the superseded sidebar frame and width owners", () => {
    expect(CHAT_SIDEBAR_SOURCE).not.toContain("PhySidebarFrame");
    expect(CHAT_SIDEBAR_SOURCE).not.toMatch(/\b(?:250|60|50)px\b/);
    expect(CHAT_SIDEBAR_SOURCE).not.toMatch(/position:\s*fixed/);
  });

  it("wires the production drawer to the localized close slot", () => {
    expect(CHAT_SIDEBAR_SOURCE).toContain("<template #close>");
    expect(CHAT_SIDEBAR_SOURCE).toContain(
      ":close-label=\"$t('common.close')\""
    );
    expect(CHAT_SIDEBAR_SOURCE).toContain("<Close />");
  });
});
