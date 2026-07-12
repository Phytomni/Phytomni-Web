import { describe, it, expect, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import StreamMessage from "@/views/chat/components/StreamMessage.vue";
import type { ContentBlock } from "@/views/chat/types";
import {
  createMemoryA2uiTransport,
  _resetA2uiActionIdempotencyForTests,
  type A2uiActionEnvelope,
} from "@/views/chat/streaming/a2uiAction";

beforeEach(() => _resetA2uiActionIdempotencyForTests());

describe("StreamMessage", () => {
  it("renders a markdown block's text through v-html", () => {
    const blocks: ContentBlock[] = [
      { type: "markdown", authority: "web", text: "**hi**" },
    ];
    const w = mount(StreamMessage, { props: { blocks } });
    expect(w.html()).toContain("<strong>hi</strong>");
  });

  it("skips an unregistered block type without throwing", () => {
    const blocks: ContentBlock[] = [{ type: "mol3d", authority: "web" }];
    const w = mount(StreamMessage, { props: { blocks } });
    expect(w.html()).not.toContain("mol3d");
  });

  it("provides runId and transport so agent-surface confirm can send", async () => {
    const sink: A2uiActionEnvelope[] = [];
    const transport = createMemoryA2uiTransport(sink);
    const blocks: ContentBlock[] = [
      {
        type: "agent-surface",
        authority: "agent",
        interactive: true,
        surfaceId: "surf-inject",
        widget: "confirm",
        props: { title: "Go?", confirm_label: "Yes", cancel_label: "No" },
      },
    ];
    const w = mount(StreamMessage, {
      props: { blocks, runId: "run-inject", transport },
    });
    const buttons = w.findAll("button");
    await buttons[buttons.length - 1].trigger("click");
    await nextTick();
    expect(sink).toHaveLength(1);
    expect(sink[0].surface_id).toBe("surf-inject");
    expect(sink[0].run_id).toBe("run-inject");
    expect(sink[0].widget).toBe("confirm");
    expect(sink[0].payload).toEqual({ accepted: true });
    expect(w.text()).toContain("chat.a2ui.locked");
  });

  it("leaves [N] literal when ns is absent (reference-free streaming)", () => {
    const blocks: ContentBlock[] = [
      {
        type: "markdown",
        authority: "web",
        text: "See [1] for the claim.",
      },
    ];
    const w = mount(StreamMessage, { props: { blocks } });
    // Scope gate: without ns, linkifyCitations is a no-op — markers stay literal.
    expect(w.html()).toContain("[1]");
    expect(w.html()).not.toContain('class="citation-ref"');
    expect(w.html()).not.toContain("#ref-1");
  });
});
