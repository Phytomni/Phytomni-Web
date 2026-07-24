import { describe, expect, it } from "vitest";
import { CANONICAL_AGENT_DISPLAY_ORDER } from "@/constants/agents";
import { CANONICAL_AGENT_PRESENTATIONS } from "@/components/agent";

describe("canonical agent presentations", () => {
  it("contains one full-flowchart presentation for all ten tools", () => {
    expect(Object.keys(CANONICAL_AGENT_PRESENTATIONS)).toEqual([
      ...CANONICAL_AGENT_DISPLAY_ORDER,
    ]);
    for (const tool of CANONICAL_AGENT_DISPLAY_ORDER) {
      const item = CANONICAL_AGENT_PRESENTATIONS[tool];
      expect(item.descriptionKey).toMatch(/^chat\.agents\./);
      expect(item.flowchartSrc).toContain(`${tool}.png`);
      expect(item.flowchartAltKey).toMatch(/^chat\.agentPresentation\./);
    }
  });
});
