import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { CANONICAL_AGENT_TOOLS } from "@/constants/agents";

const repoRoot = resolve(process.cwd(), "../..");
const manifestPath = resolve(
  process.cwd(),
  "tests/fixtures/bot-head/contract-manifest.json"
);

const releaseSha = "38349aab1f6e2d65c286723beb3e5a426027e77a";
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
  "conversation_context_v1",
];
const archiveFixtures = {
  analyst: {
    path: "apps/server/external/bot/testdata/head/analyst_terminal.json",
    sha256: "b82b7809bdea88f023e90132a4a361386a3134f01b2b0766356209bdaf379ad8",
  },
  research: {
    path: "apps/server/external/bot/testdata/head/research_terminal.json",
    sha256: "9655b1e1b677b36b75a46ced3169456f2ef0db0a457205896803b1a9da5d8d26",
  },
  network: {
    path: "apps/server/external/bot/testdata/head/network_terminal.json",
    sha256: "ce1cda9d84b7f730715fb9f500c6bc71127ab1fc94aa34b03ed0c36340999f53",
  },
  design: {
    path: "apps/server/external/bot/testdata/head/design_terminal.json",
    sha256: "43c9628ec27920b52f416c0d6b6056417e28ef0a48910fb810bc18b7c0e1bda2",
  },
};

type ContractManifest = {
  schema_version: number;
  bot_commit: string;
  required_agents: string[];
  fixtures: string[];
  result_archive_v1: {
    protocol_version: number;
    fixtures: typeof archiveFixtures;
  };
};

function readManifest(): ContractManifest {
  return JSON.parse(readFileSync(manifestPath, "utf8")) as ContractManifest;
}

describe("Bot HEAD compatibility contract", () => {
  it("pins the release SHA, ten slugs, fixture IDs, and archive hashes", () => {
    const manifest = readManifest();
    expect(manifest.schema_version).toBe(2);
    expect(manifest.bot_commit).toBe(releaseSha);
    expect(manifest.required_agents).toEqual(releaseSlugs);
    expect(new Set(manifest.required_agents).size).toBe(releaseSlugs.length);
    expect(manifest.fixtures).toEqual(fixtureIds);
    expect(new Set(manifest.fixtures).size).toBe(fixtureIds.length);
    expect(manifest.result_archive_v1.protocol_version).toBe(1);
    expect(manifest.result_archive_v1.fixtures).toEqual(archiveFixtures);
  });

  it("keeps the Web canonical tool map aligned with the ten release agents", () => {
    expect(CANONICAL_AGENT_TOOLS).toEqual(releaseTools);
    expect(new Set(CANONICAL_AGENT_TOOLS).size).toBe(releaseTools.length);
  });

  it("keeps fixture entries as IDs rather than raw provider payloads", () => {
    const manifest = readManifest();
    expect(Object.keys(manifest).sort()).toEqual([
      "activation_source_binding",
      "bot_commit",
      "fixtures",
      "required_agents",
      "result_archive_v1",
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
      expect(config).not.toMatch(new RegExp(`^\\s*${key}:`, "m"));
    }

    const userStore = readFileSync(
      resolve(repoRoot, "apps/web/src/stores/user.ts"),
      "utf8"
    );
    expect(userStore).toMatch(/^\s*expertEnabled: true\b/m);

    const sendMessage = readFileSync(
      resolve(
        repoRoot,
        "apps/web/src/views/chat/composables/useSendMessage.ts"
      ),
      "utf8"
    );
    expect(sendMessage).not.toContain("VITE_STREAM_ENABLED");
  });
});
