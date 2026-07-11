import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import PhyAdaptiveSidebar from "@/components/shell/PhyAdaptiveSidebar.vue";

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
      slots: {
        toggle: "Toggle",
        close: "Close",
      },
    });

    expect(wrapper.find('[data-action="toggle"]').exists()).toBe(true);
    expect(wrapper.find('[data-action="close"]').exists()).toBe(true);
  });
});
