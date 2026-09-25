import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineComponent, h, inject, provide } from "vue";
import { describe, expect, it } from "vitest";
import { mountWithApp } from "../../helpers/test-app-context";
import ResearchArtifactHeader from "@/components/research/ResearchArtifactHeader.vue";

const MENU_ITEMS = [
  { id: "copy", label: "Copy" },
  { id: "close", label: "Close panel" },
] as const;

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
      command: { type: [String, Number], default: "" },
      disabled: { type: Boolean, default: false },
    },
    setup(props, { slots, attrs }) {
      const emitCommand = inject<(id: string) => void>("emitOverflowCommand");
      return () =>
        h(
          "button",
          {
            type: "button",
            ...attrs,
            disabled: props.disabled || undefined,
            "data-test":
              (attrs["data-test"] as string | undefined) ??
              `artifact-action-${props.command}`,
            onClick: () => {
              if (props.disabled || props.command === "") return;
              emitCommand?.(String(props.command));
            },
          },
          slots.default?.()
        );
    },
  }),
};

function mountHeader(
  props: Record<string, unknown> = {},
  slots: Record<string, string> = {}
) {
  return mountWithApp(ResearchArtifactHeader, {
    props: {
      title: "Report",
      backLabel: "Back",
      closeLabel: "Close",
      actionLabel: "Artifact actions",
      menuItems: [...MENU_ITEMS],
      ...props,
    },
    slots,
    global: { stubs: dropdownStubs },
  });
}

describe("ResearchArtifactHeader", () => {
  const longTitle =
    "A comparative functional and structural assessment of Os01g0177400 across cultivated rice accessions";

  it("renders title, metadata, and status with a long-title truncation hook", () => {
    const wrapper = mountHeader({
      title: longTitle,
      metadata: ["Deep Genome Agent", "Oryza sativa", "Os01g0177400"],
      status: "Complete",
      backLabel: "Back to conversation",
      closeLabel: "Close artifact",
    });
    const title = wrapper.get(".research-artifact-header__title");

    expect(title.text()).toBe(longTitle);
    expect(title.attributes("id")).toBe("research-artifact-title");
    expect(title.attributes("title")).toBe(longTitle);
    expect(title.attributes("data-truncate")).toBe("title");
    expect(
      wrapper.findAll(".research-artifact-header__metadata-item")
    ).toHaveLength(3);
    expect(wrapper.get(".research-artifact-header__status").text()).toBe(
      "Complete"
    );
  });

  it("keeps slotted and built-in actions inside the overflow owner", () => {
    const wrapper = mountHeader(
      { actionLabel: "Actions" },
      { actions: '<button data-test="download">Export PDF</button>' }
    );
    const actions = wrapper.get(".research-artifact-header__actions");

    expect(actions.attributes("data-horizontal-scroll")).toBe("actions");
    expect(actions.find("[data-test=download]").exists()).toBe(true);
    expect(actions.find("[data-test=artifact-action]").exists()).toBe(true);
    expect(actions.find("[data-test=artifact-close]").exists()).toBe(true);
  });

  it("hides the overflow control when there are no menu items", () => {
    const wrapper = mountHeader({ menuItems: [] });

    expect(wrapper.find("[data-test=artifact-action]").exists()).toBe(false);
    expect(wrapper.find("[data-test=artifact-action-copy]").exists()).toBe(
      false
    );
    expect(wrapper.find("[data-test=artifact-close]").exists()).toBe(true);
  });

  it("opens labelled menu items without emitting action from the trigger", async () => {
    const wrapper = mountHeader({
      backLabel: "Back to conversation",
      closeLabel: "Close artifact",
    });

    await wrapper.get("[data-test=artifact-back]").trigger("click");
    await wrapper.get("[data-test=artifact-action]").trigger("click");
    await wrapper.get("[data-test=artifact-close]").trigger("click");

    expect(wrapper.emitted("back")).toHaveLength(1);
    expect(wrapper.emitted("action")).toBeUndefined();
    expect(wrapper.emitted("close")).toHaveLength(1);
    expect(
      wrapper.get("[data-test=artifact-back]").attributes("aria-label")
    ).toBe("Back to conversation");
    expect(
      wrapper.get("[data-test=artifact-action]").attributes("aria-label")
    ).toBe("Artifact actions");
    expect(
      wrapper.get("[data-test=artifact-close]").attributes("aria-label")
    ).toBe("Close artifact");
  });

  it("emits the selected overflow command", async () => {
    const wrapper = mountHeader();

    await wrapper.get("[data-test=artifact-action-copy]").trigger("click");
    await wrapper.get("[data-test=artifact-action-close]").trigger("click");

    expect(wrapper.emitted("action")).toEqual([["copy"], ["close"]]);
  });

  it("emits nested Download format commands from the overflow menu", async () => {
    const wrapper = mountHeader({
      menuItems: [
        { id: "copy", label: "Copy" },
        {
          id: "download",
          label: "Download",
          children: [
            { id: "download:PDF", label: "PDF" },
            { id: "download:Word", label: "Word" },
          ],
        },
        { id: "close", label: "Close", divided: true },
      ],
    });

    await wrapper
      .get('[data-test="artifact-action-download:PDF"]')
      .trigger("click");
    await wrapper
      .get('[data-test="artifact-action-download:Word"]')
      .trigger("click");

    expect(wrapper.emitted("action")).toEqual([
      ["download:PDF"],
      ["download:Word"],
    ]);
  });

  it("formats only explicitly identified scientific agent metadata", () => {
    const base = {
      title: "Report",
      metadata: "In Silico Research Agent",
      backLabel: "Back",
      closeLabel: "Close",
      actionLabel: "Actions",
      menuItems: [...MENU_ITEMS],
    };
    expect(mountHeader(base).find("em").exists()).toBe(false);

    const formatted = mountHeader({
      ...base,
      formatScientificAgentName: true,
    });
    expect(
      formatted.get(".research-artifact-header__metadata-item em").text()
    ).toBe("In Silico");
  });

  it("marks Back as mobile-only and Close as desktop-only", () => {
    const wrapper = mountHeader();

    expect(wrapper.get("[data-test=artifact-back]").classes()).toContain(
      "research-artifact-header__back--mobile-only"
    );
    expect(wrapper.get("[data-test=artifact-close]").classes()).toContain(
      "research-artifact-header__close--desktop-only"
    );
  });

  it("does not let the action overflow owner shrink below its controls", () => {
    const source = readFileSync(
      resolve(
        __dirname,
        "../../../src/components/research/ResearchArtifactHeader.vue"
      ),
      "utf8"
    );

    expect(source).toMatch(
      /\.research-artifact-header__actions\s*{[^}]*flex:\s*0 0 auto;/s
    );
  });

  it("wraps artifact actions below the compact desktop breakpoint", () => {
    const source = readFileSync(
      resolve(
        __dirname,
        "../../../src/components/research/ResearchArtifactHeader.vue"
      ),
      "utf8"
    );

    expect(source).toMatch(
      /\.research-artifact-header__actions\s*{[^}]*flex-wrap:\s*wrap;/s
    );
    expect(source).toMatch(
      /@media\s*\(max-width:\s*899px\)[\s\S]*?\.research-artifact-header__actions\s*{[^}]*max-width:\s*none;/s
    );
  });

  it("styles controls supplied through the actions slot", () => {
    const source = readFileSync(
      resolve(
        __dirname,
        "../../../src/components/research/ResearchArtifactHeader.vue"
      ),
      "utf8"
    );

    expect(source).toMatch(
      /:slotted\(\.research-artifact-header__control\)\s*{/s
    );
  });
});
