import { enableAutoUnmount, flushPromises } from "@vue/test-utils";
import { defineComponent, h, reactive } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountWithApp } from "../../helpers/test-app-context";
import DeepGenomeArtifact from "@/components/research/DeepGenomeArtifact.vue";
import DeepGenomeMaterialDetail from "@/components/research/DeepGenomeMaterialDetail.vue";
import { createDeepGenomeMaterialDetailState } from "@/components/research/deep-genome-report";
import { DEEP_GENOME_CASE_REFERENCES } from "@/views/deep-genome-agent/deep-genome-case";
import type { DeepGenomeResourceReader } from "@/components/research/deep-genome-report";

const { saveAs } = vi.hoisted(() => ({ saveAs: vi.fn() }));
vi.mock("file-saver", () => ({ saveAs }));
enableAutoUnmount(afterEach);

const bytes = new TextEncoder().encode(
  "# Experiment protocol\n\nLocal [1] and x<sup>2</sup>.\n"
);
const loaded = { text: new TextDecoder().decode(bytes), bytes };
function mountReport(reader: DeepGenomeResourceReader = async () => loaded) {
  return mountWithApp(DeepGenomeArtifact, {
    attachTo: document.body,
    props: {
      markdown:
        "# Report\n\nEvidence [1]. [Protocol Details](./protocol.md) [Missing](./missing.md) [External](https://example.org/reference.md)",
      references: DEEP_GENOME_CASE_REFERENCES.slice(0, 2),
      referenceMaterials: [
        {
          referenceIndex: 1,
          excerpt: "# Available source fragment\n\nPaper-local [1].",
          resourceIds: [],
        },
      ],
      resources: [
        {
          id: "protocol",
          kind: "markdown",
          name: "protocol.md",
          markdownHref: "./protocol.md",
        },
      ],
      detailState: reactive(createDeepGenomeMaterialDetailState()),
      reportKey: "report:1",
      readResource: reader,
      ns: "detail_report",
      title: "Main report",
      backLabel: "Back",
      closeLabel: "Close",
      actionLabel: "Actions",
      menuItems: [{ id: "copy", label: "Copy report" }],
    },
  });
}

describe("DeepGenome in-panel materials", () => {
  it("keeps heading labels unique when two material panels share an app", () => {
    const wrapper = mountWithApp(
      defineComponent({
        setup: () => () =>
          h("div", [
            h(DeepGenomeMaterialDetail, {
              state: createDeepGenomeMaterialDetailState(),
              title: "First protocol",
              downloadable: false,
            }),
            h(DeepGenomeMaterialDetail, {
              state: createDeepGenomeMaterialDetailState(),
              title: "Second protocol",
              downloadable: false,
            }),
          ]),
      })
    );
    const panels = wrapper.findAll("[data-testid=deep-genome-material-detail]");
    const headingIds = panels.map((panel) => panel.get("h2").attributes("id"));
    expect(new Set(headingIds).size).toBe(2);
    for (const panel of panels) {
      expect(panel.attributes("aria-labelledby")).toBe(
        panel.get("h2").attributes("id")
      );
    }
  });
  it("prints the real canonical evidence DOM with scientific styles and links but no source actions", async () => {
    const wrapper = mountReport();
    await wrapper.setProps({
      references: [
        {
          citation: {
            runs: [
              { text: "FLC", italic: true },
              { text: " 12", bold: true },
              { text: "2", vertical: "superscript" },
            ],
            links: [
              { label: "PubMed", href: "https://pubmed.ncbi.nlm.nih.gov/123/" },
            ],
          },
        },
      ],
    });
    await vi.dynamicImportSettled();
    let printed: Element | null = null;
    let inlinePrintSelectors = "";
    let printStyles = "";
    vi.spyOn(window, "print").mockImplementation(() => {
      printed = document
        .querySelector("#print-container .research-evidence-panel")
        ?.cloneNode(true) as Element | null;
      inlinePrintSelectors =
        Array.from(document.head.querySelectorAll("style"))
          .map(
            (style) =>
              style.textContent?.match(
                /([^{}]+)\{\s*display: inline !important;/
              )?.[1]
          )
          .find((selectors) => selectors?.includes("#print-container")) ?? "";
      printStyles =
        Array.from(document.head.querySelectorAll("style"))
          .map((style) => style.textContent ?? "")
          .find((css) => css.includes("#print-container")) ?? "";
    });
    await (
      wrapper.vm as unknown as { download: (format: "pdf") => Promise<void> }
    ).download("pdf");
    if (!printed) throw new Error("Canonical print reference clone is missing");
    const output = printed as Element;
    expect(output.querySelector("em")?.textContent).toBe("FLC");
    expect(output.querySelector("strong")?.textContent).toBe(" 12");
    expect(output.querySelector("sup")?.textContent).toBe("2");
    expect(inlinePrintSelectors).toContain("#print-container sup");
    expect(inlinePrintSelectors).toContain("#print-container sub");
    expect(printStyles).toMatch(
      /#print-container \.citation-reference-row\s*\{\s*display:\s*grid !important;/
    );
    expect(printStyles).toMatch(
      /#print-container \.citation-reference-row__links\s*\{\s*display:\s*flex !important;/
    );
    expect(output.querySelector("a")?.getAttribute("href")).toBe(
      "https://pubmed.ncbi.nlm.nih.gov/123/"
    );
    expect(output.querySelectorAll(".citation-reference-row")).toHaveLength(1);
    expect(
      output.querySelectorAll("button, [tabindex], [aria-current]")
    ).toHaveLength(0);
    expect(wrapper.find("[data-testid=material-excerpt]").exists()).toBe(true);
  });
  it("opens protocol in the same artifact, keeps parent inert, downloads original bytes and restores focus/scroll", async () => {
    const wrapper = mountReport();
    await vi.dynamicImportSettled();
    const original = wrapper.get("[data-testid=deep-genome-parent]");
    const reportBody = wrapper.get(".research-artifact-shell__body").element;
    reportBody.scrollTop = 321;
    const opener = wrapper.get(".scientific-resource-link");
    (opener.element as HTMLElement).focus();
    await opener.trigger("click");
    await flushPromises();
    const detail = wrapper.get("[data-testid=deep-genome-material-detail]");
    expect(original.attributes("hidden")).toBeDefined();
    expect(original.attributes("inert")).toBeDefined();
    expect(detail.text()).toContain("Experiment protocol");
    expect(detail.findAll(".scientific-citation__link")).toHaveLength(0);
    expect(detail.get(".scientific-inline--superscript").text()).toBe("2");
    expect(detail.find("[data-test=artifact-action]").exists()).toBe(false);
    expect(wrapper.emitted("resource-activate")).toBeUndefined();
    await detail.get("[data-testid=material-download]").trigger("click");
    expect(saveAs).toHaveBeenCalledTimes(1);
    expect(saveAs.mock.calls[0][1]).toBe("protocol.md");
    expect(new Uint8Array(await saveAs.mock.calls[0][0].arrayBuffer())).toEqual(
      bytes
    );
    await detail.get("[data-testid=material-back]").trigger("click");
    await flushPromises();
    expect(
      wrapper.find("[data-testid=deep-genome-material-detail]").exists()
    ).toBe(false);
    expect(original.attributes("hidden")).toBeUndefined();
    expect(original.attributes("inert")).toBeUndefined();
    expect(reportBody.scrollTop).toBe(321);
    expect(document.activeElement).toBe(opener.element);
    expect(wrapper.get(".scientific-citation__link").attributes("href")).toBe(
      "#detail_report-ref-1"
    );
  });

  it("opens source excerpts from their numbered evidence row without parent citation context or invented download", async () => {
    const wrapper = mountReport();
    await vi.dynamicImportSettled();
    await wrapper.get(".scientific-citation__link").trigger("click");
    await wrapper
      .get("#detail_report-ref-1 [data-testid=material-excerpt]")
      .trigger("click");
    await flushPromises();
    const detail = wrapper.get("[data-testid=deep-genome-material-detail]");
    expect(detail.text()).toContain("Paper-local 1.");
    expect(detail.findAll(".scientific-citation__link")).toHaveLength(0);
    expect(detail.find("[data-testid=material-download]").exists()).toBe(false);
    await detail.get("[data-testid=material-back]").trigger("click");
    await flushPromises();
    expect(
      wrapper.get('[data-tab-id="evidence"]').attributes("aria-selected")
    ).toBe("true");
    expect(wrapper.get("#detail_report-ref-1").classes()).toContain(
      "research-evidence-panel__item--active"
    );
  });

  it("presents loading and bounded failure with explicit retry", async () => {
    let reject!: (reason: Error) => void;
    const reader = vi
      .fn<DeepGenomeResourceReader>()
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, fail) => {
            reject = fail;
          })
      )
      .mockResolvedValueOnce(loaded);
    const wrapper = mountReport(reader);
    await vi.dynamicImportSettled();
    await wrapper.get(".scientific-resource-link").trigger("click");
    expect(
      wrapper
        .get("[data-testid=deep-genome-material-detail]")
        .attributes("aria-busy")
    ).toBe("true");
    reject(new Error("private object path"));
    await flushPromises();
    expect(wrapper.text()).not.toContain("private object path");
    await wrapper.get("[data-testid=material-retry]").trigger("click");
    await flushPromises();
    expect(
      wrapper.get("[data-testid=deep-genome-material-detail]").text()
    ).toContain("Experiment protocol");
    expect(reader).toHaveBeenCalledTimes(2);
  });

  it("does not navigate unregistered local documents and preserves external links", async () => {
    const wrapper = mountReport();
    await vi.dynamicImportSettled();
    expect(wrapper.find('a[href="./missing.md"]').exists()).toBe(false);
    expect(wrapper.get(".scientific-resource--unavailable").text()).toContain(
      "Missing"
    );
    expect(
      wrapper
        .get('a[href="https://example.org/reference.md"]')
        .attributes("target")
    ).toBe("_blank");
  });

  it("preserves the registered live-Chat download action when no preview reader exists", async () => {
    const wrapper = mountReport();
    await wrapper.setProps({ readResource: undefined });
    await vi.dynamicImportSettled();
    await wrapper.get(".scientific-resource-link").trigger("click");
    expect(wrapper.emitted("resource-activate")).toEqual([
      [{ id: "protocol", kind: "markdown" }],
    ]);
    expect(
      wrapper.find("[data-testid=deep-genome-material-detail]").exists()
    ).toBe(false);
  });
});
