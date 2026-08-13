import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { mountWithApp } from "../helpers/test-app-context";

const createViewer = vi.fn(() => ({
  addModel: vi.fn(),
  setStyle: vi.fn(),
  zoomTo: vi.fn(),
  render: vi.fn(),
  animate: vi.fn(),
  stopAnimate: vi.fn(),
  clear: vi.fn(),
}));

vi.mock("@/utils/3dmol", () => ({
  load3DMol: vi.fn(async () => ({ createViewer })),
}));

import ScientificMarkdown from "@/components/ScientificMarkdown.vue";

const resources = [
  {
    id: "figure-1",
    name: "Figure 1",
    kind: "image" as const,
    markdownHref: "figures/one.png",
    displayUrl: "/authorized/one.png",
  },
  {
    id: "structure-1",
    name: "Structure 1",
    kind: "cif" as const,
    markdownHref: "structures/one.cif",
    displayUrl: "/authorized/one.cif",
  },
  {
    id: "attachment-1",
    name: "Attachment 1",
    kind: "attachment" as const,
    markdownHref: "attachments/one.pdf",
  },
  {
    id: "markdown-1",
    name: "Methods notes",
    kind: "markdown" as const,
    markdownHref: "notes/methods.md",
  },
];

const resizeObservers: TestResizeObserver[] = [];

class TestResizeObserver {
  observe = vi.fn();
  disconnect = vi.fn();

  constructor() {
    resizeObservers.push(this);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  createViewer.mockClear();
  resizeObservers.length = 0;
});

describe("ScientificMarkdown resources", () => {
  it("emits parsed heading metadata once for stable rerenders", async () => {
    const wrapper = mountWithApp(ScientificMarkdown, {
      props: { source: "## Gene *network*\n\n## Gene network" },
    });

    await vi.dynamicImportSettled();
    await Promise.resolve();
    expect(wrapper.emitted("headings")).toEqual([
      [
        [
          { id: "gene-network", level: 2, text: "Gene network" },
          { id: "gene-network-2", level: 2, text: "Gene network" },
        ],
      ],
    ]);
    await wrapper.setProps({ streaming: false });
    await Promise.resolve();
    expect(wrapper.emitted("headings")).toHaveLength(1);
  });

  it("renders an exact authorized image and opens the bounded image dialog", async () => {
    const wrapper = mountWithApp(ScientificMarkdown, {
      attachTo: document.body,
      props: { source: "![leaf](figures/one.png)", resources },
    });

    await vi.dynamicImportSettled();
    const image = wrapper.get(".scientific-image__thumbnail");
    expect(image.attributes("src")).toBe("/authorized/one.png");
    await image.trigger("click");
    await nextTick();
    expect(
      document.body
        .querySelector(".scientific-image__dialog-image")
        ?.getAttribute("src")
    ).toBe("/authorized/one.png");
    wrapper.unmount();
  });

  it("loads an exact authorized CIF and releases its runtime resources", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => "data_cif",
    }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    const wrapper = mountWithApp(ScientificMarkdown, {
      props: { source: "![structure](structures/one.cif)", resources },
    });

    await vi.dynamicImportSettled();
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledWith(
      "/authorized/one.cif",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(createViewer).toHaveBeenCalled();
    const viewer = createViewer.mock.results[0]?.value;
    wrapper.unmount();
    expect(viewer.stopAnimate).toHaveBeenCalled();
    expect(viewer.clear).toHaveBeenCalled();
  });

  it("aborts an authorized CIF request when the renderer unmounts", async () => {
    let resolveFetch:
      | ((value: { ok: boolean; text: () => Promise<string> }) => void)
      | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<{ ok: boolean; text: () => Promise<string> }>((resolve) => {
          resolveFetch = resolve;
        })
    );
    vi.stubGlobal("fetch", fetchMock);
    const wrapper = mountWithApp(ScientificMarkdown, {
      props: { source: "![structure](structures/one.cif)", resources },
    });

    await vi.dynamicImportSettled();
    await Promise.resolve();
    const signal = (fetchMock.mock.calls[0]?.[1] as RequestInit).signal;
    wrapper.unmount();
    expect(signal?.aborted).toBe(true);
    resolveFetch?.({ ok: true, text: async () => "data_cif" });
  });

  it("releases CIF resources before rendering a failed request fallback", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      text: async () => "",
    }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    const wrapper = mountWithApp(ScientificMarkdown, {
      props: { source: "![structure](structures/one.cif)", resources },
    });

    await vi.dynamicImportSettled();
    await Promise.resolve();
    await Promise.resolve();
    const viewer = createViewer.mock.results[0]?.value;
    expect(viewer.stopAnimate).toHaveBeenCalled();
    expect(viewer.clear).toHaveBeenCalled();
    expect(resizeObservers[0]?.disconnect).toHaveBeenCalled();
    expect(wrapper.text()).toContain("Structure unavailable");
  });

  it("emits only opaque resource identifiers for authorized actions", async () => {
    const wrapper = mountWithApp(ScientificMarkdown, {
      props: {
        source: "[download](attachments/one.pdf) [notes](notes/methods.md)",
        resources,
      },
    });

    await vi.dynamicImportSettled();
    const links = wrapper.findAll(".scientific-resource-link");
    await links[0].trigger("click");
    await links[1].trigger("click");
    expect(wrapper.emitted("resource-activate")).toEqual([
      [{ id: "attachment-1", kind: "attachment" }],
      [{ id: "markdown-1", kind: "markdown" }],
    ]);
    expect(JSON.stringify(wrapper.emitted("resource-activate"))).not.toContain(
      "attachments/one.pdf"
    );
  });

  it("leaves unapproved, wrong-kind, and report-only resources inert without fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const wrapper = mountWithApp(ScientificMarkdown, {
      props: {
        source:
          "![private](/private/path.png) ![wrong](attachments/one.pdf) [missing](unknown.md)",
        resources,
      },
    });

    await vi.dynamicImportSettled();
    expect(wrapper.findAll(".scientific-resource--unavailable")).toHaveLength(
      2
    );
    expect(wrapper.findAll(".scientific-resource-link")).toHaveLength(0);
    expect(wrapper.get('a[href="unknown.md"]').text()).toBe("missing");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("leaves every duplicate authorization candidate inert", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const duplicateResources = [
      {
        id: "duplicate-cif",
        name: "One",
        kind: "cif" as const,
        markdownHref: "structures/one.cif",
        displayUrl: "/authorized/one.cif",
      },
      {
        id: " duplicate-cif ",
        name: "Two",
        kind: "cif" as const,
        markdownHref: "structures/two.cif",
        displayUrl: "/authorized/two.cif",
      },
      {
        id: "attachment-1",
        name: "One",
        kind: "attachment" as const,
        markdownHref: "attachments/duplicate.pdf",
      },
      {
        id: "attachment-2",
        name: "Two",
        kind: "attachment" as const,
        markdownHref: " attachments/duplicate.pdf ",
      },
    ];
    const wrapper = mountWithApp(ScientificMarkdown, {
      props: {
        source:
          "![one](structures/one.cif) ![two](structures/two.cif) [attachment](attachments/duplicate.pdf)",
        resources: duplicateResources,
      },
    });

    await vi.dynamicImportSettled();
    expect(wrapper.findAll(".scientific-resource--unavailable")).toHaveLength(
      2
    );
    expect(wrapper.findAll(".scientific-resource-link")).toHaveLength(0);
    await wrapper.get('a[href="attachments/duplicate.pdf"]').trigger("click");
    expect(wrapper.emitted("resource-activate")).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
