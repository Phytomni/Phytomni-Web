import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises } from "@vue/test-utils";
import { mountWithApp } from "../helpers/test-app-context";
import ScientificCifViewer from "@/components/scientific/ScientificCifViewer.vue";
import ScientificMarkdown from "@/components/ScientificMarkdown.vue";
import type { ThreeDMolViewer } from "@/utils/3dmol";

const mol = vi.hoisted(() => ({ createViewer: vi.fn() }));
vi.mock("@/utils/3dmol", () => ({ load3DMol: async () => mol }));
enableAutoUnmount(afterEach);
let viewers: Array<ThreeDMolViewer & { zoom(factor: number): void }> = [];
let fetchMock = vi.fn();
let dimensions = { width: 800, height: 600 };
let resizeCallback: ResizeObserverCallback;
const disconnect = vi.fn();
beforeEach(() => {
  viewers = [];
  dimensions = { width: 800, height: 600 };
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(
    () => dimensions.width
  );
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
    () => dimensions.height
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
      }
      observe = vi.fn();
      disconnect = disconnect;
    }
  );
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  mol.createViewer.mockImplementation(() => {
    const viewer = {
      addModel: vi.fn(),
      setStyle: vi.fn(),
      zoomTo: vi.fn(),
      zoom: vi.fn(),
      resize: vi.fn(),
      render: vi.fn(),
      animate: vi.fn(),
      stopAnimate: vi.fn(),
      clear: vi.fn(),
    };
    viewers.push(viewer);
    return viewer;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
const resource = (
  read: (signal: AbortSignal) => Promise<string>,
  id = "structure"
) => ({
  id,
  name: "Structure",
  kind: "cif" as const,
  markdownHref: "./model.cif",
  renderSource: { kind: "cif-text" as const, read },
});

describe("ScientificCifViewer protected render-only sources", () => {
  it("fits a fresh narrow container using the horizontal field of view", async () => {
    dimensions = { width: 252, height: 384 };
    mountWithApp(ScientificCifViewer, {
      props: { resource: resource(async () => "data_model") },
    });
    await flushPromises();
    expect(viewers[0].zoomTo).toHaveBeenCalledOnce();
    expect(viewers[0].zoom).toHaveBeenCalledExactlyOnceWith(252 / 384);
    expect(
      vi.mocked(viewers[0].zoomTo).mock.invocationCallOrder[0]
    ).toBeLessThan(vi.mocked(viewers[0].zoom).mock.invocationCallOrder[0]);
  });
  it("preserves manual zoom across aspect changes without resetting rotation or pan", async () => {
    const wrapper = mountWithApp(ScientificCifViewer, {
      props: { resource: resource(async () => "data_model") },
    });
    await flushPromises();
    const viewer = viewers[0];
    expect(viewer.zoom).not.toHaveBeenCalled();
    // Public zoom multiplies the current view distance, retaining rotation/pan.
    viewer.zoom(2);
    dimensions = { width: 300, height: 600 };
    resizeCallback([], {} as ResizeObserver);
    expect(vi.mocked(viewer.zoom).mock.calls).toEqual([[2], [0.5]]);
    dimensions = { width: 200, height: 400 };
    resizeCallback([], {} as ResizeObserver);
    expect(viewer.zoom).toHaveBeenCalledTimes(2);
    dimensions = { width: 0, height: 0 };
    const resizeCalls = vi.mocked(viewer.resize).mock.calls.length;
    resizeCallback([], {} as ResizeObserver);
    expect(viewer.resize).toHaveBeenCalledTimes(resizeCalls);
    dimensions = { width: 800, height: 600 };
    resizeCallback([], {} as ResizeObserver);
    expect(vi.mocked(viewer.zoom).mock.calls).toEqual([[2], [0.5], [2]]);
    expect(viewer.zoomTo).toHaveBeenCalledOnce();
    wrapper.unmount();
    resizeCallback([], {} as ResizeObserver);
    expect(disconnect).toHaveBeenCalled();
    expect(viewer.zoom).toHaveBeenCalledTimes(3);
  });
  it("resets aspect compensation when the protected source changes", async () => {
    dimensions = { width: 300, height: 600 };
    const wrapper = mountWithApp(ScientificCifViewer, {
      props: { resource: resource(async () => "data_first") },
    });
    await flushPromises();
    await wrapper.setProps({
      resource: resource(async () => "data_second", "new"),
    });
    await flushPromises();
    expect(viewers).toHaveLength(2);
    viewers.forEach((viewer) => {
      expect(viewer.zoomTo).toHaveBeenCalledOnce();
      expect(viewer.zoom).toHaveBeenCalledExactlyOnceWith(0.5);
    });
  });
  it("renders bounded authenticated text without fetching or creating a Blob URL", async () => {
    const read = vi.fn(async () => "data_model\n_atom_site.id 1");
    const wrapper = mountWithApp(ScientificCifViewer, {
      props: { resource: resource(read) },
    });
    await flushPromises();
    expect(read).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(viewers[0]?.addModel).toHaveBeenCalledWith(
      "data_model\n_atom_site.id 1",
      "cif"
    );
    expect(
      wrapper
        .get(".scientific-cif-viewer")
        .attributes("data-scientific-cif-ready")
    ).toBe("true");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(["[Structure](./model.cif)", "![Structure](./model.cif)"])(
    "uses the shared Markdown resource path for %s",
    async (source) => {
      const read = vi.fn(async () => "data_model");
      const wrapper = mountWithApp(ScientificMarkdown, {
        props: { source, resources: [resource(read)] },
      });
      await vi.dynamicImportSettled();
      await flushPromises();
      expect(wrapper.findComponent(ScientificCifViewer).exists()).toBe(true);
      expect(read).toHaveBeenCalledOnce();
      expect(viewers[0]?.addModel).toHaveBeenCalledWith("data_model", "cif");
    }
  );
  it("keeps the static Case URL path", async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => "data_case" });
    mountWithApp(ScientificCifViewer, {
      props: {
        resource: {
          id: "case",
          name: "Case structure",
          kind: "cif",
          markdownHref: "./model.cif",
          displayUrl: "/bundled/model.cif",
        },
      },
    });
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledWith(
      "/bundled/model.cif",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(viewers[0]?.addModel).toHaveBeenCalledWith("data_case", "cif");
  });
  it("cleans up a failed parser without exposing the source or its internal error", async () => {
    let finish!: (text: string) => void;
    const wrapper = mountWithApp(ScientificCifViewer, {
      props: {
        resource: resource(
          () =>
            new Promise((resolve) => {
              finish = resolve;
            })
        ),
      },
    });
    await flushPromises();
    vi.mocked(viewers[0].addModel).mockImplementation(() => {
      throw new Error("internal object coordinates");
    });
    finish("data_private_input");
    await flushPromises();
    expect(wrapper.text()).toBe("Structure unavailable");
    expect(wrapper.find('[data-scientific-cif-ready="true"]').exists()).toBe(
      false
    );
    expect(viewers[0].clear).toHaveBeenCalledOnce();
    expect(viewers[0].stopAnimate).toHaveBeenCalledOnce();
  });
  it("rejects dual sources and unsafe static URLs without calling either reader", async () => {
    const read = vi.fn(async () => "data_model");
    const wrapper = mountWithApp(ScientificCifViewer, {
      props: { resource: { ...resource(read), displayUrl: "/model.cif" } },
    });
    await flushPromises();
    expect(read).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(wrapper.text()).toBe("Resource unavailable");
    await wrapper.setProps({
      resource: {
        id: "unsafe",
        name: "Unsafe",
        kind: "cif",
        markdownHref: "./model.cif",
        displayUrl: "blob:https://example.test/private",
      },
    });
    await flushPromises();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mol.createViewer).not.toHaveBeenCalled();
  });
  it("aborts replaced/unmounted readers and isolates late completions", async () => {
    let resolveA!: (value: string) => void;
    let signalA!: AbortSignal;
    const a = resource((signal) => {
      signalA = signal;
      return new Promise((resolve) => {
        resolveA = resolve;
      });
    });
    const wrapper = mountWithApp(ScientificCifViewer, {
      props: { resource: a },
    });
    await flushPromises();
    // A fresh revision may keep the same resource ID and href.
    const b = resource(async () => "data_new");
    await wrapper.setProps({ resource: b });
    await flushPromises();
    expect(signalA.aborted).toBe(true);
    resolveA("data_stale");
    await flushPromises();
    expect(
      viewers.flatMap((viewer) => vi.mocked(viewer.addModel).mock.calls)
    ).toEqual([["data_new", "cif"]]);
    let signalC!: AbortSignal;
    let resolveC!: (value: string) => void;
    await wrapper.setProps({
      resource: resource((signal) => {
        signalC = signal;
        return new Promise((resolve) => {
          resolveC = resolve;
        });
      }, "third"),
    });
    await flushPromises();
    wrapper.unmount();
    expect(signalC.aborted).toBe(true);
    resolveC("data_after_unmount");
    await flushPromises();
    expect(
      viewers.flatMap((viewer) => vi.mocked(viewer.addModel).mock.calls)
    ).toEqual([["data_new", "cif"]]);
    viewers.forEach((viewer) => expect(viewer.clear).toHaveBeenCalled());
  });
  it.each([
    "",
    "<!doctype html><html>internal path</html>",
    "x".repeat(8 * 1024 * 1024 + 1),
  ])("rejects malformed or oversized render-only text", async (text) => {
    const wrapper = mountWithApp(ScientificCifViewer, {
      props: { resource: resource(async () => text) },
    });
    await flushPromises();
    expect(wrapper.text()).toBe("Structure unavailable");
    expect(
      viewers.flatMap((viewer) => vi.mocked(viewer.addModel).mock.calls)
    ).toEqual([]);
  });
});
