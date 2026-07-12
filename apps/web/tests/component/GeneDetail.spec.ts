import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  config,
  enableAutoUnmount,
  flushPromises,
  mount,
} from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { defineComponent, h, nextTick, reactive } from "vue";
import enUS from "@/locales/langs/en-US";
import zhCN from "@/locales/langs/zh-CN";

const mocks = vi.hoisted(() => ({
  getGeneDetails: vi.fn(),
  buildDisplayContent: vi.fn((content: string) => content),
  messageError: vi.fn(),
  messageWarning: vi.fn(),
}));

const mockRoute = reactive({
  query: {} as Record<string, unknown>,
});

vi.mock("vue-router", () => ({
  useRoute: () => mockRoute,
}));

vi.mock("@/api/gene-display", () => ({
  getGeneDetails: mocks.getGeneDetails,
}));

// Keep the route parsing boundary observable: the real helper also strips the
// trailer, which would otherwise mask detail.vue ignoring parseDocTitles.mainContent.
vi.mock("@/views/gene-display/gene-markdown", () => ({
  buildDisplayContent: mocks.buildDisplayContent,
}));

vi.mock("element-plus", () => ({
  ElMessage: {
    error: mocks.messageError,
    warning: mocks.messageWarning,
  },
}));

import GeneDetail from "@/views/gene-display/detail.vue";

const DeepGenomeResultViewerStub = defineComponent({
  name: "DeepGenomeResultViewer",
  props: {
    markdown: { type: String, default: "" },
    references: { type: Array, default: () => [] },
    ns: { type: String, default: "" },
    embedded: { type: Boolean, default: false },
  },
  setup(props) {
    return () =>
      h("article", {
        "data-testid": "deep-genome-viewer-stub",
        "data-markdown": props.markdown,
        "data-ns": props.ns,
        "data-embedded": String(props.embedded),
      });
  },
});

const i18n = createI18n({
  legacy: false,
  locale: "en-US",
  fallbackLocale: "en-US",
  messages: { "en-US": enUS, "zh-CN": zhCN },
});

config.global.plugins = [i18n];
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
  mount(GeneDetail, {
    global: {
      stubs: {
        DeepGenomeResultViewer: DeepGenomeResultViewerStub,
      },
    },
  });

describe("Gene Detail research workspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mockRoute.query).forEach((key) => delete mockRoute.query[key]);
    mocks.getGeneDetails.mockResolvedValue(successResponse());
    mocks.buildDisplayContent.mockImplementation((content: string) => content);
  });

  it("renders an explicit shared empty state and skips the API when file_name is missing", async () => {
    const wrapper = mountView();
    await flushPromises();

    expect(mocks.getGeneDetails).not.toHaveBeenCalled();
    expect(wrapper.find(".phy-workspace-shell").exists()).toBe(true);
    expect(wrapper.find(".phy-page-header h1").text()).toBe(
      "Gene research result"
    );
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
    expect(wrapper.find(".phy-page-header h1").text()).toBe("Os01g0107900.md");
    expect(mocks.buildDisplayContent).toHaveBeenLastCalledWith(
      "# Os01g0107900\n\nEvidence [1]"
    );

    const viewer = wrapper.findComponent(DeepGenomeResultViewerStub);
    expect(viewer.props("markdown")).toBe("# Os01g0107900\n\nEvidence [1]");
    expect(viewer.props("references")).toEqual([
      { title: "Fallback paper" },
      { title: "Second paper" },
    ]);
    expect(viewer.props("ns")).toBe("gene-detail");
    expect(viewer.props("embedded")).toBe(true);
    expect(viewer.props("markdown")).not.toContain("DOC TITLES");
    expect(viewer.props("markdown")).not.toContain("Fallback paper");
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

    const viewer = wrapper.findComponent(DeepGenomeResultViewerStub);
    expect(viewer.props("references")).toEqual(apiReferences);
    expect(viewer.props("markdown")).toBe("# Os01g0107900\n\nEvidence [1]");
  });

  it("uses the shared not-found state for a successful response without content", async () => {
    mockRoute.query.file_name = "missing.md";
    mocks.getGeneDetails.mockResolvedValue(successResponse({ content: "" }));

    const wrapper = mountView();
    await flushPromises();

    expect(wrapper.find(".phy-async-state--empty").exists()).toBe(true);
    expect(wrapper.text()).toContain("Gene details not found");
    expect(wrapper.findComponent(DeepGenomeResultViewerStub).exists()).toBe(
      false
    );
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

    expect(wrapper.findAll('[data-scroll-root="workspace"]')).toHaveLength(1);
    expect(wrapper.find(".gene-detail-result").exists()).toBe(true);
    expect(wrapper.find(".gene-detail-container").exists()).toBe(false);
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
    expect(wrapper.find(".phy-page-header h1").text()).toBe("second.md");
    expect(
      wrapper.findComponent(DeepGenomeResultViewerStub).props("markdown")
    ).toBe("# Second gene");

    resolveFirst(successResponse({ content: "# Stale first gene" }));
    await flushPromises();

    expect(
      wrapper.findComponent(DeepGenomeResultViewerStub).props("markdown")
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
});
