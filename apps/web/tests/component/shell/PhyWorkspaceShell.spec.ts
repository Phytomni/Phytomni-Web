import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mount } from "@vue/test-utils";
import PhyWorkspaceShell from "@/components/shell/PhyWorkspaceShell.vue";

const SOURCE = readFileSync(
  resolve(__dirname, "../../../src/components/shell/PhyWorkspaceShell.vue"),
  "utf8"
);

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

  it("keeps the shared workspace shell as the only vertical scroll owner", () => {
    expect(SOURCE).toContain('data-scroll-root="workspace"');
    expect(SOURCE).toMatch(/overflow-x:\s*hidden/);
    expect(SOURCE).toMatch(/overflow-y:\s*auto/);
    expect(SOURCE).toMatch(/box-sizing:\s*border-box/);
    expect(SOURCE).toMatch(/@media\s*\(max-width:\s*1279px\)/);
    expect(SOURCE).toMatch(/@media\s*\(max-width:\s*899px\)/);
    expect(SOURCE).toMatch(/@media\s*\(max-width:\s*599px\)/);
  });

  it("uses the shared fluid workspace gutter", () => {
    expect(SOURCE).toContain(
      "--phy-workspace-gutter: var(--phy-layout-content-gutter);"
    );
  });

  it("keeps long bilingual labels in normal-flow regions", () => {
    const wrapper = mount(PhyWorkspaceShell, {
      slots: {
        header: "<h1>超长的工作区标题和操作标签 Long workspace title</h1>",
        filters: "<label>超长筛选条件 Long filter label</label>",
        default: "<p>Rows</p>",
        footer: "<button>下一页 Next page</button>",
      },
    });

    expect(wrapper.find(".phy-workspace-shell__header").exists()).toBe(true);
    expect(wrapper.find(".phy-workspace-shell__filters").exists()).toBe(true);
    expect(wrapper.find(".phy-workspace-shell__footer").exists()).toBe(true);
    expect(SOURCE).not.toMatch(/position:\s*fixed/);
  });
});
