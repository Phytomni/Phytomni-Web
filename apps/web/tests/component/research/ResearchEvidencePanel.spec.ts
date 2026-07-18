import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, nextTick, ref } from "vue";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ResearchEvidencePanel from "@/components/research/ResearchEvidencePanel.vue";
import ResearchArtifactShell from "@/components/research/ResearchArtifactShell.vue";
import CitedAnswer from "@/components/CitedAnswer.vue";

vi.mock("vue-element-plus-x", () => ({
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
  return mount(ResearchEvidencePanel, {
    props: { references, ns },
    global,
  });
}

function mountArtifactHarness() {
  const tab = ref<"content" | "evidence">("content");
  const order: string[] = [];
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
  const handleActivate = () => {
    order.push("activate");
    tab.value = "evidence";
  };
  const Harness = defineComponent({
    components: {
      CitedAnswer,
      ResearchArtifactShell,
      ResearchEvidencePanel,
    },
    setup: () => ({ handleActivate, references, tab }),
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
            content="Namespaced finding [2]."
            :references="references"
            ns="artifact_under"
            surface="artifact"
            reference-presentation="external"
          />
          <a data-test="foreign-citation" class="citation-ref" href="#foreign-ref-1">foreign</a>
          <a data-test="external-link">external</a>
        </template>
        <template #evidence>
          <ResearchEvidencePanel
            :references="references"
            ns="artifact_under"
            @activate="handleActivate"
          />
        </template>
      </ResearchArtifactShell>
    `,
  });

  return { wrapper: mount(Harness, { global }), tab, order };
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
    const wrapper = mount(
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

  it("activates Evidence before scrolling and focusing the exact namespaced row", async () => {
    const { wrapper, tab, order } = mountArtifactHarness();
    const citation = wrapper.get("a.citation-ref:not([data-test])");
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
    expect(citation.attributes("href")).not.toContain("_");
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    citation.element.dispatchEvent(event);
    await nextTick();
    await nextTick();

    expect(event.defaultPrevented).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    expect(order).toEqual(["activate", "scroll", "focus"]);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(firstRowScroll).not.toHaveBeenCalled();
    expect(firstRowFocus).not.toHaveBeenCalled();
  });

  it("leaves modified, foreign, external, DOI, and PMID links untouched", async () => {
    const { wrapper, tab, order } = mountArtifactHarness();
    const cases = [
      [wrapper.get("a.citation-ref:not([data-test])"), { ctrlKey: true }],
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

      expect(event.defaultPrevented).toBe(false);
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
  });
});
