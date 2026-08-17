import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineComponent, nextTick } from "vue";
import { mountWithApp } from "../../helpers/test-app-context";
import DeepGenomeArtifact from "@/components/research/DeepGenomeArtifact.vue";
import DeepGenomeResultViewerActual from "@/components/DeepGenomeResultViewer.vue";

const download = vi.fn<(format: "pdf" | "markdown") => Promise<void>>(
  async () => undefined
);

const passthrough = defineComponent({
  template: "<div><slot /></div>",
});

const DeepGenomeResultViewerStub = defineComponent({
  name: "DeepGenomeResultViewer",
  props: {
    markdown: { type: String, default: "" },
    references: { type: Array, default: () => [] },
    resources: { type: Array, default: () => [] },
    ns: { type: String, default: "" },
    showActions: { type: Boolean, default: true },
    showReferences: { type: Boolean, default: true },
    renderingFileId: { type: String, default: "" },
  },
  emits: ["citation-activate"],
  setup(props, { expose }) {
    expose({ download });
    return { props };
  },
  template:
    '<article data-test="deep-genome-renderer" :data-markdown="props.markdown" :data-ns="props.ns" :data-actions="String(props.showActions)" :data-references="String(props.showReferences)"><button data-test="deep-genome-citation" @click="$emit(\'citation-activate\', { namespace: props.ns, indices: [2] })">[2]</button></article>',
});

const referenceList = [
  { title: "A complete source" },
  { title: "Another source" },
];

function mountArtifact() {
  return mountWithApp(DeepGenomeArtifact, {
    props: {
      markdown: "# Full report\n\nEvidence [1].",
      references: referenceList,
      ns: "artifact_under",
      title: "Deep genome report",
      metadata: "Deep Genome Agent",
      status: "Finished",
      tabLabels: {
        content: "Report",
        evidence: "Evidence",
        activity: "Activity",
        downloads: "Downloads",
      },
      backLabel: "Back",
      closeLabel: "Close",
      actionLabel: "Actions",
    },
    global: {
      stubs: {
        DeepGenomeResultViewer: DeepGenomeResultViewerStub,
      },
      mocks: { $t: (key: string) => key },
    },
  });
}

function mountArtifactWithActualViewer() {
  return mountWithApp(DeepGenomeArtifact, {
    props: {
      markdown: "## Evidence\n\nSupported claim [1-2].",
      references: referenceList,
      ns: "artifact_under",
      title: "Deep genome report",
      metadata: "Deep Genome Agent",
      status: "Finished",
      tabLabels: {
        content: "Report",
        evidence: "Evidence",
        activity: "Activity",
        downloads: "Downloads",
      },
      backLabel: "Back",
      closeLabel: "Close",
      actionLabel: "Actions",
    },
    global: {
      stubs: {
        DeepGenomeResultViewer: DeepGenomeResultViewerActual,
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
      },
      mocks: { $t: (key: string) => key },
    },
  });
}

describe("DeepGenomeArtifact", () => {
  it("mounts one embedded report and one namespaced evidence panel", () => {
    const wrapper = mountArtifact();

    expect(wrapper.findAll('[data-test="deep-genome-renderer"]')).toHaveLength(
      1
    );
    const renderer = wrapper.get('[data-test="deep-genome-renderer"]');
    expect(renderer.attributes("data-markdown")).toContain("Full report");
    expect(renderer.attributes("data-ns")).toBe("artifact_under");
    expect(renderer.attributes("data-actions")).toBe("false");
    expect(renderer.attributes("data-references")).toBe("false");

    expect(wrapper.findAll(".research-evidence-panel__item")).toHaveLength(2);
    expect(
      wrapper.find(".research-evidence-panel__item").attributes("id")
    ).toBe("artifact_under-ref-1");
    expect(
      wrapper.find(".research-artifact-shell__narrative-content").classes()
    ).toContain("research-artifact-shell__narrative-content--wide");
  });

  it("delegates header download actions to the typed embedded viewer handle", async () => {
    download.mockClear();
    const wrapper = mountArtifact();

    await wrapper
      .get('[data-test="deep-genome-download-pdf"]')
      .trigger("click");
    await wrapper
      .get('[data-test="deep-genome-download-markdown"]')
      .trigger("click");
    await nextTick();

    expect(download).toHaveBeenNthCalledWith(1, "pdf");
    expect(download).toHaveBeenNthCalledWith(2, "markdown");
  });

  it("forwards a persisted rendering-file id into the embedded viewer", () => {
    const wrapper = mountWithApp(DeepGenomeArtifact, {
      props: {
        markdown: "# Full report",
        references: referenceList,
        ns: "artifact_under",
        renderingFileId: "42",
        title: "Deep genome report",
        metadata: "Deep Genome Agent",
        status: "Finished",
        tabLabels: {
          content: "Report",
          evidence: "Evidence",
          activity: "Activity",
          downloads: "Downloads",
        },
        backLabel: "Back",
        closeLabel: "Close",
        actionLabel: "Actions",
      },
      global: {
        stubs: {
          DeepGenomeResultViewer: DeepGenomeResultViewerStub,
        },
        mocks: { $t: (key: string) => key },
      },
    });

    expect(
      wrapper.findComponent(DeepGenomeResultViewerStub).props("renderingFileId")
    ).toBe("42");
  });

  it("contains a rejected embedded viewer download", async () => {
    download.mockRejectedValueOnce(new Error("export failed"));
    const wrapper = mountArtifact();

    await expect(
      wrapper.get('[data-test="deep-genome-download-pdf"]').trigger("click")
    ).resolves.toBeUndefined();
    expect(download).toHaveBeenCalledWith("pdf");
  });

  it("expands the embedded report column on ultra-wide layouts", () => {
    const source = readFileSync(
      resolve(
        __dirname,
        "../../../src/components/research/DeepGenomeArtifact.vue"
      ),
      "utf8"
    );

    expect(source).toMatch(
      /:deep\(\.deep-genome-document\)[\s\S]*?max-width:\s*var\(--phy-layout-artifact-document-max-width\)/
    );
  });

  it("activates the evidence tab and focuses the exact namespaced citation row", async () => {
    const wrapper = mountArtifact();
    const row = wrapper.findAll(".research-evidence-panel__item")[1];
    const scrollIntoView = vi.fn();
    Object.defineProperty(row.element, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    const focus = vi.spyOn(row.element as HTMLElement, "focus");

    await wrapper.get('[data-test="deep-genome-citation"]').trigger("click");
    await nextTick();

    expect(
      wrapper.get('[data-tab-id="evidence"]').attributes("aria-selected")
    ).toBe("true");
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    expect(focus).toHaveBeenCalledTimes(1);
    expect(row.classes()).toContain("research-evidence-panel__item--active");
  });

  it("routes a grouped citation from the mounted viewer to evidence rows", async () => {
    const wrapper = mountArtifactWithActualViewer();
    await nextTick();
    await nextTick();

    const rows = wrapper.findAll(".research-evidence-panel__item");
    const scrollIntoView = vi.fn();
    Object.defineProperty(rows[0].element, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    const focus = vi.spyOn(rows[0].element as HTMLElement, "focus");

    await wrapper.get(".scientific-citation__link").trigger("click");
    await nextTick();
    await nextTick();

    expect(
      wrapper.get('[data-tab-id="evidence"]').attributes("aria-selected")
    ).toBe("true");
    expect(
      rows.map((row) =>
        row.classes().includes("research-evidence-panel__item--active")
      )
    ).toEqual([true, true]);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("passes authorized resources through and relays opaque resource activation", async () => {
    const resources = [
      {
        id: "attachment-1",
        name: "Report",
        kind: "attachment" as const,
        markdownHref: "report.pdf",
      },
    ];
    const wrapper = mountWithApp(DeepGenomeArtifact, {
      props: {
        markdown: "# Report\n\n[Download](report.pdf)",
        references: referenceList,
        resources,
        ns: "artifact_under",
        title: "Deep genome report",
        metadata: "Deep Genome Agent",
        status: "Finished",
        tabLabels: {
          content: "Report",
          evidence: "Evidence",
          activity: "Activity",
          downloads: "Downloads",
        },
        backLabel: "Back",
        closeLabel: "Close",
        actionLabel: "Actions",
      },
      global: {
        stubs: {
          DeepGenomeResultViewer: DeepGenomeResultViewerActual,
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
        },
        mocks: { $t: (key: string) => key },
      },
    });
    await nextTick();
    await nextTick();

    expect(
      wrapper.findComponent(DeepGenomeResultViewerActual).props("resources")
    ).toEqual(resources);
    await wrapper.get(".scientific-resource-link").trigger("click");
    expect(wrapper.emitted("resource-activate")).toEqual([
      [{ id: "attachment-1", kind: "attachment" }],
    ]);
  });
});
