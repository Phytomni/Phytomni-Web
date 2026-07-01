import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";

// The real vue-element-plus-x barrel eagerly imports aggregated CSS that the test
// transform can't load. CitedAnswer imports the real MarkdownViewer module (even
// though it's stubbed below via global.stubs, Vue still resolves and evaluates the
// component's <script setup> import graph), so neutralize the module here too —
// mirrors tests/component/MarkdownViewer.spec.ts.
vi.mock("vue-element-plus-x", () => ({
  Typewriter: { name: "Typewriter", template: "<div></div>" },
}));

import CitedAnswer from "@/components/CitedAnswer.vue";

// MarkdownViewer is stubbed so these tests isolate CitedAnswer's reference-list wiring
// (the body renderer and its XSS rules are locked in MarkdownViewer's own specs).
const mountCited = (props: Record<string, unknown>) =>
  mount(CitedAnswer, {
    props,
    global: {
      stubs: {
        MarkdownViewer: {
          template: '<div class="mv-stub">{{ content }}|{{ instantMessage }}</div>',
          props: ["content", "instantMessage"],
        },
      },
    },
  });

describe("CitedAnswer", () => {
  it("renders one reference row per doc with ref-N ids from buildDisplayReferences", () => {
    const wrapper = mountCited({
      content: "body",
      references: [{ title: "Doc A" }, { au: "Smith", ti: "T", so: "Nature" }],
    });
    const rows = wrapper.findAll(".doc-list-item");
    expect(rows).toHaveLength(2);
    expect(rows[0].attributes("id")).toBe("ref-1");
    expect(rows[1].attributes("id")).toBe("ref-2");
    expect(wrapper.html()).toContain("Doc A");
    expect(wrapper.html()).toContain("Smith");
  });

  it("renders no reference list when references is empty or absent", () => {
    expect(mountCited({ content: "body", references: [] }).find(".doc-list").exists()).toBe(false);
    expect(mountCited({ content: "body" }).find(".doc-list").exists()).toBe(false);
  });

  it("passes content and instantMessage through to MarkdownViewer", () => {
    const wrapper = mountCited({ content: "hello", references: [], instantMessage: true });
    expect(wrapper.find(".mv-stub").text()).toContain("hello");
    expect(wrapper.find(".mv-stub").text()).toContain("true");
  });
});
