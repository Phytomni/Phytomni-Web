import { describe, expect, it } from "vitest";
import { hasReadyCifViewers } from "../../visual/research/cif-readiness";

function report(states: string[]): HTMLElement {
  const root = document.createElement("div");
  for (const state of states) {
    const block = document.createElement("div");
    block.className = "scientific-cif-block";
    const viewer = document.createElement("div");
    viewer.className = "scientific-cif-viewer";
    viewer.dataset.scientificCifReady = state;
    viewer.append(document.createElement("canvas"));
    block.append(viewer);
    root.append(block);
  }
  return root;
}

describe("CIF visual readiness", () => {
  it("waits for every expected structure, not just the first ready one", () => {
    expect(hasReadyCifViewers(report(["true", "pending"]), 2)).toBe(false);
    expect(hasReadyCifViewers(report(["true"]), 2)).toBe(false);
    expect(hasReadyCifViewers(report(["true", "true"]), 2)).toBe(true);
  });

  it("rejects absent, failed, zero-size or ambiguous viewers", () => {
    expect(hasReadyCifViewers(report([]), 1)).toBe(false);
    expect(hasReadyCifViewers(report(["error"]), 1)).toBe(false);
    const root = report(["true"]);
    const canvas = root.querySelector("canvas");
    const viewer = root.querySelector(".scientific-cif-viewer");
    if (!canvas || !viewer) throw new Error("Missing test viewer");
    canvas.width = 0;
    expect(hasReadyCifViewers(root, 1)).toBe(false);
    canvas.width = 300;
    viewer.append(document.createElement("canvas"));
    expect(hasReadyCifViewers(root, 1)).toBe(false);
  });
});
