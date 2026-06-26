import { describe, it, expect } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { userStore } from "@/stores";
import {
  CANONICAL_AGENT_TOOLS,
  CANONICAL_AT_ABLE_TOOLS,
} from "@/constants/agents";

describe("user store default roles", () => {
  it("fallback roles equal the canonical @-able set (no legacy/ghost names)", () => {
    setActivePinia(createPinia());
    const roles = userStore().roles;
    expect([...roles].sort()).toEqual([...CANONICAL_AT_ABLE_TOOLS].sort());
    for (const r of roles) {
      expect(CANONICAL_AGENT_TOOLS).toContain(r);
    }
  });
});
