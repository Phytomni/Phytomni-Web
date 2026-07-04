import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import StreamMessage from "@/views/chat/components/StreamMessage.vue";
import type { ContentBlock } from "@/views/chat/types";

describe("StreamMessage", () => {
  it("renders a markdown block's text through v-html", () => {
    const blocks: ContentBlock[] = [{ type: "markdown", authority: "web", text: "**hi**" }];
    const w = mount(StreamMessage, { props: { blocks } });
    expect(w.html()).toContain("<strong>hi</strong>");
  });

  it("skips an unregistered block type without throwing", () => {
    const blocks: ContentBlock[] = [{ type: "mol3d", authority: "web" }];
    const w = mount(StreamMessage, { props: { blocks } });
    expect(w.html()).not.toContain("mol3d");
  });
});
