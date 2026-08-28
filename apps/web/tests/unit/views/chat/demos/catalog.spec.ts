import { describe, expect, it } from "vitest";
import {
  AGENT_CASE_DEMO_KEYS,
  demoDialogueId,
  fixtureForDemoKey,
  isAgentCaseDemoKey,
  isDemoDialogueId,
} from "@/views/chat/demos/catalog";
import { KNOWLEDGE_CASE } from "@/views/knowledge-agent/knowledge-case";
import { REVIEW_CASE } from "@/views/review-agent/review-case";

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

  it("freezes Knowledge as one user turn and a cited assistant turn", () => {
    const fixture = fixtureForDemoKey("knowledge");
    expect(fixture?.tool).toBe("KnowledgeAgent");
    expect(fixture?.messages).toHaveLength(2);
    expect(fixture?.messages[0]).toMatchObject({
      role: "user",
      content: KNOWLEDGE_CASE.question,
    });
    expect(fixture?.messages[1].role).toBe("assistant");
    expect(fixture?.messages[1].tool_name).toBe("KnowledgeAgent");
    expect(fixture?.messages[1].doc_list?.length).toBeGreaterThan(0);
  });

  it("freezes Data as three user/assistant table rounds", () => {
    const fixture = fixtureForDemoKey("data");
    expect(fixture?.messages).toHaveLength(6);
    expect(fixture?.messages[1].tool_name).toBe("DataAgent");
    expect(String(fixture?.messages[1].content)).toContain("Os01t0177400-01");
  });

  it("freezes Review, Brief Gene, and Deep Genome from existing case blobs", () => {
    expect(fixtureForDemoKey("review")?.messages[0].content).toBe(
      REVIEW_CASE.question
    );
    expect(fixtureForDemoKey("brief-gene")?.messages[0].content).toBe(
      "Os01g0177400"
    );
    expect(fixtureForDemoKey("deep-genome")?.messages[1].tool_name).toBe(
      "DeepGenomeAgent"
    );
    expect(
      String(fixtureForDemoKey("deep-genome")?.messages[1].content)
    ).toContain("Os01g0177400");
  });
});
