import { describe, it, expect } from "vitest";
import { clampPanOffset } from "@/utils/image-viewer";

// Locks the AF-005 robustness fix for the Agents-diagram image viewer:
// no NaN/Infinity from an unloaded image, no panning an un-zoomed image,
// and no dragging the image past the container centre.
describe("clampPanOffset — image viewer pan bounds", () => {
  it("pins the offset to 0 when not zoomed (scale <= 1)", () => {
    expect(clampPanOffset(50, 800, 1)).toBe(0);
    expect(clampPanOffset(-50, 800, 0.5)).toBe(0);
  });

  it("returns 0 for a not-yet-loaded image (naturalDim 0)", () => {
    expect(clampPanOffset(50, 0, 2)).toBe(0);
  });

  it("swallows non-finite offsets (the division-by-zero NaN/Infinity case)", () => {
    expect(clampPanOffset(Number.NaN, 800, 2)).toBe(0);
    expect(clampPanOffset(Number.POSITIVE_INFINITY, 800, 2)).toBe(0);
    expect(clampPanOffset(Number.NEGATIVE_INFINITY, 800, 2)).toBe(0);
  });

  it("leaves an in-bounds offset unchanged", () => {
    // max = 800 * (2 - 1) / (2 * 2) = 200
    expect(clampPanOffset(100, 800, 2)).toBe(100);
    expect(clampPanOffset(-100, 800, 2)).toBe(-100);
  });

  it("clamps an out-of-bounds offset to the symmetric maximum", () => {
    expect(clampPanOffset(500, 800, 2)).toBe(200);
    expect(clampPanOffset(-500, 800, 2)).toBe(-200);
  });

  it("keeps an offset exactly at the boundary", () => {
    expect(clampPanOffset(200, 800, 2)).toBe(200);
  });

  it("scales the bound with zoom level", () => {
    // max = 600 * (4 - 1) / (2 * 4) = 225
    expect(clampPanOffset(1000, 600, 4)).toBe(225);
  });
});
