import { describe, it, expect } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { userStore } from "@/stores";
import {
  CANONICAL_AGENT_DISPLAY_ORDER,
  CANONICAL_AGENT_TOOLS,
  derivePickerOptions,
} from "@/constants/agents";

describe("user store agent roles", () => {
  it("starts with no granted agents before the server response", () => {
    setActivePinia(createPinia());
    expect(userStore().roles).toEqual([]);
  });

  it("derives all granted agents in the fixed product display order", () => {
    const all = derivePickerOptions([...CANONICAL_AGENT_TOOLS]);
    expect(all.map((option) => option.tool)).toEqual([
      ...CANONICAL_AGENT_DISPLAY_ORDER,
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
