import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";
import { enableAutoUnmount, flushPromises } from "@vue/test-utils";
import { mountWithApp } from "../../helpers/test-app-context";
import { decodeGeneDetailResponse } from "@/api/types";
import GeneDetailView from "@/views/gene-display/GeneDetailView.vue";

const mocks = vi.hoisted(() => ({
  getGeneDetails: vi.fn(),
  getGeneResourceCif: vi.fn(),
  getGeneResourceMarkdown: vi.fn(),
  addModel: vi.fn(),
  clear: vi.fn(),
}));
const routeQuery = reactive({ file_name: "Os01_result.md" });
vi.mock("@/api/gene-display", () => ({
  getGeneDetails: mocks.getGeneDetails,
  getGeneResourceCif: mocks.getGeneResourceCif,
  getGeneResourceMarkdown: mocks.getGeneResourceMarkdown,
}));
vi.mock("@/utils/3dmol", () => ({
  load3DMol: async () => ({
    createViewer: () => ({
      addModel: mocks.addModel,
      clear: mocks.clear,
      setStyle: vi.fn(),
      zoomTo: vi.fn(),
      zoom: vi.fn(),
      resize: vi.fn(),
      render: vi.fn(),
      animate: vi.fn(),
      stopAnimate: vi.fn(),
    }),
  }),
}));
vi.mock("vue-router", () => ({
  useRoute: () => ({ query: routeQuery }),
  useRouter: () => ({ push: vi.fn() }),
}));
enableAutoUnmount(afterEach);
beforeEach(() => {
  vi.resetAllMocks();
  routeQuery.file_name = "Os01_result.md";
});

const cifId = `gene-${"c".repeat(64)}`;
const markdownId = `gene-${"d".repeat(64)}`;
const resourceReport = () =>
  decodeGeneDetailResponse({
    id: 0,
    species_code: "rice",
    gene_id: "Os01",
    file_name: "Os01_result.md",
    content:
      "# Gene report\n\n## Structure\n\n![Structure](./model.cif)\n\n[Protocol](./protocol.md)",
    report_revision: "a".repeat(64),
    references: [],
    reference_materials: [],
    resources: [
      {
        id: cifId,
        name: "Structure",
        kind: "cif",
        markdownHref: "./model.cif",
      },
      {
        id: markdownId,
        name: "Protocol",
        kind: "markdown",
        markdownHref: "./protocol.md",
      },
    ],
  });

describe("GeneDetail canonical route integration", () => {
  it("adapts only registered CIFs to authenticated text and keeps registered Markdown in the shared panel", async () => {
    mocks.getGeneDetails.mockResolvedValue({
      code: 200,
      data: resourceReport(),
    });
    mocks.getGeneResourceCif.mockResolvedValue("data_protected");
    mocks.getGeneResourceMarkdown.mockResolvedValue({
      text: "# Protocol\n\nExact original [1]",
      bytes: new TextEncoder().encode("# Protocol\n\nExact original [1]"),
    });
    const wrapper = mountWithApp(GeneDetailView, { attachTo: document.body });
    await flushPromises();
    await vi.dynamicImportSettled();
    await flushPromises();
    expect(mocks.getGeneResourceCif).toHaveBeenCalledWith(
      "Os01_result.md",
      cifId,
      expect.any(AbortSignal)
    );
    expect(mocks.addModel).toHaveBeenCalledWith("data_protected", "cif");
    const protocol = wrapper
      .findAll("button")
      .find((button) => button.text() === "Protocol");
    expect(protocol).toBeDefined();
    if (!protocol) throw new Error("Registered Protocol action missing");
    await protocol.trigger("click");
    await flushPromises();
    expect(mocks.getGeneResourceMarkdown).toHaveBeenCalledWith(
      "Os01_result.md",
      markdownId,
      expect.any(AbortSignal)
    );
    expect(
      wrapper.get("[data-testid=deep-genome-material-detail]").text()
    ).toContain("Exact original");
    expect(
      wrapper.get("[data-testid=deep-genome-parent]").attributes("inert")
    ).toBeDefined();
    await wrapper.get('[data-testid="material-back"]').trigger("click");
    await flushPromises();
    expect(
      wrapper.find("[data-testid=deep-genome-material-detail]").exists()
    ).toBe(false);
    expect(mocks.addModel).toHaveBeenCalledTimes(1);
  });
  it("cancels a prior gene resource and ignores its late text after route replacement", async () => {
    let resolveOld!: (text: string) => void;
    let oldSignal!: AbortSignal;
    mocks.getGeneDetails
      .mockResolvedValueOnce({ code: 200, data: resourceReport() })
      .mockResolvedValueOnce({
        code: 200,
        data: {
          ...resourceReport(),
          file_name: "Os02_result.md",
          report_revision: "b".repeat(64),
        },
      });
    mocks.getGeneResourceCif
      .mockImplementationOnce((_file, _id, signal) => {
        oldSignal = signal;
        return new Promise((resolve) => {
          resolveOld = resolve;
        });
      })
      .mockResolvedValueOnce("data_new_gene");
    mountWithApp(GeneDetailView, { attachTo: document.body });
    await flushPromises();
    await vi.dynamicImportSettled();
    await flushPromises();
    expect(mocks.getGeneResourceCif).toHaveBeenCalledOnce();
    routeQuery.file_name = "Os02_result.md";
    await flushPromises();
    expect(oldSignal.aborted).toBe(true);
    resolveOld("data_old_gene");
    await flushPromises();
    expect(mocks.addModel.mock.calls).toEqual([["data_new_gene", "cif"]]);
    expect(mocks.getGeneResourceCif).toHaveBeenLastCalledWith(
      "Os02_result.md",
      cifId,
      expect.any(AbortSignal)
    );
  });
  it("uses decoded canonical rows and preserves a code-fenced trailer literal", async () => {
    const content =
      "# Gene\r\n\r\nEvidence [document:1]\r\n\r\n```text\r\n--- DOC TITLES ---\r\n1. Not a bibliography\r\n```\r\n\r\nAFTER-CODE";
    mocks.getGeneDetails.mockResolvedValue({
      code: 200,
      data: decodeGeneDetailResponse({
        id: 0,
        species_code: "rice",
        gene_id: "Os01",
        file_name: "Os01_result.md",
        content,
        report_revision: "a".repeat(64),
        resources: [],
        reference_materials: [],
        references: [
          {
            title: "Gene mechanism",
            citation: {
              runs: [
                { text: "Gene mechanism", italic: true },
                { text: " 12", bold: true },
              ],
              links: [
                { label: "Article", href: "https://doi.org/10.1000/example" },
              ],
            },
          },
          null,
        ],
      }),
    });
    const wrapper = mountWithApp(GeneDetailView, { attachTo: document.body });
    await flushPromises();
    await vi.dynamicImportSettled();
    expect(wrapper.text()).toContain("AFTER-CODE");
    expect(wrapper.get("pre").text()).toContain("--- DOC TITLES ---");
    await wrapper.get(".scientific-citation__link").trigger("click");
    await flushPromises();
    const row = wrapper.get("#gene-detail-ref-1");
    expect(row.text()).toContain("Gene mechanism");
    expect(row.get("em").text()).toBe("Gene mechanism");
    expect(row.get("strong").text()).toBe("12");
    expect(row.get("a").attributes("href")).toBe(
      "https://doi.org/10.1000/example"
    );
    expect(document.activeElement).toBe(row.element);
    expect(wrapper.findAll(".research-evidence-panel__item")).toHaveLength(2);
  });
});
