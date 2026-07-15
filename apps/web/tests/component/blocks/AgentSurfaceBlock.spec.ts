import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import AgentSurfaceBlock from "@/views/chat/components/blocks/AgentSurfaceBlock.vue";
import type { ContentBlock } from "@/views/chat/types";

describe("AgentSurfaceBlock", () => {
  it("forwards a confirm intent without creating a transport envelope", async () => {
    const block: ContentBlock = {
      type: "agent-surface",
      authority: "agent",
      interactive: true,
      a2ui: {
        surface: {
          catalog_version: "v1.0",
          surface_id: "s1",
          widget: "confirm",
          props: {
            title: "Go?",
            confirm_label: "Yes",
            cancel_label: "No",
          },
        },
        state: { status: "ready", round: 1 },
      },
    };
    const w = mount(AgentSurfaceBlock, { props: { block } });
    const buttons = w.findAll("button");
    await buttons[buttons.length - 1].trigger("click");
    expect(w.emitted("action")).toEqual([
      [{ widget: "confirm", payload: { accepted: true } }],
    ]);
    expect(w.emitted("action")?.[0]?.[0]).not.toHaveProperty("surfaceId");
    expect(w.emitted("retry")).toBeUndefined();
  });

  it("forwards typed Choice intents from the decoded surface only", async () => {
    const block: ContentBlock = {
      type: "agent-surface",
      authority: "agent",
      interactive: true,
      a2ui: {
        surface: {
          catalog_version: "v1.0",
          surface_id: "choice-surface",
          widget: "choice",
          props: {
            title: "Decoded title",
            options: [{ id: "decoded", label: "Decoded option" }],
            multiple: false,
          },
        },
        state: { status: "ready", round: 1 },
      },
    };
    const w = mount(AgentSurfaceBlock, { props: { block } });
    expect(w.find(".a2ui-title").text()).toBe("Decoded title");
    const radioGroup = w.findComponent({ name: "ElRadioGroup" });
    await radioGroup.vm.$emit("update:modelValue", "decoded");
    await w.find('[data-test="a2ui-choice-submit"]').trigger("click");
    expect(w.emitted("action")).toEqual([
      [{ widget: "choice", payload: { selected: "decoded" } }],
    ]);

    await w.find('[data-test="a2ui-choice-cancel"]').trigger("click");
    expect(w.emitted("action")).toEqual([
      [{ widget: "choice", payload: { selected: "decoded" } }],
      [{ widget: "choice", payload: { cancelled: true } }],
    ]);
  });
});
