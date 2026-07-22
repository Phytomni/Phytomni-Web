import { describe, expect, it, vi } from "vitest";

const { createViewer } = vi.hoisted(() => ({
  createViewer: vi.fn(),
}));

vi.mock("3dmol", () => ({ createViewer }));

import { load3DMol } from "@/utils/3dmol";

describe("3dmol loader", () => {
  it("loads the npm module once and shares the cached promise", async () => {
    const first = await load3DMol();
    const second = await load3DMol();

    expect(first).toBe(second);
    expect(first.createViewer).toBe(createViewer);
  });
});
