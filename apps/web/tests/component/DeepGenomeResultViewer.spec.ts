import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mountWithApp } from "../helpers/test-app-context";
import DeepGenomeResultViewer from "@/components/DeepGenomeResultViewer.vue";
import ScientificMarkdown from "@/components/ScientificMarkdown.vue";
import DeepGenomeToc from "@/components/research/DeepGenomeToc.vue";

const threeDMolMock = vi.hoisted(() => {
  const viewer = {
    addModel: vi.fn(),
    setStyle: vi.fn(),
    zoomTo: vi.fn(),
    render: vi.fn(),
    animate: vi.fn(),
    stopAnimate: vi.fn(),
    clear: vi.fn(),
  };
  const createViewer = vi.fn(() => viewer);
  return {
    viewer,
    createViewer,
    load3DMol: vi.fn(async () => ({ createViewer })),
  };
});

vi.mock("@/utils/3dmol", () => ({
  load3DMol: threeDMolMock.load3DMol,
}));

const VIEWER_SOURCE = readFileSync(
  resolve(__dirname, "../../src/components/DeepGenomeResultViewer.vue"),
  "utf8"
);
const VIEWER_TEMPLATE = VIEWER_SOURCE.slice(
  0,
  VIEWER_SOURCE.indexOf("<script setup")
);

const passthrough = { template: "<div><slot /></div>" };
const stubs = {
  ElContainer: passthrough,
  ElAside: passthrough,
  ElMain: passthrough,
  ElCard: passthrough,
  ElMenu: passthrough,
  ElMenuItem: passthrough,
  ElSubMenu: passthrough,
  ElDialog: passthrough,
  ElButton: passthrough,
  ElDropdown: passthrough,
  ElDropdownMenu: passthrough,
  ElDropdownItem: passthrough,
};

const mountedViewers: Array<{ unmount: () => void }> = [];

afterEach(() => {
  mountedViewers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.unstubAllGlobals();
  threeDMolMock.createViewer.mockClear();
  threeDMolMock.viewer.addModel.mockClear();
});

function render(
  markdown: string,
  extraProps: Record<string, unknown> = {}
): ReturnType<typeof mountWithApp> {
  const wrapper = mountWithApp(DeepGenomeResultViewer, {
    props: {
      markdown,
      references: [],
      ns: "deep-test",
      ...extraProps,
    },
    global: { stubs, mocks: { $t: (key: string) => key } },
  });
  mountedViewers.push(wrapper);
  return wrapper;
}

async function settleMarkdown(): Promise<void> {
  await vi.dynamicImportSettled();
  await nextTick();
  await Promise.resolve();
  await nextTick();
}

describe("DeepGenomeResultViewer — shared document boundary", () => {
  it("renders one ScientificMarkdown body and keeps references outside the report body sink", async () => {
    const wrapper = render("# Report\n\n## Evidence\n\nBody");
    await settleMarkdown();

    expect(wrapper.findAllComponents(ScientificMarkdown)).toHaveLength(1);
    expect(wrapper.find("article.deep-genome-document").exists()).toBe(true);
    expect(VIEWER_TEMPLATE).not.toContain("contentBlocks");
    expect(VIEWER_TEMPLATE).not.toContain('v-html="block');
    expect(VIEWER_TEMPLATE.match(/\bv-html\s*=/g)).toHaveLength(1);
  });

  it("feeds shared heading metadata into the responsive TOC and keeps heading scroll ownership", async () => {
    const wrapper = render(
      "# Report\n\n## Evidence\n\n### Expression\n\nFindings"
    );
    await settleMarkdown();

    expect(wrapper.find("h2#user-content-evidence").exists()).toBe(true);
    expect(wrapper.find("h3#user-content-expression").exists()).toBe(true);
    expect(
      wrapper.findComponent(DeepGenomeToc).props("nestedHeadings")
    ).toEqual([
      {
        id: "evidence",
        level: 2,
        text: "Evidence",
        children: [
          { id: "expression", level: 3, text: "Expression", children: [] },
        ],
      },
    ]);
    expect(VIEWER_SOURCE).toContain('@headings="handleHeadings"');
    expect(VIEWER_SOURCE).not.toContain("parseDeepGenomeMarkdown");
  });

  it("uses the shared GFM, math, citation, and superscript DOM contract", async () => {
    const wrapper = render(
      [
        "# Report",
        "",
        "| Gene | Score | Note |",
        "| :--- | ---: | :---: |",
        String.raw`| Os01g | 9.5 | escaped \| pipe |`,
        "",
        "Inline $x^2$ and [1-3].",
        "",
        "$$E = mc^2$$",
        "",
        "<sup>1</sup> <sup>[1-3]</sup>",
      ].join("\n"),
      { references: [{ title: "One" }, { title: "Two" }, { title: "Three" }] }
    );
    await settleMarkdown();

    expect(wrapper.find("table").exists()).toBe(true);
    expect(wrapper.text()).toContain("escaped | pipe");
    expect(wrapper.find(".katex").exists()).toBe(true);
    expect(
      wrapper.findAll(".scientific-citation").map((node) => node.text())
    ).toEqual(["[1-3]", "1", "[1-3]"]);
  });

  it("keeps hostile raw HTML inert while leaving only controlled resource nodes active", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const wrapper = render(
      [
        "# Report",
        "",
        '<script>alert(1)</script><img src=x onerror="alert(2)">',
        "",
        "![Missing](.out/missing.png)",
      ].join("\n")
    );
    await settleMarkdown();

    expect(wrapper.find("script").exists()).toBe(false);
    expect(wrapper.findAll("[onerror], [onclick]")).toHaveLength(0);
    expect(wrapper.findAll(".scientific-resource--unavailable")).toHaveLength(
      1
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders authorized image and CIF metadata while leaving checked-in .out paths inert", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => "data_cif",
    }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe = vi.fn();
        disconnect = vi.fn();
      }
    );
    const wrapper = render(
      [
        "# Report",
        "",
        "![Figure](figures/figure.svg)",
        "",
        "![Structure](structures/structure.cif)",
        "",
        "![Missing](.out/missing.cif)",
      ].join("\n"),
      {
        resources: [
          {
            id: "figure",
            name: "Figure",
            kind: "image",
            markdownHref: "figures/figure.svg",
            displayUrl: "/authorized/figure.svg",
          },
          {
            id: "structure",
            name: "Structure",
            kind: "cif",
            markdownHref: "structures/structure.cif",
            displayUrl: "/authorized/structure.cif",
          },
        ],
      }
    );
    await settleMarkdown();
    await Promise.resolve();
    await Promise.resolve();

    expect(wrapper.get(".scientific-image__thumbnail").attributes("src")).toBe(
      "/authorized/figure.svg"
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/authorized/structure.cif",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(wrapper.findAll(".scientific-resource--unavailable")).toHaveLength(
      1
    );
    expect(wrapper.find(".scientific-cif-viewer").exists()).toBe(true);
  });

  it("relays the shared citation activation without root anchor delegation", async () => {
    const wrapper = render("# Report\n\nEvidence [1-2].", {
      references: [{ title: "One" }, { title: "Two" }],
    });
    await settleMarkdown();
    const citation = wrapper.get(".scientific-citation__link");
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    citation.element.dispatchEvent(event);

    expect(wrapper.emitted("citation-activate")).toEqual([
      [{ namespace: "deep-test", indices: [1, 2] }],
    ]);
    expect(VIEWER_SOURCE).not.toContain("handleCitationNavigation");
    expect(VIEWER_TEMPLATE).not.toContain('@click="handleCitation');
  });

  it("relays opaque resource activation from the shared body", async () => {
    const wrapper = render("# Report\n\n[Download](report.pdf)", {
      resources: [
        {
          id: "report-1",
          name: "Report",
          kind: "attachment",
          markdownHref: "report.pdf",
        },
      ],
    });
    await settleMarkdown();
    await wrapper.get(".scientific-resource-link").trigger("click");

    expect(wrapper.emitted("resource-activate")).toEqual([
      [{ id: "report-1", kind: "attachment" }],
    ]);
  });

  it("exposes typed PDF and Markdown download methods", () => {
    const wrapper = render("# Report");
    expect(wrapper.vm).toHaveProperty("download");
    expect(VIEWER_SOURCE).toMatch(
      /defineExpose(?:<DeepGenomeViewerHandle>)?\(\{\s*download\s*\}\)/
    );
  });
});
