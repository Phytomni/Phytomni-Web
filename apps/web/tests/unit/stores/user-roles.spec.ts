import { describe, it, expect } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { userStore } from "@/stores";
import { CANONICAL_AGENT_TOOLS, derivePickerOptions } from "@/constants/agents";

describe("user store agent roles", () => {
  it("starts with no granted agents before the server response", () => {
    setActivePinia(createPinia());
    expect(userStore().roles).toEqual([]);
  });

  it("derives all granted canonical agents in canonical order", () => {
    const all = derivePickerOptions([...CANONICAL_AGENT_TOOLS]);
    expect(all.map((option) => option.tool)).toEqual([
      ...CANONICAL_AGENT_TOOLS,
    ]);

    const unordered = derivePickerOptions([
      "DeepGenomeAgent",
      "unknown-permission",
      "ChatAgent",
      "AnalystAgent",
    ]);
    expect(unordered.map((option) => option.tool)).toEqual([
      "ChatAgent",
      "AnalystAgent",
      "DeepGenomeAgent",
    ]);
    expect(derivePickerOptions([])).toEqual([]);
  });
});
