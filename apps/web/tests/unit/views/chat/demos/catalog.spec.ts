import { describe, expect, it } from "vitest";
import {
  AGENT_CASE_DEMO_KEYS,
  demoDialogueId,
  fixtureForDemoKey,
  isAgentCaseDemoKey,
  isDemoDialogueId,
} from "@/views/chat/demos/catalog";

describe("agent case demo catalog", () => {
  it("accepts the eight spec keys and mints demo: dialogue ids", () => {
    expect([...AGENT_CASE_DEMO_KEYS]).toEqual([
      "knowledge",
      "data",
      "analyst",
      "review",
      "network",
      "brief-gene",
      "deep-genome",
      "design",
    ]);
    expect(isAgentCaseDemoKey("knowledge")).toBe(true);
    expect(isAgentCaseDemoKey("research")).toBe(false);
    expect(demoDialogueId("knowledge")).toBe("demo:knowledge");
    expect(isDemoDialogueId("demo:knowledge")).toBe(true);
    expect(isDemoDialogueId("new_1")).toBe(false);
  });

  it("returns an empty Analyst fixture with the empty i18n keys", () => {
    const fixture = fixtureForDemoKey("analyst");
    expect(fixture?.tool).toBe("AnalystAgent");
    expect(fixture?.messages).toEqual([]);
    expect(fixture?.empty).toEqual({
      titleKey: "chat.cases.demoEmpty.title",
      bodyKey: "chat.cases.demoEmpty.body",
    });
  });

  it("does not invent fixtures for keys not yet frozen", () => {
    expect(fixtureForDemoKey("knowledge")).toBeNull();
  });
});
