import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import PhyDataToolbar from "@/components/shell/PhyDataToolbar.vue";

describe("PhyDataToolbar", () => {
  it("keeps filters and actions in separate groups", () => {
    const wrapper = mount(PhyDataToolbar, {
      slots: {
        filters: '<label data-test="filter">Search</label>',
        actions: '<button data-test="action">Add</button>',
      },
    });

    expect(
      wrapper.find(".phy-data-toolbar__filters [data-test=filter]").exists()
    ).toBe(true);
    expect(
      wrapper.find(".phy-data-toolbar__actions [data-test=action]").exists()
    ).toBe(true);
  });

  it("uses the default slot as the filter group", () => {
    const wrapper = mount(PhyDataToolbar, {
      slots: { default: '<input data-test="filter" />' },
    });

    expect(
      wrapper.find(".phy-data-toolbar__filters [data-test=filter]").exists()
    ).toBe(true);
    expect(wrapper.find(".phy-data-toolbar__actions").exists()).toBe(false);
  });

  it("marks the toolbar as wrappable for narrow layouts", () => {
    const wrapper = mount(PhyDataToolbar);

    expect(wrapper.classes()).toContain("is-wrappable");
    expect(wrapper.classes()).toContain("phy-data-toolbar--wrap");
  });
});
