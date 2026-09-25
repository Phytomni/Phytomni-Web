import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { defineComponent, h, ref, shallowRef } from "vue";
import { ElDialog } from "element-plus";
import { readFileSync } from "node:fs";
import ScientificCifViewer from "@/components/scientific/ScientificCifViewer.vue";
import PhyAdaptiveShell from "@/components/shell/PhyAdaptiveShell.vue";
import enUS from "@/locales/langs/en-US";
import { mountWithApp } from "../helpers/test-app-context";

const mol = vi.hoisted(() => ({ createViewer: vi.fn() }));
vi.mock("@/utils/3dmol", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/3dmol")>()),
  load3DMol: async () => mol,
}));

function createViewer(target: HTMLElement) {
  const canvas = document.createElement("canvas");
  canvas.width = 800;
  canvas.height = 600;
  target.append(canvas);
  let view = [0, 0, 0, -20, 0.1, 0.2, 0.3, 0.9];
  return {
    canvas,
    addModel: vi.fn(),
    selectedAtoms: vi.fn(() => [{ x: 0, y: 0, z: 0 }]),
    modelToScreen: vi.fn((atoms: { x: number; y: number; z: number }[]) =>
      atoms.map((atom) => ({ x: 400 + atom.x * 10, y: 300 + atom.y * 10 }))
    ),
    addSurface: vi.fn(() => Object.assign(Promise.resolve(7), { surfid: 7 })),
    setSurfaceMaterialStyle: vi.fn(),
    setStyle: vi.fn(),
    setProjection: vi.fn(),
    setViewStyle: vi.fn(),
    getView: vi.fn(() => [...view]),
    setView: vi.fn((next: number[]) => {
      view = [...next];
    }),
    translateScene: vi.fn(),
    rotate: vi.fn(),
    zoomTo: vi.fn(),
    zoom: vi.fn(),
    resize: vi.fn(),
    render: vi.fn(),
    animate: vi.fn(),
    stopAnimate: vi.fn(),
    clear: vi.fn(),
  };
}

const resource = (read: (signal: AbortSignal) => Promise<string>) => ({
  id: "structure",
  name: "Protein structure",
  kind: "cif" as const,
  markdownHref: "./model.cif",
  renderSource: { kind: "cif-text" as const, read },
});

let viewers: ReturnType<typeof createViewer>[];
let cleanupFixture: (() => void) | undefined;
let tokens: HTMLStyleElement;

beforeEach(() => {
  viewers = [];
  tokens = document.createElement("style");
  tokens.textContent = readFileSync("src/styles/tokens.css", "utf8");
  document.head.append(tokens);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(600);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = vi.fn();
      disconnect = vi.fn();
    }
  );
  mol.createViewer.mockImplementation((target: HTMLElement) => {
    const viewer = createViewer(target);
    viewers.push(viewer);
    return viewer;
  });
});

afterEach(async () => {
  cleanupFixture?.();
  cleanupFixture = undefined;
  await flushPromises();
  tokens.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function mountReport() {
  const read = vi.fn(async () => "data_original");
  const currentResource = shallowRef(resource(read));
  const artifactOpen = ref(true);
  const closeArtifact = vi.fn(() => {
    artifactOpen.value = false;
  });
  const root = document.createElement("div");
  document.body.append(root);
  const fixture = defineComponent({
    setup: () => () =>
      h(
        PhyAdaptiveShell,
        {
          artifactOpen: artifactOpen.value,
          artifactFullscreen: artifactOpen.value,
        },
        {
          main: () => h("button", "Conversation control"),
          artifact: () =>
            h("article", { "data-test": "report" }, [
              h("h1", { id: "research-artifact-title" }, "Gene report"),
              h(
                "button",
                { "data-test": "artifact-close", onClick: closeArtifact },
                "Close report"
              ),
              h(
                "div",
                {
                  class: "research-artifact-shell__body",
                  style: "height: 480px; overflow: auto",
                },
                [h(ScientificCifViewer, { resource: currentResource.value })]
              ),
              h("button", { "data-test": "report-last" }, "Report action"),
            ]),
        }
      ),
  });
  // Keep the actual Element Plus dialog, focus trap, and Vue Teleport/Transition.
  const wrapper = mountWithApp(fixture, {
    attachTo: root,
    global: { stubs: { transition: false, teleport: false } },
  });
  cleanupFixture = () => {
    wrapper.unmount();
    root.remove();
  };
  await flushPromises();
  expect(wrapper.get(".scientific-cif-viewer").attributes()).toHaveProperty(
    "data-scientific-cif-ready",
    "true"
  );
  const report = wrapper.get('[data-test="report"]').element;
  const scroll = wrapper.get(".research-artifact-shell__body")
    .element as HTMLElement;
  Object.defineProperties(scroll, {
    scrollHeight: { configurable: true, value: 1800 },
    clientHeight: { configurable: true, value: 480 },
  });
  scroll.scrollTop = 417;
  return { wrapper, read, report, scroll, closeArtifact, currentResource };
}

function isShown(element: Element): boolean {
  return !Array.from(ancestors(element)).some(
    (ancestor) =>
      ancestor.hasAttribute("hidden") ||
      getComputedStyle(ancestor).display === "none" ||
      getComputedStyle(ancestor).visibility === "hidden"
  );
}

function* ancestors(element: Element): Generator<Element> {
  for (
    let current: Element | null = element;
    current;
    current = current.parentElement
  )
    yield current;
}

type Report = Awaited<ReturnType<typeof mountReport>>;

async function enlarge(report: Report) {
  const opener = report.wrapper.get('[data-cif-action="enlarge"]');
  expect(opener.text()).toBe("Enlarge");
  (opener.element as HTMLElement).focus();
  await opener.trigger("mousedown");
  await opener.trigger("mouseup");
  await opener.trigger("click");
  await vi.waitFor(() => {
    const dialog = report.wrapper.get(".scientific-cif-dialog");
    expect(isShown(dialog.element)).toBe(true);
    expect(dialog.element.contains(document.activeElement)).toBe(true);
    expect(dialog.find("canvas").exists()).toBe(true);
  });
  const dialog = report.wrapper.get(".scientific-cif-dialog");
  const realDialog = report.wrapper.getComponent(ElDialog);
  expect(realDialog.props("appendToBody")).toBe(false);
  expect(realDialog.props("destroyOnClose")).toBe(false);
  const modal = dialog.element.closest('[role="dialog"]');
  expect(modal?.getAttribute("aria-label")).toBe(enUS.scientificCif.label);
  expect(report.report.contains(modal)).toBe(true);
  expect(report.report.contains(dialog.element)).toBe(true);
  return { opener, dialog };
}

async function press(target: Element, key: string, shiftKey = false) {
  const event = new KeyboardEvent("keydown", {
    key,
    code: key,
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  await flushPromises();
  return event;
}

describe("ScientificCifViewer real nested Element Plus dialog", () => {
  it("moves the same canvas through repeated modal cycles without reloading or resetting its camera", async () => {
    const report = await mountReport();
    const viewer = viewers[0];
    const canvas = viewer.canvas;
    const fittedCalls = viewer.zoomTo.mock.calls.length;
    const manualView = [2, 3, 4, -35, 0.3, 0.4, 0.2, 0.8];
    viewer.setView(manualView);
    for (let cycle = 0; cycle < 3; cycle++) {
      const { opener, dialog } = await enlarge(report);
      expect(dialog.get("canvas").element).toBe(canvas);
      expect(report.report.contains(canvas)).toBe(true);
      expect(report.wrapper.findAll("canvas")).toHaveLength(1);
      // Emulate the scroll displacement caused by focus/layout changes while
      // enlarged, so this checks restoration rather than an untouched value.
      report.scroll.scrollTop = 53;
      await dialog.get('[data-cif-action="close"]').trigger("click");
      await vi.waitFor(() => {
        expect(isShown(dialog.element)).toBe(false);
        expect(document.activeElement).toBe(opener.element);
      });
      expect(report.wrapper.get("canvas").element).toBe(canvas);
      expect(report.report.contains(canvas)).toBe(true);
      expect(dialog.element.contains(canvas)).toBe(false);
      expect(report.scroll.scrollTop).toBe(417);
      expect(viewer.getView()).toEqual(manualView);
    }
    expect(report.read).toHaveBeenCalledOnce();
    expect(mol.createViewer).toHaveBeenCalledOnce();
    expect(viewer.addModel).toHaveBeenCalledOnce();
    expect(viewer.addSurface).toHaveBeenCalledOnce();
    expect(viewer.zoomTo).toHaveBeenCalledTimes(fittedCalls);
    expect(viewer.clear).not.toHaveBeenCalled();
  });

  it("closes only the structure on the first Escape and the fullscreen parent on the next Escape", async () => {
    const report = await mountReport();
    const { opener, dialog } = await enlarge(report);
    await press(dialog.get('[data-cif-action="close"]').element, "Escape");
    await vi.waitFor(() => {
      expect(isShown(dialog.element)).toBe(false);
      expect(document.activeElement).toBe(opener.element);
    });
    expect(report.closeArtifact).not.toHaveBeenCalled();
    expect(report.report.isConnected).toBe(true);
    await press(opener.element, "Escape");
    expect(report.closeArtifact).toHaveBeenCalledOnce();
    expect(report.wrapper.find('[data-test="report"]').exists()).toBe(false);
  });

  it("keeps Tab and Shift+Tab inside the real child modal after pointer input", async () => {
    const report = await mountReport();
    const { dialog } = await enlarge(report);
    const focusable = Array.from(
      dialog.element.querySelectorAll<HTMLElement>("button, [tabindex]")
    ).filter(
      (element) =>
        element.tabIndex >= 0 &&
        !element.hasAttribute("disabled") &&
        isShown(element)
    );
    expect(focusable.length).toBeGreaterThanOrEqual(2);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    for (let cycle = 0; cycle < 2; cycle++) {
      last.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      last.focus();
      expect((await press(last, "Tab")).defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(first);
      first.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      first.focus();
      expect((await press(first, "Tab", true)).defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(last);
    }
    expect(report.closeArtifact).not.toHaveBeenCalled();
    expect(dialog.element.contains(document.activeElement)).toBe(true);
  });

  it("lets ordinary Tab reach the document without the parent shell consuming it", async () => {
    const report = await mountReport();
    const { dialog } = await enlarge(report);
    const delivered: KeyboardEvent[] = [];
    const observe = (event: KeyboardEvent) => delivered.push(event);
    document.addEventListener("keydown", observe);
    try {
      const reset = dialog.get('[data-cif-action="reset"]').element;
      (reset as HTMLElement).focus();
      const event = await press(reset, "Tab");
      expect(event.defaultPrevented).toBe(false);
      expect(delivered).toEqual([event]);
      expect(report.closeArtifact).not.toHaveBeenCalled();
      expect(dialog.element.contains(document.activeElement)).toBe(true);
    } finally {
      document.removeEventListener("keydown", observe);
    }
  });

  it("contains Shift+Tab from the initial focus without a manual focus correction", async () => {
    const report = await mountReport();
    const { dialog } = await enlarge(report);
    const initialFocus = document.activeElement;
    expect(initialFocus).toBeInstanceOf(HTMLElement);
    if (!(initialFocus instanceof HTMLElement))
      throw new Error("Dialog must own a focused HTML element");
    expect(dialog.element.contains(initialFocus)).toBe(true);
    // The public modal autofocus must start on a tabbable control, not its
    // tabindex=-1 container: native browser Shift+Tab can otherwise escape.
    expect(initialFocus).toBe(dialog.get('[data-cif-action="close"]').element);
    const event = await press(initialFocus, "Tab", true);
    expect(event.defaultPrevented).toBe(true);
    expect(dialog.element.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(
      dialog.get(".scientific-cif-viewer").element
    );
    expect(report.closeArtifact).not.toHaveBeenCalled();
  });

  it("closes an enlarged view on resource replacement and keeps only the new inline canvas", async () => {
    const report = await mountReport();
    const old = viewers[0];
    const { dialog } = await enlarge(report);
    const readReplacement = vi.fn(async () => "data_replacement");
    report.currentResource.value = resource(readReplacement);
    await vi.waitFor(() => {
      expect(isShown(dialog.element)).toBe(false);
      expect(viewers).toHaveLength(2);
      expect(
        report.wrapper.get(".scientific-cif-viewer").attributes()
      ).toHaveProperty("data-scientific-cif-ready", "true");
    });
    expect(old.canvas.isConnected).toBe(false);
    expect(old.clear).toHaveBeenCalledOnce();
    expect(report.wrapper.get("canvas").element).toBe(viewers[1].canvas);
    expect(report.report.contains(viewers[1].canvas)).toBe(true);
    expect(dialog.element.contains(viewers[1].canvas)).toBe(false);
    expect(viewers[1].addModel).toHaveBeenCalledWith("data_replacement", "cif");
    expect(viewers[1].addSurface).toHaveBeenCalledOnce();
    expect(report.closeArtifact).not.toHaveBeenCalled();
  });
});
