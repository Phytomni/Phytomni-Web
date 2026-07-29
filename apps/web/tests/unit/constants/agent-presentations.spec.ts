import { describe, expect, it } from "vitest";
import { CANONICAL_AGENT_DISPLAY_ORDER } from "@/constants/agents";
import { CANONICAL_AGENT_PRESENTATIONS } from "@/components/agent";

describe("canonical agent presentations", () => {
  it("keeps one complete optional workflow object per supported presentation", () => {
    expect(Object.keys(CANONICAL_AGENT_PRESENTATIONS)).toEqual([
      ...CANONICAL_AGENT_DISPLAY_ORDER,
    ]);
    for (const tool of CANONICAL_AGENT_DISPLAY_ORDER) {
      const item = CANONICAL_AGENT_PRESENTATIONS[tool];
      expect(item.descriptionKey).toMatch(/^chat\.agents\./);
      if (tool === "BriefGeneAgent") {
        expect(item.workflow).toBeUndefined();
        continue;
      }

      expect(item.workflow).toEqual({
        src: expect.stringContaining(`${tool}.png`),
        altKey: expect.stringMatching(/^chat\.agentPresentation\./),
      });
    }
  });
});
