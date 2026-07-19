import { describe, it, expect, vi } from "vitest";
import {
  STARTER_PROMPTS,
  applyStarterPrompt,
} from "@/views/chat/utils/starterPrompts";

describe("starterPrompts", () => {
  it("defines starter cards with parallel label/desc/prompt i18n keys", () => {
    expect(STARTER_PROMPTS.length).toBeGreaterThanOrEqual(2);
    for (const p of STARTER_PROMPTS) {
      expect(p.labelKey).toMatch(/^chat\.starter\./);
      expect(p.descKey).toMatch(/^chat\.starter\./);
      expect(p.promptKey).toMatch(/^chat\.starter\./);
    }
  });

  it("fills the composer with the resolved prompt text", () => {
    const setInput = vi.fn();
    const t = (k: string) =>
      k === "chat.starter.genePrompt" ? "RESOLVED TEXT" : k;
    applyStarterPrompt({ promptKey: "chat.starter.genePrompt" }, t, setInput);
    expect(setInput).toHaveBeenCalledTimes(1);
    expect(setInput).toHaveBeenCalledWith("RESOLVED TEXT");
  });
});
