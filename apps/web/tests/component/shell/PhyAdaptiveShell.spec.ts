import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
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

  it("turns a fullscreen artifact into a modal surface with a focus trap", async () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();

    const wrapper = mount(PhyAdaptiveShell, {
      attachTo: document.body,
      props: { artifactFullscreen: true },
      slots: {
        sidebar: '<nav data-test="sidebar">Sidebar</nav>',
        main: '<main data-test="main">Conversation</main>',
        artifact: `
          <button data-test="artifact-first" type="button">Back</button>
          <button data-test="artifact-last" type="button">Close</button>
        `,
      },
    });
    await nextTick();

    const artifact = wrapper.get(".phy-adaptive-shell__artifact");
    const main = wrapper.get(".phy-adaptive-shell__main");
    const sidebar = wrapper.get(".phy-adaptive-shell__sidebar");

    expect(artifact.attributes("role")).toBe("dialog");
    expect(artifact.attributes("aria-modal")).toBe("true");
    expect(artifact.attributes("aria-labelledby")).toBe(
      "research-artifact-title"
    );
    expect(main.element.hasAttribute("inert")).toBe(true);
    expect(main.attributes("aria-hidden")).toBe("true");
    expect(sidebar.element.hasAttribute("inert")).toBe(true);
    expect(sidebar.attributes("aria-hidden")).toBe("true");
    expect(document.activeElement).toBe(
      wrapper.get("[data-test=artifact-first]").element
    );

    await wrapper.get("[data-test=artifact-last]").trigger("keydown", {
      key: "Tab",
    });
    expect(document.activeElement).toBe(
      wrapper.get("[data-test=artifact-first]").element
    );

    await wrapper.get("[data-test=artifact-first]").trigger("keydown", {
      key: "Tab",
      shiftKey: true,
    });
    expect(document.activeElement).toBe(
      wrapper.get("[data-test=artifact-last]").element
    );

    await wrapper.setProps({ artifactFullscreen: false });
    await nextTick();
    expect(document.activeElement).toBe(opener);

    wrapper.unmount();
    opener.remove();
  });

  it("lets fullscreen override the higher-specificity collapsed grid", () => {
    expect(SHELL_SOURCE).toMatch(
      /\.phy-adaptive-shell\.phy-adaptive-shell--artifact-fullscreen\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/
    );
  });

  it("uses the dynamic viewport height after the stable fallback", () => {
    expect(SHELL_SOURCE.indexOf("height: 100vh;")).toBeGreaterThanOrEqual(0);
    expect(SHELL_SOURCE.indexOf("height: 100dvh;")).toBeGreaterThan(
      SHELL_SOURCE.indexOf("height: 100vh;")
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

  it("contains rejected fullscreen focus scheduling", () => {
    expect(SHELL_SOURCE).toContain("focusArtifact().catch(() => undefined);");
  });
});
