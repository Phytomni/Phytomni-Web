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
      surfaceId: "s1",
      widget: "confirm",
      props: { title: "stale legacy props" },
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
  });
});
