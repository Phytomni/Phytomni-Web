// Zoom/pan helpers for the image viewer (the Agents architecture-diagram popup).
//
// Extracted into pure functions for unit testing, and to centralize the robustness
// fallbacks in one place:
//   - while the image is still loading naturalWidth/Height is 0, so the zoom math
//     divides by zero → NaN/Infinity; clampPanOffset zeroes out non-finite inputs
//     and dim===0, swallowing such dirty values along the way;
//   - at scale<=1 (not zoomed) the pan is locked to 0; when zoomed, the pan is
//     constrained so the image center cannot cross the container center, preventing
//     the image from being dragged out of the visible area.

/**
 * Clamp the single-axis pan offset (origin at the image center, under `scale`) to a
 * reasonable range.
 *
 * @param offset the desired pan offset (image coordinate system, units before scale).
 * @param naturalDim the image's natural size on that axis (naturalWidth / naturalHeight).
 * @param scale the current zoom factor.
 * @returns the clamped pan offset; 0 for non-finite input / not loaded / not zoomed.
 */
export function clampPanOffset(
  offset: number,
  naturalDim: number,
  scale: number
): number {
  if (!Number.isFinite(offset) || !naturalDim || scale <= 1) return 0;
  const max = (naturalDim * (scale - 1)) / (2 * scale);
  return Math.min(max, Math.max(-max, offset));
}
