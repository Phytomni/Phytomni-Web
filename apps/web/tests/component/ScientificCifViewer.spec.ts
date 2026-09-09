import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises } from "@vue/test-utils";
import {
  createTestAppContext,
  mountWithApp,
} from "../helpers/test-app-context";
import enUS from "@/locales/langs/en-US";
import zhCN from "@/locales/langs/zh-CN";
import ScientificCifViewer from "@/components/scientific/ScientificCifViewer.vue";
import ScientificMarkdown from "@/components/ScientificMarkdown.vue";
import { readFileSync } from "node:fs";

const tokens = readFileSync("src/styles/tokens.css", "utf8");
const componentStyles = readFileSync(
  "src/components/scientific/ScientificCifViewer.vue",
  "utf8"
).split("<style scoped>")[1];
const markdownStyles = readFileSync("src/styles/markdown.css", "utf8");

const mol = vi.hoisted(() => ({ createViewer: vi.fn(), load: vi.fn() }));
vi.mock("@/utils/3dmol", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/3dmol")>()),
  load3DMol: () => mol.load(),
}));
enableAutoUnmount(afterEach);
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function createMockViewer(target: HTMLElement) {
  target.append(document.createElement("canvas"));
  return {
    addModel: vi.fn(),
    selectedAtoms: vi.fn(() => [{ x: 0, y: 0, z: 0 }]),
    modelToScreen: vi.fn((points: Array<{ x: number; y: number; z: number }>) =>
      points.map(({ x, y }) => ({
        x:
          dimensions.width / 2 +
          x * Math.min(dimensions.width, dimensions.height) * 0.11,
        y:
          dimensions.height / 2 +
          y * Math.min(dimensions.width, dimensions.height) * 0.11,
      }))
    ),
    addSurface: vi.fn(() => Object.assign(Promise.resolve(7), { surfid: 7 })),
    setStyle: vi.fn(),
    setProjection: vi.fn(),
    setViewStyle: vi.fn(),
    setSurfaceMaterialStyle: vi.fn(),
    getView: vi.fn(() => [0, 0, 0, -20, 0.1, 0.2, 0.3, 0.9]),
    setView: vi.fn(),
    translateScene: vi.fn(),
    rotate: vi.fn(),
    zoomTo: vi.fn(),
    zoom: vi.fn<(factor: number) => void>(),
    resize: vi.fn(),
    render: vi.fn(),
    animate: vi.fn(),
    stopAnimate: vi.fn(),
    clear: vi.fn(),
    removeSurface: vi.fn(),
  };
}
let viewers: ReturnType<typeof createMockViewer>[] = [];
let fetchMock = vi.fn();
let dimensions = { width: 800, height: 600 };
let resizeCallback: ResizeObserverCallback;
const disconnect = vi.fn();
let tokenStyles: HTMLStyleElement;
beforeEach(() => {
  tokenStyles = document.createElement("style");
  tokenStyles.textContent = tokens;
  document.head.append(tokenStyles);
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
  mol.load.mockResolvedValue(mol);
  mol.createViewer.mockImplementation((target: HTMLElement) => {
    const viewer = createMockViewer(target);
    viewers.push(viewer);
    return viewer;
  });
});
afterEach(() => {
  tokenStyles.remove();
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
  it("owns continuous canvas geometry locally without putting the dialog inside a size container", () => {
    const hostRule =
      componentStyles.match(
        /\.scientific-cif-block__host\s*\{([^}]+)\}/
      )?.[1] ?? "";
    expect(hostRule).toContain("container-type: inline-size");
    expect(componentStyles).toMatch(
      /height:\s*clamp\(\s*min\(280px, 60dvh\),\s*62cqi,\s*min\(920px, 76dvh\)\s*\)/
    );
    expect(markdownStyles).not.toContain(
      ".phy-markdown .scientific-cif-viewer"
    );
    const blockRule =
      componentStyles.match(/\.scientific-cif-block\s*\{([^}]+)\}/)?.[1] ?? "";
    expect(blockRule).not.toContain("container-type");
    expect(componentStyles).toContain("@media (forced-colors: active)");
    expect(componentStyles).toMatch(
      /\[aria-checked="true"\]\s*\{\s*border-width:\s*2px/
    );
  });

  it("preserves the native instance and user camera during continuous sizes and theme changes", async () => {
    const read = vi.fn(async () => "data_model");
    const context = createTestAppContext();
    const wrapper = context.mount(ScientificCifViewer, {
      props: { resource: resource(read) },
    });
    await flushPromises();
    const canvas = wrapper.get("canvas").element;
    const current = viewers[0];
    current.zoom(1.5);
    current.rotate(27, "y");
    for (const width of [
      320, 390, 480, 768, 899, 900, 1024, 1199, 1279, 1280, 1366, 1440, 1920,
      2560,
    ]) {
      dimensions = {
        width,
        height: Math.min(920, Math.max(280, width * 0.62)),
      };
      resizeCallback([], {} as ResizeObserver);
    }
    document.documentElement.classList.add("dark");
    context.i18n.global.locale.value = "zh-CN";
    await flushPromises();
    expect(wrapper.get("canvas").element).toBe(canvas);
    expect(current.zoomTo).toHaveBeenCalledOnce();
    expect(current.modelToScreen).toHaveBeenCalledOnce();
    expect(current.setView).not.toHaveBeenCalled();
    expect(current.addSurface).toHaveBeenCalledOnce();
    expect(mol.createViewer).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledOnce();
    expect(wrapper.get('[data-cif-action="enlarge"]').text()).toBe(
      zhCN.scientificCif.enlarge
    );
    document.documentElement.classList.remove("dark");
  });
  it("focuses only the current viewport on native pointer input and releases the old listener", async () => {
    const wrapper = mountWithApp(ScientificCifViewer, {
      attachTo: document.body,
      props: { resource: resource(async () => "data_model") },
    });
    await flushPromises();
    const viewport = wrapper.get(".scientific-cif-viewer")
      .element as HTMLElement;
    const focus = vi.spyOn(viewport, "focus");
    const pointer = new Event("pointerdown", {
      bubbles: true,
      cancelable: true,
    });
    wrapper.get("canvas").element.dispatchEvent(pointer);
    expect(document.activeElement).toBe(viewport);
    expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    expect(pointer.defaultPrevented).toBe(false);
    await wrapper.setProps({ resource: resource(async () => "data_next") });
    await flushPromises();
    focus.mockClear();
    viewport.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(focus).not.toHaveBeenCalled();
    const control = wrapper.get('[data-cif-action="reset"]')
      .element as HTMLElement;
    control.focus();
    await wrapper.get('[data-cif-action="reset"]').trigger("pointerdown");
    expect(document.activeElement).toBe(control);
  });
  it("keeps the initial reset orientation when native input changes the view during SES building", async () => {
    const source = deferred<string>();
    const surface = deferred<number>();
    const wrapper = mountWithApp(ScientificCifViewer, {
      props: { resource: resource(() => source.promise) },
    });
    await flushPromises();
    const initial = [0, 0, 0, -20, 0.1, 0.2, 0.3, 0.9];
    viewers[0].getView.mockReturnValue(initial);
    viewers[0].addSurface.mockReturnValueOnce(
      Object.assign(surface.promise, { surfid: 7 })
    );
    source.resolve("data_model");
    await flushPromises();
    viewers[0].getView.mockReturnValue([4, 5, 6, -80, 0.6, 0.2, 0.3, 0.4]);
    surface.resolve(7);
    await flushPromises();
    await wrapper.get('[data-cif-action="reset"]').trigger("click");
    expect(viewers[0].setView).toHaveBeenCalledExactlyOnceWith(initial);
  });
  it("keeps a native redraw failure local and recoverable", async () => {
    const wrapper = mountWithApp(ScientificCifViewer, {
      props: { resource: resource(async () => "data_model") },
    });
    await flushPromises();
    viewers[0].render.mockImplementationOnce(() => {
      throw new Error("Private native redraw details");
    });
    expect(() => resizeCallback([], {} as ResizeObserver)).not.toThrow();
    await flushPromises();
    expect(wrapper.text()).toContain(enUS.scientificCif.error);
    expect(wrapper.text()).not.toContain("Private");
    expect(wrapper.find('[data-scientific-cif-ready="true"]').exists()).toBe(
      false
    );
    await wrapper.get(".phy-error-state__retry").trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-scientific-cif-ready="true"]').exists()).toBe(
      true
    );
  });
  it("toggles the owned surface without reparsing, rebuilding or changing the camera", async () => {
    const read = vi.fn(async () => "data_model");
    const wrapper = mountWithApp(ScientificCifViewer, {
      props: { resource: resource(read) },
    });
    await flushPromises();
    const surface = wrapper.get('[role="switch"]');
    expect(surface.attributes("aria-checked")).toBe("true");
    await surface.trigger("click");
    expect(surface.attributes("aria-checked")).toBe("false");
    await surface.trigger("click");
    expect(surface.attributes("aria-checked")).toBe("true");
    expect(viewers[0].setSurfaceMaterialStyle.mock.calls).toEqual([
      [7, { color: "#66bf99", opacity: 0 }],
      [7, { color: "#66bf99", opacity: 0.45 }],
    ]);
    expect(read).toHaveBeenCalledOnce();
    expect(viewers[0].addModel).toHaveBeenCalledOnce();
    expect(viewers[0].addSurface).toHaveBeenCalledOnce();
    expect(viewers[0].zoomTo).toHaveBeenCalledOnce();
    expect(viewers[0].setView).not.toHaveBeenCalled();
    expect(wrapper.find('[data-scientific-cif-ready="true"]').exists()).toBe(
      true
    );
  });

  it("resets initial orientation using current dimensions without changing surface visibility", async () => {
    const wrapper = mountWithApp(ScientificCifViewer, {
      props: { resource: resource(async () => "data_model") },
    });
    await flushPromises();
    await wrapper.get('[role="switch"]').trigger("click");
    const originalView = [...viewers[0].getView.mock.results[0].value];
    dimensions = { width: 1600, height: 400 };
    await wrapper.get('[data-cif-action="reset"]').trigger("click");
    expect(viewers[0].setView).toHaveBeenCalledExactlyOnceWith(originalView);
    expect(viewers[0].zoomTo).toHaveBeenCalledTimes(2);
    expect(viewers[0].addSurface).toHaveBeenCalledOnce();
    expect(wrapper.get('[role="switch"]').attributes("aria-checked")).toBe(
      "false"
    );
  });

  it("handles keyboard rotation, scene pan and zoom only on the current focused viewport", async () => {
    const wrapper = mountWithApp(ScientificCifViewer, {
      attachTo: document.body,
      props: { resource: resource(async () => "data_model") },
    });
    await flushPromises();
    const viewport = wrapper.get(".scientific-cif-viewer");
    expect(viewport.attributes("tabindex")).toBe("0");
    expect(viewport.attributes("aria-describedby")).toBeTruthy();
    (viewport.element as HTMLElement).focus();
    viewers[0].rotate.mockClear();
    viewers[0].zoom.mockClear();
    for (const key of ["ArrowRight", "ArrowUp", "+", "-"]) {
      const event = new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
      });
      viewport.element.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
    await viewport.trigger("keydown", { key: "ArrowLeft", shiftKey: true });
    expect(viewers[0].rotate.mock.calls).toEqual([
      [10, "y"],
      [10, "x"],
    ]);
    expect(viewers[0].zoom.mock.calls).toEqual([[1.2], [1 / 1.2]]);
    expect(viewers[0].translateScene).toHaveBeenCalledWith(-20, 0);
    const rotateCalls = viewers[0].rotate.mock.calls.length;
    for (const key of ["Tab", "Escape", "a"]) {
      const event = new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
      });
      viewport.element.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    await wrapper
      .get('[data-cif-action="reset"]')
      .trigger("keydown", { key: "ArrowRight" });
    await viewport.trigger("keydown", { key: "ArrowRight", ctrlKey: true });
    expect(viewers[0].rotate).toHaveBeenCalledTimes(rotateCalls);
  });

  it("disables presentation controls until SES is ready and keeps instances independent", async () => {
    const source = deferred<string>();
    const first = mountWithApp(ScientificCifViewer, {
      props: { resource: resource(() => source.promise) },
    });
    const second = mountWithApp(ScientificCifViewer, {
      props: { resource: resource(async () => "data_second", "second") },
    });
    await flushPromises();
    expect(first.get('[role="switch"]').attributes("disabled")).toBeDefined();
    expect(
      first.get('[data-cif-action="reset"]').attributes("disabled")
    ).toBeDefined();
    await second.get('[role="switch"]').trigger("click");
    expect(viewers[0].setSurfaceMaterialStyle).not.toHaveBeenCalled();
    expect(viewers[1].setSurfaceMaterialStyle).toHaveBeenCalledOnce();
    source.resolve("data_first");
    await flushPromises();
    expect(first.get('[role="switch"]').attributes("aria-checked")).toBe(
      "true"
    );
    expect(second.get('[role="switch"]').attributes("aria-checked")).toBe(
      "false"
    );
  });

  it("keeps source loading and its accessible name localized without restarting the read", async () => {
    const source = deferred<string>();
    const read = vi.fn(() => source.promise);
    const context = createTestAppContext();
    const wrapper = context.mount(ScientificCifViewer, {
      props: { resource: resource(read) },
    });
    await flushPromises();
    expect(wrapper.get('[role="status"]').text()).toBe(
      enUS.scientificCif.loadingSource
    );
    expect(wrapper.get(".scientific-cif-viewer").attributes("aria-label")).toBe(
      enUS.scientificCif.label
    );
    context.i18n.global.locale.value = "zh-CN";
    await flushPromises();
    expect(wrapper.get('[role="status"]').text()).toBe(
      zhCN.scientificCif.loadingSource
    );
    expect(wrapper.get(".scientific-cif-viewer").attributes("aria-label")).toBe(
      zhCN.scientificCif.label
    );
    expect(read).toHaveBeenCalledOnce();
    source.resolve("data_model");
    await flushPromises();
  });

  it("never creates a viewer from a stale import after replacement or unmount", async () => {
    const importing = deferred<typeof mol>();
    mol.load.mockReturnValueOnce(importing.promise);
    const oldRead = vi.fn(async () => "data_old");
    const wrapper = mountWithApp(ScientificCifViewer, {
      props: { resource: resource(oldRead) },
    });
    await flushPromises();
    await wrapper.setProps({ resource: resource(async () => "data_new") });
    await flushPromises();
    expect(viewers).toHaveLength(1);
    importing.resolve(mol);
    await flushPromises();
    expect(oldRead).not.toHaveBeenCalled();
    expect(viewers).toHaveLength(1);
    const lastImport = deferred<typeof mol>();
    mol.load.mockReturnValueOnce(lastImport.promise);
    await wrapper.setProps({ resource: resource(oldRead, "last") });
    await flushPromises();
    wrapper.unmount();
    lastImport.resolve(mol);
    await flushPromises();
    expect(oldRead).not.toHaveBeenCalled();
    expect(viewers).toHaveLength(1);
  });

  it("uses the current dimensions when a surface finishes after an aspect change", async () => {
    const source = deferred<string>();
    const surface = deferred<number>();
    const wrapper = mountWithApp(ScientificCifViewer, {
      props: { resource: resource(() => source.promise) },
    });
    await flushPromises();
    viewers[0].addSurface.mockReturnValueOnce(
      Object.assign(surface.promise, { surfid: 7 })
    );
    source.resolve("data_model");
    await flushPromises();
    dimensions = { width: 250, height: 500 };
    resizeCallback([], {} as ResizeObserver);
    surface.resolve(7);
    await flushPromises();
    expect(viewers[0].zoom).toHaveBeenCalledExactlyOnceWith(4 / 3);
    expect(viewers[0].zoomTo).toHaveBeenCalledOnce();
    expect(wrapper.find('[data-scientific-cif-ready="true"]').exists()).toBe(
      true
    );
  });

  it("rejects non-finite parsed coordinates without starting a surface", async () => {
    const source = deferred<string>();
    const wrapper = mountWithApp(ScientificCifViewer, {
      props: { resource: resource(() => source.promise) },
    });
    await flushPromises();
    viewers[0].selectedAtoms.mockReturnValueOnce([{ x: NaN, y: 0, z: 0 }]);
    source.resolve("data_invalid");
    await flushPromises();
    expect(wrapper.text()).toContain(enUS.scientificCif.error);
    expect(viewers[0].addSurface).not.toHaveBeenCalled();
  });

  it("waits for the current SES surface before marking the A presentation ready", async () => {
    const source = deferred<string>();
    const surface = deferred<number>();
    const wrapper = mountWithApp(ScientificCifViewer, {
      props: { resource: resource(() => source.promise) },
    });
    await flushPromises();
    expect(wrapper.find('[data-scientific-cif-ready="true"]').exists()).toBe(
      false
    );
    viewers[0].addSurface.mockReturnValueOnce(
      Object.assign(surface.promise, { surfid: 7 })
    );
    source.resolve("data_model");
    await flushPromises();
    expect(wrapper.find('[data-scientific-cif-ready="true"]').exists()).toBe(
      false
    );
    expect(wrapper.get('[role="status"]').text()).toBe(
      "Building molecular surface"
    );
    expect(viewers[0].addSurface).toHaveBeenCalledWith(
      "SES",
      { color: "#66bf99", opacity: 0.45 },
      {}
    );
    surface.resolve(7);
    await flushPromises();
    expect(
      wrapper
        .get(".scientific-cif-block .scientific-cif-viewer")
        .attributes("data-scientific-cif-ready")
    ).toBe("true");
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
    expect(viewers[0].animate).not.toHaveBeenCalled();
    expect(mol.createViewer).toHaveBeenCalledWith(expect.any(HTMLElement), {
      backgroundColor: "#fbfcfe",
      antialias: true,
      cartoonQuality: 12,
      disableFog: true,
    });
    expect(viewers[0].setStyle).toHaveBeenCalledExactlyOnceWith(
      {},
      {
        cartoon: {
          color: "#87b4ed",
          style: "oval",
          thickness: 0.24,
          arrows: true,
        },
      }
    );
    expect(viewers[0].setProjection).toHaveBeenCalledWith("orthographic");
    expect(viewers[0].setViewStyle).toHaveBeenCalledWith({
      style: "outline",
      color: "#8dafc1",
      width: 0.018,
      maxpixels: 0.6,
    });
    expect(viewers[0].rotate.mock.calls).toEqual([
      [20, "y"],
      [-18, "x"],
    ]);
  });

  it.each(["resolve", "reject"] as const)(
    "detaches a stale surface and clears it once only after it %ss",
    async (settlement) => {
      const source = deferred<string>();
      const surface = deferred<number>();
      const wrapper = mountWithApp(ScientificCifViewer, {
        props: { resource: resource(() => source.promise) },
      });
      await flushPromises();
      const oldViewer = viewers[0];
      const oldTarget = mol.createViewer.mock.calls[0][0] as HTMLElement;
      oldViewer.addSurface.mockReturnValueOnce(
        Object.assign(surface.promise, { surfid: 7 })
      );
      source.resolve("data_old");
      await flushPromises();
      await wrapper.setProps({ resource: resource(async () => "data_new") });
      await flushPromises();
      expect(wrapper.element.contains(oldTarget)).toBe(false);
      expect(oldViewer.clear).not.toHaveBeenCalled();
      expect(viewers).toHaveLength(2);
      expect(wrapper.find('[data-scientific-cif-ready="true"]').exists()).toBe(
        true
      );
      const currentRenderCount = viewers[1].render.mock.calls.length;
      if (settlement === "resolve") surface.resolve(7);
      else surface.reject(new Error("private late worker error"));
      await flushPromises();
      expect(oldViewer.clear).toHaveBeenCalledOnce();
      expect(oldViewer.removeSurface).not.toHaveBeenCalled();
      expect(viewers[1].render).toHaveBeenCalledTimes(currentRenderCount);
      expect(wrapper.text()).not.toContain("private");
      wrapper.unmount();
      expect(oldViewer.clear).toHaveBeenCalledOnce();
      expect(viewers[1].clear).toHaveBeenCalledOnce();
    }
  );

  it("retains an unmounted worker's registry until its surface settles", async () => {
    const source = deferred<string>();
    const surface = deferred<number>();
    const wrapper = mountWithApp(ScientificCifViewer, {
      props: { resource: resource(() => source.promise) },
    });
    await flushPromises();
    viewers[0].addSurface.mockReturnValueOnce(
      Object.assign(surface.promise, { surfid: 7 })
    );
    source.resolve("data_model");
    await flushPromises();
    wrapper.unmount();
    expect(viewers[0].clear).not.toHaveBeenCalled();
    surface.resolve(7);
    await flushPromises();
    expect(viewers[0].clear).toHaveBeenCalledOnce();
    expect(viewers[0].removeSurface).not.toHaveBeenCalled();
  });

  it.each(["import", "read", "surface"] as const)(
    "only retries a failed %s on explicit action",
    async (failure) => {
      const source = deferred<string>();
      const read = vi.fn(() => source.promise);
      if (failure === "import")
        mol.load.mockRejectedValueOnce(new Error("private import"));
      const wrapper = mountWithApp(ScientificCifViewer, {
        props: { resource: resource(read) },
      });
      await flushPromises();
      if (failure === "surface")
        viewers[0].addSurface.mockImplementationOnce(() =>
          Object.assign(Promise.reject(new Error("private surface")), {
            surfid: 7,
          })
        );
      if (failure === "read") source.reject(new Error("private read"));
      else source.resolve("data_model");
      await flushPromises();
      expect(wrapper.text()).toContain("Structure unavailable");
      expect(wrapper.text()).not.toContain("private");
      expect(wrapper.find('[data-scientific-cif-ready="true"]').exists()).toBe(
        false
      );
      const calls = mol.load.mock.calls.length;
      await flushPromises();
      expect(mol.load).toHaveBeenCalledTimes(calls);
      read.mockResolvedValue("data_retry");
      await wrapper.get(".phy-error-state__retry").trigger("click");
      await flushPromises();
      expect(wrapper.find('[data-scientific-cif-ready="true"]').exists()).toBe(
        true
      );
    }
  );

  it("rejects a parsed model with no atoms instead of showing an empty ready canvas", async () => {
    const source = deferred<string>();
    const wrapper = mountWithApp(ScientificCifViewer, {
      props: { resource: resource(() => source.promise) },
    });
    await flushPromises();
    viewers[0].selectedAtoms.mockReturnValueOnce([]);
    source.resolve("data_empty");
    await flushPromises();
    expect(wrapper.text()).toContain("Structure unavailable");
    expect(viewers[0].addSurface).not.toHaveBeenCalled();
    expect(viewers[0].clear).toHaveBeenCalledOnce();
    expect(wrapper.find('[data-scientific-cif-ready="true"]').exists()).toBe(
      false
    );
  });

  it("fits a fresh narrow container from projected geometry without legacy perspective compensation", async () => {
    dimensions = { width: 252, height: 384 };
    mountWithApp(ScientificCifViewer, {
      props: { resource: resource(async () => "data_model") },
    });
    await flushPromises();
    expect(viewers[0].zoomTo).toHaveBeenCalledOnce();
    expect(viewers[0].modelToScreen).toHaveBeenCalledOnce();
    expect(viewers[0].zoom).not.toHaveBeenCalled();
    expect(
      vi.mocked(viewers[0].zoomTo).mock.invocationCallOrder[0]
    ).toBeLessThan(
      vi.mocked(viewers[0].modelToScreen).mock.invocationCallOrder[0]
    );
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
    expect(vi.mocked(viewer.zoom).mock.calls).toEqual([[2], [4 / 3]]);
    dimensions = { width: 200, height: 400 };
    resizeCallback([], {} as ResizeObserver);
    expect(viewer.zoom).toHaveBeenCalledTimes(2);
    dimensions = { width: 0, height: 0 };
    const resizeCalls = vi.mocked(viewer.resize).mock.calls.length;
    resizeCallback([], {} as ResizeObserver);
    expect(viewer.resize).toHaveBeenCalledTimes(resizeCalls);
    dimensions = { width: 800, height: 600 };
    resizeCallback([], {} as ResizeObserver);
    expect(vi.mocked(viewer.zoom).mock.calls).toEqual([[2], [4 / 3], [0.75]]);
    expect(viewer.modelToScreen).toHaveBeenCalledOnce();
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
      expect(viewer.modelToScreen).toHaveBeenCalledOnce();
      expect(viewer.zoom).not.toHaveBeenCalled();
    });
  });
  it("performs skipped initial fitting on first visibility, then preserves the user's view", async () => {
    dimensions = { width: 0, height: 0 };
    const wrapper = mountWithApp(ScientificCifViewer, {
      props: { resource: resource(async () => "data_model") },
    });
    await flushPromises();
    expect(viewers[0].modelToScreen).not.toHaveBeenCalled();
    dimensions = { width: 800, height: 600 };
    resizeCallback([], {} as ResizeObserver);
    expect(viewers[0].modelToScreen).toHaveBeenCalledOnce();
    viewers[0].zoom(2);
    dimensions = { width: 0, height: 0 };
    resizeCallback([], {} as ResizeObserver);
    dimensions = { width: 300, height: 600 };
    resizeCallback([], {} as ResizeObserver);
    expect(viewers[0].zoom.mock.calls).toEqual([[2], [4 / 3]]);
    expect(viewers[0].modelToScreen).toHaveBeenCalledOnce();
    expect(viewers[0].zoomTo).toHaveBeenCalledOnce();
    expect(wrapper.find('[data-scientific-cif-ready="true"]').exists()).toBe(
      true
    );
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
    expect(wrapper.text()).toContain("Structure unavailable");
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
    expect(wrapper.text()).toContain("Resource unavailable");
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
    expect(wrapper.text()).toContain("Structure unavailable");
    expect(
      viewers.flatMap((viewer) => vi.mocked(viewer.addModel).mock.calls)
    ).toEqual([]);
  });
});
