import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { CANONICAL_AGENT_TOOLS } from "@/constants/agents";

const repoRoot = resolve(process.cwd(), "../..");
const manifestPath = resolve(
  process.cwd(),
  "tests/fixtures/bot-head/contract-manifest.json"
);

const releaseSha = "e0c296e6773f6638bac57a181bc727fd97c8a9fb";
const releaseSlugs = [
  "chat",
  "knowledge",
  "data",
  "review",
  "brief_gene",
  "analyst",
  "deep_genome",
  "research",
  "design",
  "network",
];
const releaseTools = [
  "ChatAgent",
  "KnowledgeAgent",
  "DataAgent",
  "ReviewAgent",
  "BriefGeneAgent",
  "AnalystAgent",
  "DeepGenomeAgent",
  "InSilicoResearchAgent",
  "DigitalDesignAgent",
  "GeneNetworkAgent",
];
const fixtureIds = [
  "chat_completion_run_id",
  "degraded_tracking",
  "deep_genome_revision",
  "review_input_required",
];

type ContractManifest = {
  schema_version: number;
  bot_commit: string;
  required_agents: string[];
  fixtures: string[];
};

function readManifest(): ContractManifest {
  return JSON.parse(readFileSync(manifestPath, "utf8")) as ContractManifest;
}

describe("Bot HEAD compatibility contract", () => {
  it("pins the release SHA, exact ten slugs, and required fixture IDs", () => {
    const manifest = readManifest();
    expect(manifest.schema_version).toBe(1);
    expect(manifest.bot_commit).toBe(releaseSha);
    expect(manifest.required_agents).toEqual(releaseSlugs);
    expect(new Set(manifest.required_agents).size).toBe(releaseSlugs.length);
    expect(manifest.fixtures).toEqual(fixtureIds);
    expect(new Set(manifest.fixtures).size).toBe(fixtureIds.length);
  });

  it("keeps the Web canonical tool map aligned with the ten release agents", () => {
    expect(CANONICAL_AGENT_TOOLS).toEqual(releaseTools);
    expect(new Set(CANONICAL_AGENT_TOOLS).size).toBe(releaseTools.length);
  });

  it("keeps fixture entries as IDs rather than raw provider payloads", () => {
    const manifest = readManifest();
    expect(Object.keys(manifest).sort()).toEqual([
      "bot_commit",
      "fixtures",
      "required_agents",
      "schema_version",
    ]);
    expect(
      manifest.fixtures.every((fixtureId) => typeof fixtureId === "string")
    ).toBe(true);
    expect(JSON.stringify(manifest)).not.toContain("payload");
    expect(JSON.stringify(manifest)).not.toContain("traceback");
  });

  it("keeps all compatibility feature gates opt-in by default", () => {
    const config = readFileSync(
      resolve(repoRoot, "apps/server/config/app.yml.example"),
      "utf8"
    );
    for (const key of [
      "expert_enabled",
      "stream_enabled",
      "a2ui_actions_enabled",
    ]) {
      expect(config).toMatch(new RegExp(`^\\s*${key}: false\\b`, "m"));
    }

    const userStore = readFileSync(
      resolve(repoRoot, "apps/web/src/stores/user.ts"),
      "utf8"
    );
    expect(userStore).toMatch(/^\s*expertEnabled: false\b/m);

    const sendMessage = readFileSync(
      resolve(
        repoRoot,
        "apps/web/src/views/chat/composables/useSendMessage.ts"
      ),
      "utf8"
    );
    expect(sendMessage).toContain(
      'import.meta.env.VITE_STREAM_ENABLED === "true"'
    );
  });
});
