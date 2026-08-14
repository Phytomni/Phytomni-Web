import { describe, it, expect, vi } from "vitest";
import { defineComponent } from "vue";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mountWithApp } from "../helpers/test-app-context";

import CitedAnswer from "@/components/CitedAnswer.vue";

const CITED_ANSWER_SOURCE = readFileSync(
  resolve(__dirname, "../../src/components/CitedAnswer.vue"),
  "utf8"
);

// The scientific renderers are stubbed so these tests isolate CitedAnswer's
// reference-list wiring (their own specs lock the rendering contract).
// CitationReferenceList is real so CitedAnswer→list parity stays locked.
const mountCited = (props: Record<string, unknown>) =>
  mountWithApp(CitedAnswer, {
    props: { ns: "cited-test", ...props },
    global: {
      stubs: {
        ScientificMarkdown: defineComponent({
          props: ["source", "citationNamespace", "referenceCount", "surface"],
          emits: ["citation-activate"],
          template:
            '<button class="sm-stub" @click="$emit(\'citation-activate\', { namespace: citationNamespace, indices: [1, 2] })">{{ source }}|{{ citationNamespace }}|{{ referenceCount }}|{{ surface }}</button>',
        }),
        ScientificMarkdownTypewriter: defineComponent({
          props: ["source", "citationNamespace", "referenceCount", "surface"],
          emits: ["citation-activate"],
          template:
            '<button class="smt-stub" @click="$emit(\'citation-activate\', { namespace: citationNamespace, indices: [1, 2] })">{{ source }}|{{ citationNamespace }}|{{ referenceCount }}|{{ surface }}</button>',
        }),
      },
      mocks: {
        $t: (key: string) => key,
      },
    },
  });

describe("CitedAnswer", () => {
  it("keeps the cited-answer wrapper shrinkable around long cited content", () => {
    expect(CITED_ANSWER_SOURCE).toContain("min-width: 0;");
    expect(CITED_ANSWER_SOURCE).toContain("max-width: 100%;");
    expect(CITED_ANSWER_SOURCE).toContain("overflow-wrap: anywhere;");
  });

  it("renders one reference row per doc with ref-N ids from buildDisplayReferences", () => {
    const wrapper = mountCited({
      content: "body",
      ns: "cited-rows",
      references: [{ title: "Doc A" }, { au: "Smith", ti: "T", so: "Nature" }],
    });
    const rows = wrapper.findAll(".doc-list-item");
    expect(rows).toHaveLength(2);
    expect(rows[0].attributes("id")).toBe("cited-rows-ref-1");
    expect(rows[1].attributes("id")).toBe("cited-rows-ref-2");
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

    expect(wrapper.find(".sm-stub").text()).toContain(
      "Evidence-backed body [1]"
    );
    expect(wrapper.find(".sm-stub").text()).toContain("artifact-a");
    expect(wrapper.find(".sm-stub").text()).toContain("artifact");
    expect(wrapper.find(".doc-list").exists()).toBe(false);
  });

  it("switches to the typewriter with the same citation contract", () => {
    const wrapper = mountCited({
      content: "hello",
      references: [],
      instantMessage: true,
    });
    expect(wrapper.find(".smt-stub").text()).toContain("hello");
    expect(wrapper.find(".smt-stub").text()).toContain("0");
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

  it("passes ns through to ScientificMarkdown", () => {
    const wrapper = mountCited({ content: "hi", references: [], ns: "m3" });
    expect(wrapper.find(".sm-stub").text()).toContain("m3");
  });

  it("forwards each explicit surface to ScientificMarkdown", () => {
    for (const surface of ["chat", "artifact", "document"]) {
      const withSurface = mountCited({
        content: "hi",
        references: [],
        surface,
      });
      expect(withSurface.find(".sm-stub").text()).toContain(surface);
    }

    const readingDefault = mountCited({ content: "hi", references: [] });
    expect(readingDefault.find(".sm-stub").text()).toContain("reading");
  });

  it("focuses its own inline reference list for grouped citations", async () => {
    const wrapper = mountCited({
      content: "Evidence [1-2]",
      references: [{ title: "First source" }, { title: "Second source" }],
      ns: "inline-cited",
    });
    const rows = wrapper.findAll(".doc-list-item");
    const scrollIntoView = vi.fn();
    Object.defineProperty(rows[0].element, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    const focus = vi.spyOn(rows[0].element as HTMLElement, "focus");

    await wrapper.get(".sm-stub").trigger("click");

    expect(
      rows.map((row) => row.classes().includes("is-citation-target"))
    ).toEqual([true, true]);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    expect(focus).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted("citation-activate")).toBeUndefined();
  });

  it("re-emits citation activation when references are presented externally", async () => {
    const wrapper = mountCited({
      content: "Evidence [1-2]",
      references: [{ title: "First source" }, { title: "Second source" }],
      ns: "external-cited",
      referencePresentation: "external",
    });

    await wrapper.get(".sm-stub").trigger("click");

    expect(wrapper.emitted("citation-activate")).toEqual([
      [{ namespace: "external-cited", indices: [1, 2] }],
    ]);
  });
});
