import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import PhyWorkspaceShell from "@/components/shell/PhyWorkspaceShell.vue";

describe("PhyWorkspaceShell", () => {
  it("renders the named page regions and default content", () => {
    const wrapper = mount(PhyWorkspaceShell, {
      slots: {
        header: '<h1 data-test="header">Users</h1>',
        filters: '<div data-test="filters">Filters</div>',
        default: '<div data-test="content">Rows</div>',
        footer: '<div data-test="footer">Pagination</div>',
      },
    });

    expect(wrapper.find("[data-test=header]").exists()).toBe(true);
    expect(wrapper.find("[data-test=filters]").exists()).toBe(true);
    expect(wrapper.find("[data-test=content]").exists()).toBe(true);
    expect(wrapper.find("[data-test=footer]").exists()).toBe(true);
  });

  it("owns exactly one vertical scroll root", () => {
    const wrapper = mount(PhyWorkspaceShell, {
      slots: { default: "<p>Content</p>" },
    });

    expect(wrapper.findAll(".phy-workspace-shell")).toHaveLength(1);
    expect(
      wrapper.findAll(".phy-workspace-shell[data-scroll-root]")
    ).toHaveLength(1);
    expect(wrapper.findAll("[data-scroll-root]")).toHaveLength(1);
  });

  it("does not render empty optional regions", () => {
    const wrapper = mount(PhyWorkspaceShell, {
      slots: { default: "<p>Content</p>" },
    });

    expect(wrapper.find(".phy-workspace-shell__header").exists()).toBe(false);
    expect(wrapper.find(".phy-workspace-shell__filters").exists()).toBe(false);
    expect(wrapper.find(".phy-workspace-shell__footer").exists()).toBe(false);
  });
});
