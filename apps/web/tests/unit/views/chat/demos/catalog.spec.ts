import { describe, expect, it } from "vitest";
import {
  AGENT_CASE_DEMO_KEYS,
  demoDialogueId,
  fixtureForDemoKey,
  isAgentCaseDemoKey,
  isDemoDialogueId,
} from "@/views/chat/demos/catalog";
import { DESIGN_CASE_QUESTION } from "@/views/chat/demos/design-fixture";
import { NETWORK_CASE_QUESTION } from "@/views/chat/demos/network-fixture";
import { NETWORK_SAMPLE_DOWNLOAD_SENTINEL } from "@/views/chat/demos/networkStaticDownload";
import { DEEP_GENOME_CASE_QUESTION } from "@/views/deep-genome-agent/deep-genome-case";
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
    expect(
      fixture?.messages[1].doc_list?.every(
        (row) =>
          typeof row.formatted_citation === "string" &&
          row.formatted_citation.length > 0
      )
    ).toBe(true);
  });

  it("freezes Data as three user/assistant table rounds", () => {
    const fixture = fixtureForDemoKey("data");
    expect(fixture?.messages).toHaveLength(6);
    expect(fixture?.messages[1].tool_name).toBe("DataAgent");
    expect(String(fixture?.messages[1].content)).toContain("Os01t0177400-01");
  });

  it("freezes Review, Brief Gene, and Deep Genome from existing case blobs", () => {
    const review = fixtureForDemoKey("review");
    expect(review?.messages[0].content).toBe(REVIEW_CASE.question);
    expect(
      review?.messages[1].doc_list?.every(
        (row) =>
          typeof row.formatted_citation === "string" &&
          row.formatted_citation.length > 0
      )
    ).toBe(true);
    expect(
      review?.messages[1].doc_list?.some(
        (row) => typeof row.au === "string" && row.au.length > 0
      )
    ).toBe(true);
    expect(fixtureForDemoKey("brief-gene")?.messages[0].content).toBe(
      "Os01g0177400"
    );
    const deepGenomeQuestion = String(
      fixtureForDemoKey("deep-genome")?.messages[0].content
    );
    expect(deepGenomeQuestion).toBe(DEEP_GENOME_CASE_QUESTION);
    expect(deepGenomeQuestion).toContain("rice");
    expect(deepGenomeQuestion).toContain("Os01g0177400");
    expect(fixtureForDemoKey("deep-genome")?.messages[1].tool_name).toBe(
      "DeepGenomeAgent"
    );
    expect(
      String(fixtureForDemoKey("deep-genome")?.messages[1].content)
    ).toContain("Os01g0177400");
  });

  it("freezes Network and Design as a question plus a downloadable sample", () => {
    const network = fixtureForDemoKey("network");
    expect(network?.messages[0].content).toBe(NETWORK_CASE_QUESTION);
    expect(NETWORK_CASE_QUESTION).toContain("rice");
    expect(NETWORK_CASE_QUESTION).toContain("TO:0000011");
    expect(network?.messages[1].tool_name).toBe("GeneNetworkAgent");
    expect(network?.messages[1].download_path).toBe(
      NETWORK_SAMPLE_DOWNLOAD_SENTINEL
    );
    const design = fixtureForDemoKey("design");
    expect(design?.messages[0].content).toBe(DESIGN_CASE_QUESTION);
    expect(DESIGN_CASE_QUESTION).toContain("rice");
    expect(DESIGN_CASE_QUESTION).toContain("Os01g0177400");
    expect(design?.messages[1].download_path).toBe(
      "/static/downloads/7.Digital Design Agent/2.DigitalAgent/results/design_results.zip"
    );
  });
});
