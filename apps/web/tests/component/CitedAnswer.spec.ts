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
// CitationReferenceList is real so CitedAnswer→list parity stays locked.
const mountCited = (props: Record<string, unknown>) =>
  mount(CitedAnswer, {
    props,
    global: {
      stubs: {
        MarkdownViewer: {
          template:
            '<div class="mv-stub">{{ content }}|{{ instantMessage }}|{{ ns }}|{{ surface }}</div>',
          props: ["content", "instantMessage", "ns", "surface"],
        },
      },
      mocks: {
        $t: (key: string) => key,
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
    expect(
      mountCited({ content: "body", references: [] }).find(".doc-list").exists()
    ).toBe(false);
    expect(mountCited({ content: "body" }).find(".doc-list").exists()).toBe(
      false
    );
  });

  it("keeps the cited body and namespace while references are presented externally", () => {
    const wrapper = mountCited({
      content: "Evidence-backed body [1]",
      references: [{ title: "External source" }],
      ns: "artifact-a",
      surface: "artifact",
      referencePresentation: "external",
    });

    expect(wrapper.find(".mv-stub").text()).toContain(
      "Evidence-backed body [1]"
    );
    expect(wrapper.find(".mv-stub").text()).toContain("artifact-a");
    expect(wrapper.find(".mv-stub").text()).toContain("artifact");
    expect(wrapper.find(".doc-list").exists()).toBe(false);
  });

  it("passes content and instantMessage through to MarkdownViewer", () => {
    const wrapper = mountCited({
      content: "hello",
      references: [],
      instantMessage: true,
    });
    expect(wrapper.find(".mv-stub").text()).toContain("hello");
    expect(wrapper.find(".mv-stub").text()).toContain("true");
  });

  it("namespaces reference-row ids with the ns prop", () => {
    const wrapper = mountCited({
      content: "body",
      references: [{ title: "Doc A" }, { au: "Smith", ti: "T", so: "Nature" }],
      ns: "m3",
    });
    const rows = wrapper.findAll(".doc-list-item");
    expect(rows[0].attributes("id")).toBe("m3-ref-1");
    expect(rows[1].attributes("id")).toBe("m3-ref-2");
  });

  it("gives two CitedAnswers with different ns disjoint ids (multi-message regression lock)", () => {
    const a = mountCited({
      content: "a",
      references: [{ title: "A" }],
      ns: "m0",
    });
    const b = mountCited({
      content: "b",
      references: [{ title: "B" }],
      ns: "m1",
    });
    expect(a.find(".doc-list-item").attributes("id")).toBe("m0-ref-1");
    expect(b.find(".doc-list-item").attributes("id")).toBe("m1-ref-1");
  });

  it("passes ns through to MarkdownViewer", () => {
    const wrapper = mountCited({ content: "hi", references: [], ns: "m3" });
    expect(wrapper.find(".mv-stub").text()).toContain("m3");
  });

  it("forwards each explicit surface to MarkdownViewer", () => {
    for (const surface of ["chat", "artifact", "document"]) {
      const withSurface = mountCited({
        content: "hi",
        references: [],
        surface,
      });
      expect(withSurface.find(".mv-stub").text()).toContain(surface);
    }

    const legacyDefault = mountCited({ content: "hi", references: [] });
    // Absent surface is not forwarded as chat — stub interpolates empty/undefined.
    expect(legacyDefault.find(".mv-stub").text()).not.toContain("chat");
  });
});
