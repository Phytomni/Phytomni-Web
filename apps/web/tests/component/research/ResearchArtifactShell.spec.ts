import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineComponent, h, inject, provide } from "vue";
import { mountWithApp } from "../../helpers/test-app-context";
import ResearchArtifactShell from "@/components/research/ResearchArtifactShell.vue";

const SHELL_SOURCE = readFileSync(
  resolve(
    __dirname,
    "../../../src/components/research/ResearchArtifactShell.vue"
  ),
  "utf8"
);

const tabs = {
  content: "Report",
  evidence: "Evidence",
  activity: "Activity",
  downloads: "Downloads",
};

const dropdownStubs = {
  ElDropdown: defineComponent({
    name: "ElDropdown",
    emits: ["command"],
    setup(_, { emit, slots }) {
      provide("emitOverflowCommand", (id: string) => emit("command", id));
      return () =>
        h("div", { class: "el-dropdown-stub" }, [
          slots.default?.(),
          slots.dropdown?.(),
        ]);
    },
  }),
  ElDropdownMenu: defineComponent({
    name: "ElDropdownMenu",
    setup(_, { slots }) {
      return () => h("div", slots.default?.());
    },
  }),
  ElDropdownItem: defineComponent({
    name: "ElDropdownItem",
    props: {
      command: { type: [String, Number], required: true },
    },
    setup(props, { slots }) {
      const emitCommand = inject<(id: string) => void>("emitOverflowCommand");
      return () =>
        h(
          "button",
          {
            type: "button",
            "data-test": `artifact-action-${props.command}`,
            onClick: () => emitCommand?.(String(props.command)),
          },
          slots.default?.()
        );
    },
  }),
};

function mountShell(
  tab: keyof typeof tabs = "content",
  contentLayout: "reading" | "wide" = "reading",
  visibleTabs?: Array<keyof typeof tabs>
) {
  return mountWithApp(ResearchArtifactShell, {
    attachTo: document.body,
    props: {
      title: "Os01g0177400 functional analysis",
      metadata: ["Deep Genome Agent", "Oryza sativa"],
      status: "Complete",
      tab,
      ...(visibleTabs ? { tabs: visibleTabs } : {}),
      contentLayout,
      tabLabels: tabs,
      backLabel: "Back to conversation",
      closeLabel: "Close artifact",
      actionLabel: "Artifact actions",
      menuItems: [
        { id: "copy", label: "Copy" },
        { id: "close", label: "Close panel" },
      ],
    },
    slots: {
      toc: '<nav data-test="toc">Contents</nav>',
      content: '<article data-test="content">Report body</article>',
      evidence: '<section data-test="evidence">Evidence body</section>',
      activity: '<section data-test="activity">Activity body</section>',
      downloads: '<section data-test="downloads">Downloads body</section>',
    },
    global: { stubs: dropdownStubs },
  });
}

describe("ResearchArtifactShell", () => {
  it("renders every layout slot while keeping inactive tab panels mounted", () => {
    const wrapper = mountShell();

    expect(wrapper.find("[data-test=toc]").exists()).toBe(true);
    expect(wrapper.find("[data-test=content]").exists()).toBe(true);
    expect(wrapper.find("[data-test=evidence]").exists()).toBe(true);
    expect(wrapper.find("[data-test=activity]").exists()).toBe(true);
    expect(wrapper.find("[data-test=downloads]").exists()).toBe(true);
    expect(wrapper.find('[data-test="bot-report-content"]').exists()).toBe(
      true
    );
    expect(wrapper.find('[data-test="bot-report-evidence"]').exists()).toBe(
      true
    );
    expect(wrapper.find('[data-test="bot-report-activity"]').exists()).toBe(
      true
    );
    expect(wrapper.find('[data-test="bot-report-downloads"]').exists()).toBe(
      true
    );
    expect(
      wrapper
        .find(".research-artifact-shell__narrative-content.phy-reading")
        .exists()
    ).toBe(true);
    expect(
      wrapper
        .find("[data-test=evidence]")
        .element.closest(".research-artifact-shell__narrative-content")
    ).toBeNull();
  });

  it("exposes a header slot in place of the default header", () => {
    const wrapper = mountWithApp(ResearchArtifactShell, {
      props: {
        title: "Report",
        tab: "content",
        tabLabels: tabs,
        backLabel: "Back",
        closeLabel: "Close",
        actionLabel: "Actions",
      },
      slots: { header: '<header data-test="custom-header">Custom</header>' },
    });

    expect(wrapper.find("[data-test=custom-header]").exists()).toBe(true);
    expect(wrapper.find(".research-artifact-header").exists()).toBe(false);
  });

  it("forwards scientific agent formatting to the default header", () => {
    const wrapper = mountWithApp(ResearchArtifactShell, {
      props: {
        title: "Report",
        metadata: "In Silico Research Agent",
        formatScientificAgentName: true,
        tab: "content",
        tabLabels: tabs,
        backLabel: "Back",
        closeLabel: "Close",
        actionLabel: "Actions",
      },
    });

    expect(
      wrapper.get(".research-artifact-header__metadata-item em").text()
    ).toBe("In Silico");
  });

  it("forwards back, close, and selected overflow commands from its default header", async () => {
    const wrapper = mountShell();

    await wrapper.get("[data-test=artifact-back]").trigger("click");
    await wrapper.get("[data-test=artifact-close]").trigger("click");
    await wrapper.get("[data-test=artifact-action]").trigger("click");

    expect(wrapper.emitted("back")).toHaveLength(1);
    expect(wrapper.emitted("close")).toHaveLength(1);
    expect(wrapper.emitted("action")).toBeUndefined();

    await wrapper.get("[data-test=artifact-action-copy]").trigger("click");
    expect(wrapper.emitted("action")).toEqual([["copy"]]);
  });

  it("links each tab to its labelled panel with roving tabindex", () => {
    const wrapper = mountShell("evidence");
    const tabButtons = wrapper.findAll('[role="tab"]');
    const panels = wrapper.findAll('[role="tabpanel"]');

    expect(wrapper.get('[role="tablist"]').attributes("aria-label")).toBe(
      "Report sections"
    );
    expect(tabButtons).toHaveLength(4);
    expect(panels).toHaveLength(4);

    tabButtons.forEach((button, index) => {
      const selected = index === 1;
      const panel = panels[index];

      expect(button.attributes("tabindex")).toBe(selected ? "0" : "-1");
      expect(button.attributes("aria-selected")).toBe(String(selected));
      expect(button.attributes("aria-controls")).toBe(panel.attributes("id"));
      expect(panel.attributes("aria-labelledby")).toBe(button.attributes("id"));
      expect(panel.attributes("hidden")).toBe(selected ? undefined : "");
    });
  });

  it("mounts only explicitly enabled tabs and keeps keyboard focus within them", async () => {
    const wrapper = mountShell("activity", "reading", ["activity"]);

    expect(wrapper.findAll('[role="tab"]')).toHaveLength(1);
    expect(wrapper.findAll('[role="tabpanel"]')).toHaveLength(1);
    expect(wrapper.get('[data-tab-id="activity"]').attributes("tabindex")).toBe(
      "0"
    );
    expect(
      wrapper.get('[data-panel-id="activity"]').attributes("hidden")
    ).toBeUndefined();
    expect(wrapper.find('[data-test="activity"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="content"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="evidence"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="downloads"]').exists()).toBe(false);

    await wrapper.get('[data-tab-id="activity"]').trigger("keydown", {
      key: "ArrowRight",
    });

    expect(wrapper.emitted("tab")?.at(-1)).toEqual(["activity"]);
    expect(document.activeElement).toBe(
      wrapper.get('[data-tab-id="activity"]').element
    );
    wrapper.unmount();
  });

  it.each([
    ["content", "ArrowLeft", "downloads"],
    ["downloads", "ArrowRight", "content"],
    ["activity", "Home", "content"],
    ["content", "End", "downloads"],
  ] as const)(
    "activates %s -> %s with %s and moves the roving focus",
    async (initial, key, expected) => {
      const wrapper = mountShell(initial);
      const initialTab = wrapper.get(`[data-tab-id="${initial}"]`);

      await initialTab.trigger("keydown", { key });
      const expectedTab = wrapper.get(`[data-tab-id="${expected}"]`);

      expect(wrapper.emitted("tab")?.at(-1)).toEqual([expected]);
      expect(expectedTab.attributes("tabindex")).toBe("0");
      expect(expectedTab.attributes("aria-selected")).toBe("true");
      expect(document.activeElement).toBe(expectedTab.element);
      expect(
        wrapper.get(`[data-panel-id="${expected}"]`).attributes("hidden")
      ).toBeUndefined();

      wrapper.unmount();
    }
  );

  it("emits tab activation for pointer input", async () => {
    const wrapper = mountShell();

    await wrapper.get('[data-tab-id="activity"]').trigger("click");

    expect(wrapper.emitted("tab")?.at(-1)).toEqual(["activity"]);
    expect(
      wrapper.get('[data-tab-id="activity"]').attributes("aria-selected")
    ).toBe("true");
  });

  it("publishes desktop-column and mobile-fullscreen modifier hooks", () => {
    const wrapper = mountShell();

    expect(wrapper.classes()).toContain(
      "research-artifact-shell--desktop-column"
    );
    expect(wrapper.classes()).toContain(
      "research-artifact-shell--mobile-fullscreen"
    );
    expect(wrapper.attributes("data-scroll-owner")).toBe("artifact-body");
    expect(wrapper.get("[data-test=artifact-back]").classes()).toContain(
      "research-artifact-header__back--mobile-only"
    );
  });

  it("supports a wide narrative layout for documents with an embedded TOC", () => {
    const wrapper = mountShell("content", "wide");

    expect(
      wrapper.find(".research-artifact-shell__narrative-content").classes()
    ).toContain("research-artifact-shell__narrative-content--wide");
  });

  it("contains rejected roving-focus scheduling", () => {
    expect(SHELL_SOURCE).toContain("}).catch(() => undefined);");
  });
});
