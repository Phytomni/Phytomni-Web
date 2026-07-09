import { describe, it, expect } from "vitest";
import { resolveBlockRenderer } from "@/views/chat/streaming/blockRegistry";

describe("resolveBlockRenderer", () => {
  it("resolves the four implemented block types", () => {
    for (const t of ["markdown", "tool", "step", "reasoning"]) {
      expect(resolveBlockRenderer(t)).not.toBeNull();
    }
  });
  it("resolves agent-surface", () => {
    expect(resolveBlockRenderer("agent-surface")).not.toBeNull();
  });
  it("returns null for an unregistered (future) block type", () => {
    expect(resolveBlockRenderer("mol3d")).toBeNull();
  });
});
