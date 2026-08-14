import { describe, expect, it, vi } from "vitest";
import { mountWithApp } from "../../helpers/test-app-context";
import { defineComponent, nextTick, ref } from "vue";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ResearchEvidencePanel from "@/components/research/ResearchEvidencePanel.vue";
import ResearchArtifactShell from "@/components/research/ResearchArtifactShell.vue";
import CitedAnswer from "@/components/CitedAnswer.vue";

vi.mock("vue-element-plus-x", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue-element-plus-x")>()),
  Typewriter: { name: "Typewriter", template: "<div></div>" },
}));

const SOURCE = readFileSync(
  resolve(
    __dirname,
    "../../../src/components/research/ResearchEvidencePanel.vue"
  ),
  "utf8"
);

const global = {
  mocks: {
    $t: (key: string) => key,
  },
};

function mountPanel(references: unknown[] = [], ns = "artifact-a") {
  return mountWithApp(ResearchEvidencePanel, {
    props: { references, ns },
    global,
  });
}

function mountArtifactHarness(content = "Namespaced finding [2].") {
  const tab = ref<"content" | "evidence">("content");
  const order: string[] = [];
  const panelRef = ref<{
    focusReferences(indices: readonly number[]): boolean;
  } | null>(null);
  const references = [
    {
      au: "A. Author",
      ti: "Namespaced evidence",
      so: "Plant Journal",
      dl: "https://doi.org/10.1000/evidence",
      pm: "123456",
    },
    { title: "Exact target reference" },
  ];
  const handleActivate = async (activation: { indices: readonly number[] }) => {
    order.push("activate");
    tab.value = "evidence";
    await nextTick();
    panelRef.value?.focusReferences(activation.indices);
  };
  const Harness = defineComponent({
    components: {
      CitedAnswer,
      ResearchArtifactShell,
      ResearchEvidencePanel,
    },
    setup: () => ({ content, handleActivate, panelRef, references, tab }),
    template: `
      <ResearchArtifactShell
        title="Evidence harness"
        :tab="tab"
        artifact-id="artifact-shell"
        back-label="Back"
        close-label="Close"
        action-label="Actions"
      >
        <template #content>
          <CitedAnswer
            :content="content"
            :references="references"
            ns="artifact_under"
            surface="artifact"
            reference-presentation="external"
            @citation-activate="handleActivate"
          />
          <a
            data-test="modified-citation"
            class="scientific-citation__link"
            href="#artifact_under-ref-1"
          >modified</a>
          <a data-test="foreign-citation" class="citation-ref" href="#foreign-ref-1">foreign</a>
          <a data-test="external-link">external</a>
        </template>
        <template #evidence>
          <ResearchEvidencePanel
            ref="panelRef"
            :references="references"
            ns="artifact_under"
          />
        </template>
      </ResearchArtifactShell>
    `,
  });

  return { wrapper: mountWithApp(Harness, { global }), tab, order };
}

describe("ResearchEvidencePanel", () => {
  it("renders namespaced helper output as programmatically focusable rows", () => {
    const references = Array.from({ length: 10 }, (_, index) => ({
      title:
        index === 9
          ? "A deliberately long reference title that must remain readable in a narrow artifact"
          : `Reference ${index + 1}`,
    }));
    const wrapper = mountPanel(references, "artifact-a");
    const rows = wrapper.findAll(".research-evidence-panel__item");

    expect(wrapper.text()).toContain("chat.relatedDocuments");
    expect(rows).toHaveLength(10);
    expect(rows[0].attributes("id")).toBe("artifact-a-ref-1");
    expect(rows[9].attributes("id")).toBe("artifact-a-ref-10");
    expect(rows.every((row) => row.attributes("tabindex") === "-1")).toBe(true);
    expect(rows[9].text()).toContain("deliberately long reference title");
  });

  it("keeps equal reference numbers disjoint across two mounted artifacts", () => {
    const wrapper = mountWithApp(
      {
        components: { ResearchEvidencePanel },
        data: () => ({ references: [{ title: "Shared numeric reference" }] }),
        template: `
          <div>
            <ResearchEvidencePanel :references="references" ns="artifact-a" />
            <ResearchEvidencePanel :references="references" ns="artifact-b" />
          </div>
        `,
      },
      { global }
    );
    const rows = wrapper.findAll(".research-evidence-panel__item");

    expect(rows.map((row) => row.attributes("id"))).toEqual([
      "artifact-a-ref-1",
      "artifact-b-ref-1",
    ]);
    expect(new Set(rows.map((row) => row.attributes("id"))).size).toBe(2);
  });

  it("preserves safe DOI and PMID links without exposing hostile markup", () => {
    const wrapper = mountPanel([
      {
        au: "A. Author",
        ti: "Safe source",
        so: "Plant Journal",
        dl: "https://doi.org/10.1000/safe",
        pm: "123456",
      },
      {
        au: '<img src=x onerror="alert(1)">',
        ti: "Hostile source",
        dl: 'javascript:alert(1)" onmouseover="alert(2)',
      },
    ]);
    const doiLinks = wrapper.findAll("a.doi-link");
    const pmidLink = wrapper.get("a.pmid-link");

    expect(doiLinks[0].attributes("href")).toBe("https://doi.org/10.1000/safe");
    expect(doiLinks[0].attributes("target")).toBe("_blank");
    expect(pmidLink.attributes("href")).toBe(
      "https://pubmed.ncbi.nlm.nih.gov/123456"
    );
    expect(pmidLink.attributes("target")).toBe("_blank");
    expect(doiLinks[1].attributes("href")).toBe("#");
    expect(wrapper.find("img").exists()).toBe(false);
    expect(wrapper.html()).not.toMatch(/<a[^>]+\son\w+=/i);
  });

  it("uses the existing empty-state copy when no references are available", () => {
    const wrapper = mountPanel([], "artifact-empty");

    expect(wrapper.text()).toContain("chat.relatedDocuments");
    expect(wrapper.text()).toContain("common.noData");
    expect(wrapper.find(".research-evidence-panel__item").exists()).toBe(false);
  });

  it("exposes grouped namespace-safe focus and clears prior highlights", async () => {
    const wrapper = mountPanel(
      [
        { title: "First source" },
        { title: "Second source" },
        { title: "Third source" },
        { title: "Fourth source" },
        { title: "Fifth source" },
      ],
      "artifact_under"
    );
    const rows = wrapper.findAll(".research-evidence-panel__item");
    const scrollIntoView = vi.fn();
    Object.defineProperty(rows[0].element, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    const focus = vi.spyOn(rows[0].element as HTMLElement, "focus");
    const focusReferences = (
      wrapper.vm as unknown as {
        focusReferences(indices: readonly number[]): boolean;
      }
    ).focusReferences;

    expect(focusReferences([1, 2, 3, 5])).toBe(true);
    await nextTick();
    expect(
      rows.map((row) => row.classes().includes("is-citation-target"))
    ).toEqual([true, true, true, false, true]);
    expect(rows.map((row) => row.attributes("aria-current"))).toEqual([
      "true",
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    expect(focus).toHaveBeenCalledTimes(1);

    expect(focusReferences([4])).toBe(true);
    expect(
      rows.map((row) => row.classes().includes("is-citation-target"))
    ).toEqual([false, false, false, true, false]);
    expect(focusReferences([100])).toBe(false);
    expect(
      rows.map((row) => row.classes().includes("is-citation-target"))
    ).toEqual([false, false, false, true, false]);
  });

  it("activates Evidence before scrolling and focusing the exact namespaced row", async () => {
    const { wrapper, tab, order } = mountArtifactHarness();
    const citation = wrapper.get("a.scientific-citation__link");
    const rows = wrapper.findAll(".research-evidence-panel__item");
    const row = rows[1];
    const evidenceTabPanel = wrapper.get('[data-panel-id="evidence"]');
    const scrollIntoView = vi.fn(() => {
      expect(tab.value).toBe("evidence");
      expect(evidenceTabPanel.attributes("hidden")).toBeUndefined();
      order.push("scroll");
    });
    const focus = vi.spyOn(row.element as HTMLElement, "focus");
    const firstRowFocus = vi.spyOn(rows[0].element as HTMLElement, "focus");
    const firstRowScroll = vi.fn();
    focus.mockImplementation(() => order.push("focus"));
    Object.defineProperty(rows[0].element, "scrollIntoView", {
      configurable: true,
      value: firstRowScroll,
    });
    Object.defineProperty(row.element, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });

    expect(evidenceTabPanel.attributes("hidden")).toBe("");
    expect(citation.attributes("href")).toBe(`#${row.attributes("id")}`);
    expect(citation.attributes("href")).toBe("#artifact_under-ref-2");
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    citation.element.dispatchEvent(event);
    await nextTick();
    await nextTick();

    expect(event.defaultPrevented).toBe(false);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    expect(order).toEqual(["activate", "scroll", "focus"]);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(row.classes()).toContain("research-evidence-panel__item--active");
    expect(row.attributes("aria-current")).toBe("true");
    expect(firstRowScroll).not.toHaveBeenCalled();
    expect(firstRowFocus).not.toHaveBeenCalled();
  });

  it("highlights every row in a grouped citation and focuses the first", async () => {
    const { wrapper, tab } = mountArtifactHarness("Namespaced finding [1-2].");
    const citation = wrapper.get("a.scientific-citation__link");
    const rows = wrapper.findAll(".research-evidence-panel__item");
    const scrollIntoView = vi.fn();
    Object.defineProperty(rows[0].element, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    const firstFocus = vi.spyOn(rows[0].element as HTMLElement, "focus");
    const secondFocus = vi.spyOn(rows[1].element as HTMLElement, "focus");

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    citation.element.dispatchEvent(event);
    await nextTick();
    await nextTick();

    expect(event.defaultPrevented).toBe(false);
    expect(tab.value).toBe("evidence");
    expect(
      rows.every((row) =>
        row.classes().includes("research-evidence-panel__item--active")
      )
    ).toBe(true);
    expect(rows.map((row) => row.attributes("aria-current"))).toEqual([
      "true",
      undefined,
    ]);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    expect(firstFocus).toHaveBeenCalledTimes(1);
    expect(secondFocus).not.toHaveBeenCalled();
    expect(wrapper.get(".research-evidence-panel .sr-only").text()).toContain(
      "1, 2"
    );
  });

  it("leaves modified, foreign, external, DOI, and PMID links untouched", async () => {
    const { wrapper, tab, order } = mountArtifactHarness();
    const cases = [
      [wrapper.get("[data-test=modified-citation]"), { ctrlKey: true }],
      [wrapper.get("[data-test=foreign-citation]"), {}],
      [wrapper.get("[data-test=external-link]"), {}],
      [wrapper.get("a.doi-link"), {}],
      [wrapper.get("a.pmid-link"), {}],
    ] as const;

    for (const [link, init] of cases) {
      if (link.classes().some((name) => name.endsWith("-link"))) {
        link.element.removeAttribute("href");
      }
      const event = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        ...init,
      });
      link.element.dispatchEvent(event);
      await nextTick();

      expect(
        event.defaultPrevented,
        link.attributes("data-test") || link.classes().join(" ")
      ).toBe(false);
      expect(tab.value).toBe("content");
      expect(order).toEqual([]);
    }
  });

  it("locks the helper-only v-html boundary and visible focus treatment", () => {
    expect(SOURCE).toContain("buildDisplayReferences");
    expect(SOURCE.match(/v-html=/g)).toHaveLength(1);
    expect(SOURCE).toContain('v-html="ref.html"');
    expect(SOURCE).toMatch(/\.research-evidence-panel__item:focus-visible/);
    expect(SOURCE).toMatch(/:deep\(a:focus-visible\)/);
    expect(SOURCE).toMatch(/overflow-wrap:\s*anywhere/);
    expect(SOURCE).toMatch(/max-width:\s*100%/);
  });
});
