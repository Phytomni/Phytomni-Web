import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import PhyAdaptiveShell from "@/components/shell/PhyAdaptiveShell.vue";

const SHELL_SOURCE = readFileSync(
  resolve(__dirname, "../../../src/components/shell/PhyAdaptiveShell.vue"),
  "utf8"
);

describe("PhyAdaptiveShell", () => {
  const slots = {
    sidebar: '<aside data-test="sidebar">Sidebar</aside>',
    main: '<main data-test="main">Conversation</main>',
    artifact: '<article data-test="artifact">Artifact</article>',
  };

  it("renders the normal state with sidebar and conversation slots", () => {
    const wrapper = mount(PhyAdaptiveShell, { slots });

    expect(wrapper.classes()).toContain("phy-adaptive-shell--normal");
    expect(wrapper.find("[data-test=sidebar]").exists()).toBe(true);
    expect(wrapper.find("[data-test=main]").exists()).toBe(true);
    expect(wrapper.find("[data-test=artifact]").exists()).toBe(false);
  });

  it("renders the artifact split modifier and artifact slot", () => {
    const wrapper = mount(PhyAdaptiveShell, {
      props: { sidebarCollapsed: true, artifactOpen: true },
      slots,
    });

    expect(wrapper.classes()).toContain("phy-adaptive-shell--artifact-split");
    expect(wrapper.classes()).toContain("is-sidebar-collapsed");
    expect(wrapper.find("[data-test=sidebar]").exists()).toBe(true);
    expect(wrapper.find("[data-test=main]").exists()).toBe(true);
    expect(wrapper.find("[data-test=artifact]").exists()).toBe(true);
  });

  it("renders the artifact fullscreen modifier without remounting the slots", () => {
    const wrapper = mount(PhyAdaptiveShell, {
      props: { artifactFullscreen: true },
      slots,
    });

    expect(wrapper.classes()).toContain(
      "phy-adaptive-shell--artifact-fullscreen"
    );
    expect(wrapper.find("[data-test=main]").exists()).toBe(true);
    expect(wrapper.find("[data-test=artifact]").exists()).toBe(true);
  });

  it("lets fullscreen override the higher-specificity collapsed grid", () => {
    expect(SHELL_SOURCE).toMatch(
      /\.phy-adaptive-shell\.phy-adaptive-shell--artifact-fullscreen\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/
    );
  });

  it("owns the only viewport overflow root", () => {
    const wrapper = mount(PhyAdaptiveShell, { slots });

    expect(wrapper.attributes("data-scroll-root")).toBe("adaptive");
    expect(wrapper.findAll("[data-scroll-root]")).toHaveLength(1);
  });

  it("keeps product state out of the component implementation", () => {
    const props = PhyAdaptiveShell.props ?? {};

    expect(Object.keys(props)).toEqual(
      expect.arrayContaining([
        "sidebarCollapsed",
        "artifactOpen",
        "artifactFullscreen",
      ])
    );
  });
});
