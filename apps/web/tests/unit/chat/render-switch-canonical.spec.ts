import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const FILES = [
  "src/views/chat/composables/useSendMessage.ts",
  "src/views/chat/composables/useRefreshMessage.ts",
  "src/views/chat/composables/useSelectChat.ts",
  "src/views/chat/components/ChatMessageContent.vue",
];
const LEGACY = [
  "ChatAgents",
  "KnowledgeAgents",
  "DatabaseAgents",
  "ReviewAgents",
  "AnalysisAgents",
  "BriefReviewAgent",
];

describe("render-switch agent names are canonical", () => {
  for (const rel of FILES) {
    const src = readFileSync(resolve(__dirname, "../../../", rel), "utf8");
    it(`${rel} contains no legacy agent names`, () => {
      for (const name of LEGACY) {
        expect(src, `${rel} still references ${name}`).not.toContain(
          `"${name}"`
        );
      }
    });
  }
  it("useSendMessage has no object-vs-string tool_name compare and renders chat on ChatAgent", () => {
    const src = readFileSync(
      resolve(
        __dirname,
        "../../../src/views/chat/composables/useSendMessage.ts"
      ),
      "utf8"
    );
    expect(src).not.toContain('response.data === "ChatAgent"');
    expect(src).toContain('response.data.tool_name === "ChatAgent"');
  });
  it("ChatMessageContent uses canonical tool_name agent strings", () => {
    const src = readFileSync(
      resolve(
        __dirname,
        "../../../src/views/chat/components/ChatMessageContent.vue"
      ),
      "utf8"
    );
    expect(src).toContain("'GeneNetworkAgent'");
    expect(src).toContain("'DigitalDesignAgent'");
    expect(src).toContain("'DeepGenomeAgent'");
  });
});
