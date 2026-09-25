import { enableAutoUnmount } from "@vue/test-utils";
import { nextTick } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountWithApp } from "../../helpers/test-app-context";
import DeepGenomeArtifact from "@/components/research/DeepGenomeArtifact.vue";
import ScientificMarkdown from "@/components/ScientificMarkdown.vue";
import {
  DEEP_GENOME_CASE_MARKDOWN,
  DEEP_GENOME_CASE_REFERENCES,
  DEEP_GENOME_CASE_RESOURCES,
} from "@/views/deep-genome-agent/deep-genome-case";

enableAutoUnmount(afterEach);

function mountCase(markdown = DEEP_GENOME_CASE_MARKDOWN) {
  return mountWithApp(DeepGenomeArtifact, {
    attachTo: document.body,
    props: {
      markdown,
      references: DEEP_GENOME_CASE_REFERENCES,
      resources: DEEP_GENOME_CASE_RESOURCES,
      ns: "case_citations",
      title: "Deep genome report",
      backLabel: "Back",
      closeLabel: "Close",
      actionLabel: "Actions",
    },
    // WebGL is unrelated to citation parsing and unavailable in this DOM runner.
    global: { stubs: { ScientificCifViewer: true } },
  });
}

async function activateCitation(
  wrapper: ReturnType<typeof mountCase>,
  label: string,
  indices: number[]
) {
  await wrapper.get('[data-tab-id="content"]').trigger("click");
  const firstRow = wrapper.get(`#case_citations-ref-${indices[0]}`);
  const scrollIntoView = vi.fn();
  Object.defineProperty(firstRow.element, "scrollIntoView", {
    configurable: true,
    value: scrollIntoView,
  });

  await wrapper
    .get(`.scientific-citation__link[aria-label="Citation ${label}"]`)
    .trigger("click");
  await nextTick();

  expect(
    wrapper.get('[data-tab-id="evidence"]').attributes("aria-selected")
  ).toBe("true");
  expect(
    wrapper
      .findAll(".research-evidence-panel__item--active")
      .map((row) => row.attributes("id"))
  ).toEqual(indices.map((index) => `case_citations-ref-${index}`));
  expect(firstRow.attributes("aria-current")).toBe("true");
  expect(document.activeElement).toBe(firstRow.element);
  expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: "nearest" });
}

describe("DeepGenome Case citation integration", () => {
  it("renders all 94 real Case citation groups and preserves 256 evidence slots", async () => {
    const wrapper = mountCase();
    await vi.dynamicImportSettled();

    expect(wrapper.findComponent(ScientificMarkdown).exists()).toBe(true);
    expect(wrapper.findAll(".scientific-citation__link")).toHaveLength(94);
    const rows = wrapper.findAll(".research-evidence-panel__item");
    expect(rows).toHaveLength(256);
    expect(rows.map((row) => row.attributes("id"))).toEqual(
      Array.from(
        { length: 256 },
        (_, index) => `case_citations-ref-${index + 1}`
      )
    );
    expect(rows[255].text()).toContain(
      "Physiological and Transcriptome Analyses"
    );

    for (const index of [5, 14, 18]) {
      await activateCitation(wrapper, String(index), [index]);
    }
  });

  it("navigates range and grouped references without treating scientific scripts, code, links or math as citations", async () => {
    // The frozen Case uses only single references; this probe covers other
    // accepted citation forms against the same real ordered evidence data.
    const wrapper = mountCase(
      [
        "Ranges [document:1-3] and groups [document:5,14,18].",
        "x<sup>2</sup> H<sub>2</sub>O <sup>[2]</sup> <i>FLC</i>.",
        "Code `[document:2]` and [source [document:3]](https://example.org).",
        "Inline math $x^{2} + [4]$.",
      ].join("\n\n")
    );
    await vi.dynamicImportSettled();

    expect(wrapper.findAll(".scientific-citation__link")).toHaveLength(2);
    expect(
      wrapper
        .findAll(".scientific-inline--superscript")
        .map((script) => script.text())
    ).toEqual(["2", "[2]"]);
    expect(wrapper.get(".scientific-inline--subscript").text()).toBe("2");
    expect(wrapper.get("em").text()).toBe("FLC");
    expect(wrapper.get(".inline-code-tag").text()).toBe("[document:2]");
    expect(wrapper.get('a[href="https://example.org"]').text()).toBe(
      "source [document:3]"
    );
    expect(wrapper.find(".katex").exists()).toBe(true);
    expect(
      wrapper.findAll(
        ".scientific-inline--superscript a, .scientific-inline--subscript a, .inline-code-tag a, .katex .scientific-citation__link, a a"
      )
    ).toHaveLength(0);

    await activateCitation(wrapper, "1-3", [1, 2, 3]);
    await activateCitation(wrapper, "5,14,18", [5, 14, 18]);
  });
});
