import { expect } from "vitest";

export const RESPONSIVE_VIEWPORTS = [
  { width: 320, height: 568, kind: "compact-phone" },
  { width: 390, height: 844, kind: "modern-phone" },
  { width: 480, height: 800, kind: "large-phone-small-tablet" },
  { width: 768, height: 1024, kind: "tablet" },
  { width: 899, height: 768, kind: "mobile-boundary" },
  { width: 900, height: 768, kind: "compact-boundary" },
  { width: 1024, height: 768, kind: "small-desktop" },
  { width: 1199, height: 768, kind: "compact-upper-boundary" },
  { width: 1279, height: 768, kind: "compact-upper-boundary" },
  { width: 1280, height: 768, kind: "expanded-boundary" },
  { width: 1366, height: 768, kind: "laptop" },
  { width: 1920, height: 1080, kind: "desktop" },
  { width: 2560, height: 1440, kind: "4k-150-percent-css" },
] as const;

export const SEMANTIC_BOUNDARIES = {
  small: 600,
  medium: 900,
  large: 1280,
} as const;

export function setViewport(width: number, height: number): void {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    writable: true,
    value: height,
  });
  window.dispatchEvent(new Event("resize"));
}

export function expectBoundedRect(
  element: Element,
  width: number,
  height: number
): void {
  const rect = element.getBoundingClientRect();
  expect(rect.width).toBeGreaterThan(0);
  expect(rect.height).toBeGreaterThan(0);
  expect(rect.left).toBeGreaterThanOrEqual(0);
  expect(rect.top).toBeGreaterThanOrEqual(0);
  expect(rect.right).toBeLessThanOrEqual(width);
  expect(rect.bottom).toBeLessThanOrEqual(height);
}
