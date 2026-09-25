import { describe, expect, it, vi } from "vitest";

const { createViewer } = vi.hoisted(() => ({
  createViewer: vi.fn(),
}));

vi.mock("3dmol", () => ({ createViewer }));

import { fit3DMolStructure, load3DMol } from "@/utils/3dmol";

describe("3dmol projected structure fitting", () => {
  it.each([
    [252, 384],
    [800, 600],
    [1412, 466],
    [2500, 400],
  ])(
    "fits the current orthographic projection at %ix%i with surface padding",
    (width, height) => {
      const target = document.createElement("div");
      const canvas = document.createElement("canvas");
      target.append(canvas);
      Object.defineProperties(target, {
        offsetWidth: { value: width },
        offsetHeight: { value: height },
      });
      canvas.getBoundingClientRect = () => new DOMRect(17, 23, width, height);
      const atoms = [
        { x: -20, y: -30, z: 0 },
        { x: 20, y: 30, z: 0 },
      ];
      const pixelsPerUnit = width / 100;
      const modelToScreen = vi.fn(
        (coords: Array<{ x: number; y: number; z: number }>) =>
          coords.map(({ x, y }) => ({
            x: 17 + width / 2 + x * pixelsPerUnit,
            y: 23 + height / 2 + y * pixelsPerUnit,
          }))
      );
      const zoom = vi.fn();
      const viewer = { selectedAtoms: () => atoms, modelToScreen, zoom };
      expect(fit3DMolStructure(viewer, target)).toBe(true);
      const expected = Math.min(
        (width * 0.44) / (24 * pixelsPerUnit),
        (height * 0.44) / (34 * pixelsPerUnit)
      );
      expect(zoom).toHaveBeenCalledOnce();
      expect(zoom.mock.calls[0][0]).toBeCloseTo(expected, 12);
      expect(atoms).toEqual([
        { x: -20, y: -30, z: 0 },
        { x: 20, y: 30, z: 0 },
      ]);
      expect(24 * pixelsPerUnit * expected).toBeLessThanOrEqual(
        width * 0.44 + 1e-6
      );
      expect(34 * pixelsPerUnit * expected).toBeLessThanOrEqual(
        height * 0.44 + 1e-6
      );
    }
  );

  it("does not zoom a hidden container or overzoom a one-atom structure", () => {
    const target = document.createElement("div");
    const canvas = document.createElement("canvas");
    target.append(canvas);
    let width = 0;
    Object.defineProperties(target, {
      offsetWidth: { get: () => width },
      offsetHeight: { value: 400 },
    });
    const viewer = {
      selectedAtoms: () => [{ x: 0, y: 0, z: 0 }],
      modelToScreen: vi.fn(
        (coords: Array<{ x: number; y: number; z: number }>) =>
          coords.map(({ x, y }) => ({ x: 400 + x * 10, y: 200 + y * 10 }))
      ),
      zoom: vi.fn(),
    };
    expect(fit3DMolStructure(viewer, target)).toBe(false);
    expect(viewer.modelToScreen).not.toHaveBeenCalled();
    width = 800;
    expect(fit3DMolStructure(viewer, target)).toBe(true);
    expect(viewer.zoom).toHaveBeenCalledWith(4.4);
  });
});

describe("3dmol loader", () => {
  it("loads the npm module once and shares the cached promise", async () => {
    const first = await load3DMol();
    const second = await load3DMol();

    expect(first).toBe(second);
    expect(first.createViewer).toBe(createViewer);
  });

  it("retries an invalid module export only on the next explicit load", async () => {
    vi.resetModules();
    const invalidModule = vi.fn(() => ({ default: {} }));
    vi.doMock("3dmol", invalidModule);
    const { load3DMol: retryLoad } = await import("@/utils/3dmol");
    await expect(retryLoad()).rejects.toThrow("does not expose createViewer");
    expect(invalidModule).toHaveBeenCalledOnce();
    vi.doMock("3dmol", () => ({ default: { createViewer } }));
    await expect(retryLoad()).resolves.toEqual({ createViewer });
    vi.doUnmock("3dmol");
  });

  it("releases a failed import promise for an explicit retry", async () => {
    vi.resetModules();
    vi.doMock("3dmol", () => {
      throw new Error("Import unavailable");
    });
    const { load3DMol: retryLoad } = await import("@/utils/3dmol");
    await expect(retryLoad()).rejects.toThrow();
    vi.doMock("3dmol", () => ({ createViewer }));
    await expect(retryLoad()).resolves.toEqual({ createViewer });
    vi.doUnmock("3dmol");
  });
});
