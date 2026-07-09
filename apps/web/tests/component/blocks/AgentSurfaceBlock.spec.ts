import { describe, it, expect, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import AgentSurfaceBlock from "@/views/chat/components/blocks/AgentSurfaceBlock.vue";
import {
  createMemoryA2uiTransport,
  _resetA2uiActionIdempotencyForTests,
  type A2uiActionEnvelope,
} from "@/views/chat/streaming/a2uiAction";
import type { ContentBlock } from "@/views/chat/types";

beforeEach(() => _resetA2uiActionIdempotencyForTests());

describe("AgentSurfaceBlock", () => {
  it("sends confirm action and shows locked status", async () => {
    const sink: A2uiActionEnvelope[] = [];
    const transport = createMemoryA2uiTransport(sink);
    const block: ContentBlock = {
      type: "agent-surface",
      authority: "agent",
      interactive: true,
      surfaceId: "s1",
      widget: "confirm",
      props: { title: "Go?", confirm_label: "Yes", cancel_label: "No" },
    };
    const w = mount(AgentSurfaceBlock, {
      props: { block, runId: "r1", transport },
    });
    const buttons = w.findAll("button");
    await buttons[buttons.length - 1].trigger("click");
    await nextTick();
    expect(sink).toHaveLength(1);
    expect(sink[0].surface_id).toBe("s1");
    expect(sink[0].run_id).toBe("r1");
    expect(sink[0].widget).toBe("confirm");
    expect(sink[0].payload).toEqual({ accepted: true });
    expect(w.text()).toContain("chat.a2ui.locked");
  });
});
