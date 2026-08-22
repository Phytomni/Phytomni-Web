import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises } from "@vue/test-utils";
import { defineComponent, h, nextTick, reactive } from "vue";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createTestAppContext } from "../helpers/test-app-context";

const mocks = vi.hoisted(() => ({
  getGeneDetails: vi.fn(),
  buildDisplayContent: vi.fn((content: string) => content),
  messageError: vi.fn(),
  messageWarning: vi.fn(),
  routerPush: vi.fn(),
}));

const mockRoute = reactive({
  query: {} as Record<string, unknown>,
});

vi.mock("vue-router", () => ({
  useRoute: () => mockRoute,
  useRouter: () => ({ push: mocks.routerPush }),
}));

vi.mock("@/api/gene-display", () => ({
  getGeneDetails: mocks.getGeneDetails,
}));

// Keep the route parsing boundary observable: the real helper also strips the
// trailer, which would otherwise mask GeneDetailView.vue ignoring parseDocTitles.mainContent.
vi.mock("@/views/gene-display/gene-markdown", () => ({
  buildDisplayContent: mocks.buildDisplayContent,
}));

vi.mock("element-plus", async () => {
  const actual =
    await vi.importActual<typeof import("element-plus")>("element-plus");
  return {
    ...actual,
    ElMessage: {
      error: mocks.messageError,
      warning: mocks.messageWarning,
    },
  };
});

import GeneDetail from "@/views/gene-display/GeneDetailView.vue";

const GENE_DETAIL_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/gene-display/GeneDetailView.vue"),
  "utf8"
);

const DeepGenomeArtifactStub = defineComponent({
  name: "DeepGenomeArtifact",
  props: {
    markdown: { type: String, default: "" },
    references: { type: Array, default: () => [] },
    ns: { type: String, default: "" },
    title: { type: String, default: "" },
    metadata: { type: [String, Array], default: undefined },
    tabLabels: { type: Object, default: () => ({}) },
    tablistLabel: { type: String, default: "" },
    artifactId: { type: String, default: "" },
    backLabel: { type: String, default: "" },
    closeLabel: { type: String, default: "" },
    actionLabel: { type: String, default: "" },
    menuItems: { type: Array, default: () => [] },
  },
  setup(props, { emit }) {
    return () =>
      h("article", [
        h("div", {
          "data-testid": "deep-genome-artifact-stub",
          "data-markdown": props.markdown,
          "data-ns": props.ns,
          "data-title": props.title,
          "data-metadata": Array.isArray(props.metadata)
            ? props.metadata.join("|")
            : props.metadata || "",
          "data-tab-labels": JSON.stringify(props.tabLabels),
          "data-tablist-label": props.tablistLabel,
          "data-artifact-id": props.artifactId,
          "data-back-label": props.backLabel,
          "data-close-label": props.closeLabel,
          "data-action-label": props.actionLabel,
          "data-menu-ids": (props.menuItems as { id?: string }[])
            .map((item) => item.id)
            .join(","),
        }),
        h(
          "button",
          { "data-testid": "artifact-back", onClick: () => emit("back") },
          "Back"
        ),
        h(
          "button",
          { "data-testid": "artifact-close", onClick: () => emit("close") },
          "Close"
        ),
      ]);
  },
});

enableAutoUnmount(afterEach);

const successResponse = (overrides: Record<string, unknown> = {}) => ({
  code: 200,
  message: "ok",
  data: {
    content: "# Os01g0107900\n\nEvidence [1]",
    references: [],
    ...overrides,
  },
});

const mountView = () =>
  createTestAppContext().mount(GeneDetail, {
    global: {
      stubs: {
        DeepGenomeArtifact: DeepGenomeArtifactStub,
      },
    },
  });

describe("Gene Detail research artifact", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mockRoute.query).forEach((key) => delete mockRoute.query[key]);
    mocks.getGeneDetails.mockResolvedValue(successResponse());
    mocks.buildDisplayContent.mockImplementation((content: string) => content);
    mocks.routerPush.mockReset();
  });

  it("keeps the artifact column bounded without clipping the report surface", () => {
    const artifactStyleStart = GENE_DETAIL_SOURCE.indexOf(
      ".gene-detail-artifact {"
    );
    const artifactStyleEnd = GENE_DETAIL_SOURCE.indexOf(
      "}",
      artifactStyleStart
    );
    const artifactStyle = GENE_DETAIL_SOURCE.slice(
      artifactStyleStart,
      artifactStyleEnd + 1
    );

    expect(artifactStyle).toContain("max-width: 100%;");
    expect(GENE_DETAIL_SOURCE).toContain('data-scroll-root="gene-detail"');
  });

  it("mounts the completed report in the shared DeepGenome artifact shell", async () => {
    mockRoute.query.file_name = "Os01g0107900_result.md";
    const wrapper = mountView();
    await flushPromises();

    const artifact = wrapper.get('[data-testid="deep-genome-artifact-stub"]');
    expect(artifact.attributes("data-title")).toBe("Os01g0107900_result.md");
    expect(artifact.attributes("data-metadata")).toBe("Deep Genome Agent");
    expect(artifact.attributes("data-markdown")).toContain("# Os01g0107900");
    expect(artifact.attributes("data-ns")).toBe("gene-detail");
    expect(artifact.attributes("data-back-label")).toBe("Back");
    expect(artifact.attributes("data-close-label")).toBe("Close");
    expect(artifact.attributes("data-action-label")).toBe("Operation");
    expect(artifact.attributes("data-menu-ids")).toBe("copy,close");
    expect(artifact.attributes("data-tablist-label")).toBe("Operation");
    expect(artifact.attributes("data-artifact-id")).toBe(
      "gene-detail-artifact"
    );
    expect(JSON.parse(artifact.attributes("data-tab-labels"))).toEqual({
      content: "View",
      evidence: "References",
      activity: "Execution log",
      downloads: "Download attachments",
    });
    expect(wrapper.find('[data-scroll-root="gene-detail"]').exists()).toBe(
      true
    );
    expect(wrapper.find('[data-scroll-root="workspace"]').exists()).toBe(false);
  });

  it("renders an explicit shared empty state and skips the API when file_name is missing", async () => {
    const wrapper = mountView();
    await flushPromises();

    expect(mocks.getGeneDetails).not.toHaveBeenCalled();
    expect(wrapper.find(".gene-detail-route").exists()).toBe(true);
    expect(wrapper.find(".phy-workspace-shell").exists()).toBe(false);
    expect(wrapper.find(".phy-async-state--empty").exists()).toBe(true);
    expect(wrapper.text()).toContain("Gene details not found");
  });

  it("shows a polite loading state while the requested document is pending", async () => {
    mockRoute.query.file_name = "Os01g0107900.md";
    let resolveRequest: (
      value: ReturnType<typeof successResponse>
    ) => void = () => undefined;
    mocks.getGeneDetails.mockReturnValue(
      new Promise<ReturnType<typeof successResponse>>((resolve) => {
        resolveRequest = resolve;
      })
    );

    const wrapper = mountView();
    await nextTick();

    expect(mocks.getGeneDetails).toHaveBeenCalledWith({
      file_name: "Os01g0107900.md",
    });
    expect(wrapper.get(".phy-async-state").attributes("aria-busy")).toBe(
      "true"
    );
    expect(wrapper.find(".phy-skeleton").exists()).toBe(true);
    expect(wrapper.findComponent(DeepGenomeArtifactStub).exists()).toBe(false);

    resolveRequest(successResponse());
    await flushPromises();
  });

  it("uses parsed main content, DOC TITLES fallback references, and a safe viewer namespace", async () => {
    mockRoute.query.file_name = "Os01g0107900.md";
    mocks.getGeneDetails.mockResolvedValue(
      successResponse({
        content:
          "# Os01g0107900\n\nEvidence [1]\n\n--- DOC TITLES ---\n1. Fallback paper\n2. Second paper",
      })
    );

    const wrapper = mountView();
    await flushPromises();

    expect(mocks.getGeneDetails).toHaveBeenCalledOnce();
    expect(mocks.getGeneDetails).toHaveBeenCalledWith({
      file_name: "Os01g0107900.md",
    });
    expect(wrapper.findComponent(DeepGenomeArtifactStub).props("title")).toBe(
      "Os01g0107900.md"
    );
    expect(mocks.buildDisplayContent).toHaveBeenLastCalledWith(
      "# Os01g0107900\n\nEvidence [1]"
    );

    const artifact = wrapper.findComponent(DeepGenomeArtifactStub);
    expect(artifact.props("markdown")).toBe("# Os01g0107900\n\nEvidence [1]");
    expect(artifact.props("references")).toEqual([
      { title: "Fallback paper" },
      { title: "Second paper" },
    ]);
    expect(artifact.props("ns")).toBe("gene-detail");
    expect(artifact.props("markdown")).not.toContain("DOC TITLES");
    expect(artifact.props("markdown")).not.toContain("Fallback paper");
  });

  it("prefers API references over the DOC TITLES fallback", async () => {
    mockRoute.query.file_name = "Os01g0107900.md";
    const apiReferences = [
      { title: "API paper", pm: "12345" },
      { title: "API dataset", dl: "https://example.test/data" },
    ];
    mocks.getGeneDetails.mockResolvedValue(
      successResponse({
        content:
          "# Os01g0107900\n\nEvidence [1]\n\n--- DOC TITLES ---\n1. Fallback paper",
        references: apiReferences,
      })
    );

    const wrapper = mountView();
    await flushPromises();

    const artifact = wrapper.findComponent(DeepGenomeArtifactStub);
    expect(artifact.props("references")).toEqual(apiReferences);
    expect(artifact.props("markdown")).toBe("# Os01g0107900\n\nEvidence [1]");
  });

  it("uses the shared not-found state for a successful response without content", async () => {
    mockRoute.query.file_name = "missing.md";
    mocks.getGeneDetails.mockResolvedValue(successResponse({ content: "" }));

    const wrapper = mountView();
    await flushPromises();

    expect(wrapper.find(".phy-async-state--empty").exists()).toBe(true);
    expect(wrapper.text()).toContain("Gene details not found");
    expect(wrapper.findComponent(DeepGenomeArtifactStub).exists()).toBe(false);
  });

  it("shows an actionable error for a failed response and retries the same file", async () => {
    mockRoute.query.file_name = "Os01g0107900.md";
    mocks.getGeneDetails
      .mockResolvedValueOnce({ code: 503, message: "Unavailable", data: null })
      .mockResolvedValueOnce(successResponse());

    const wrapper = mountView();
    await flushPromises();

    expect(wrapper.find(".phy-async-state--error").exists()).toBe(true);
    expect(wrapper.text()).toContain("Failed to get gene details");

    await wrapper.get(".phy-error-state__retry").trigger("click");
    await flushPromises();

    expect(mocks.getGeneDetails).toHaveBeenCalledTimes(2);
    expect(mocks.getGeneDetails).toHaveBeenLastCalledWith({
      file_name: "Os01g0107900.md",
    });
    expect(wrapper.find(".phy-async-state--ready").exists()).toBe(true);
    expect(wrapper.findComponent(DeepGenomeArtifactStub).exists()).toBe(true);
  });

  it("shows the same retry state when the request rejects", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockRoute.query.file_name = "Os01g0107900.md";
    mocks.getGeneDetails.mockRejectedValue(new Error("network unavailable"));

    const wrapper = mountView();
    await flushPromises();

    expect(wrapper.find(".phy-async-state--error").exists()).toBe(true);
    expect(wrapper.find(".phy-error-state__retry").exists()).toBe(true);
    expect(mocks.messageError).toHaveBeenCalledWith(
      "Failed to get gene details"
    );
  });

  it("keeps the workspace as the only route scroll root", async () => {
    mockRoute.query.file_name = "Os01g0107900.md";
    const wrapper = mountView();
    await flushPromises();

    expect(wrapper.findAll('[data-scroll-root="gene-detail"]')).toHaveLength(1);
    expect(wrapper.find(".gene-detail-artifact").exists()).toBe(true);
    expect(wrapper.find('[data-scroll-root="workspace"]').exists()).toBe(false);
  });

  it("loads the new document when file_name changes on the reused route", async () => {
    let resolveFirst: (
      value: ReturnType<typeof successResponse>
    ) => void = () => undefined;
    let resolveSecond: (
      value: ReturnType<typeof successResponse>
    ) => void = () => undefined;
    const firstRequest = new Promise<ReturnType<typeof successResponse>>(
      (resolve) => {
        resolveFirst = resolve;
      }
    );
    const secondRequest = new Promise<ReturnType<typeof successResponse>>(
      (resolve) => {
        resolveSecond = resolve;
      }
    );
    mockRoute.query.file_name = "first.md";
    mocks.getGeneDetails
      .mockReturnValueOnce(firstRequest)
      .mockReturnValueOnce(secondRequest);

    const wrapper = mountView();
    await nextTick();

    mockRoute.query.file_name = "second.md";
    await nextTick();
    resolveSecond(successResponse({ content: "# Second gene" }));
    await flushPromises();

    expect(mocks.getGeneDetails).toHaveBeenCalledTimes(2);
    expect(mocks.getGeneDetails).toHaveBeenLastCalledWith({
      file_name: "second.md",
    });
    expect(wrapper.findComponent(DeepGenomeArtifactStub).props("title")).toBe(
      "second.md"
    );
    expect(
      wrapper.findComponent(DeepGenomeArtifactStub).props("markdown")
    ).toBe("# Second gene");

    resolveFirst(successResponse({ content: "# Stale first gene" }));
    await flushPromises();

    expect(
      wrapper.findComponent(DeepGenomeArtifactStub).props("markdown")
    ).toBe("# Second gene");
  });

  it("suppresses a pending request after the route component unmounts", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let rejectRequest: (reason: Error) => void = () => undefined;
    mocks.getGeneDetails.mockReturnValue(
      new Promise((_, reject) => {
        rejectRequest = reject;
      })
    );
    mockRoute.query.file_name = "first.md";

    const wrapper = mountView();
    await nextTick();
    wrapper.unmount();
    rejectRequest(new Error("late network failure"));
    await flushPromises();

    expect(mocks.messageError).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("uses browser history when the detail tab has navigable history", async () => {
    mockRoute.query.file_name = "Os01g0107900.md";
    const wrapper = mountView();
    await flushPromises();

    const originalHistoryLength = window.history.length;
    Object.defineProperty(window.history, "length", {
      configurable: true,
      value: 2,
    });
    const historyBack = vi
      .spyOn(window.history, "back")
      .mockImplementation(() => undefined);

    try {
      await wrapper.get('[data-testid="artifact-back"]').trigger("click");
      expect(historyBack).toHaveBeenCalledOnce();
      expect(mocks.routerPush).not.toHaveBeenCalled();
    } finally {
      historyBack.mockRestore();
      Object.defineProperty(window.history, "length", {
        configurable: true,
        value: originalHistoryLength,
      });
    }
  });

  it("closes a detail tab opened by Gene Display when no history exists", async () => {
    mockRoute.query.file_name = "Os01g0107900.md";
    const wrapper = mountView();
    await flushPromises();

    const originalHistoryLength = window.history.length;
    const originalOpener = window.opener;
    Object.defineProperty(window.history, "length", {
      configurable: true,
      value: 1,
    });
    Object.defineProperty(window, "opener", {
      configurable: true,
      value: { closed: false },
    });
    const close = vi.spyOn(window, "close").mockImplementation(() => undefined);

    try {
      await wrapper.get('[data-testid="artifact-close"]').trigger("click");
      expect(close).toHaveBeenCalledOnce();
      expect(mocks.routerPush).not.toHaveBeenCalled();
    } finally {
      close.mockRestore();
      Object.defineProperty(window.history, "length", {
        configurable: true,
        value: originalHistoryLength,
      });
      Object.defineProperty(window, "opener", {
        configurable: true,
        value: originalOpener,
      });
    }
  });

  it("routes back to Gene Display when a standalone detail tab cannot close", async () => {
    mockRoute.query.file_name = "Os01g0107900.md";
    const wrapper = mountView();
    await flushPromises();

    const originalHistoryLength = window.history.length;
    const originalOpener = window.opener;
    Object.defineProperty(window.history, "length", {
      configurable: true,
      value: 1,
    });
    Object.defineProperty(window, "opener", {
      configurable: true,
      value: null,
    });

    try {
      await wrapper.get('[data-testid="artifact-back"]').trigger("click");
      expect(mocks.routerPush).toHaveBeenCalledWith({ name: "geneDisplay" });
    } finally {
      Object.defineProperty(window.history, "length", {
        configurable: true,
        value: originalHistoryLength,
      });
      Object.defineProperty(window, "opener", {
        configurable: true,
        value: originalOpener,
      });
    }
  });
});
