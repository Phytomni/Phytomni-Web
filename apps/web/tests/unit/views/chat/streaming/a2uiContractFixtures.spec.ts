import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type FixtureClass = "upstream-projection" | "web-http-synthetic";

interface FixtureEntry {
  id: string;
  class: FixtureClass;
  partial: boolean;
  source_commit: string;
  source_path: string;
  sha256: string;
  file: string;
}

interface FixtureManifest {
  schema_version: number;
  catalog_version: string;
  source_repository: string;
  fixtures: FixtureEntry[];
}

const manifestPath = resolve(
  process.cwd(),
  "tests/fixtures/a2ui/manifest.json"
);
const confirmFixturePath = resolve(
  process.cwd(),
  "tests/fixtures/a2ui/upstream/chat_confirm/downlink.json"
);

describe("A2UI contract fixtures", () => {
  it("pins the Confirm downlink projection to its audited Bot source", () => {
    const manifest = JSON.parse(
      readFileSync(manifestPath, "utf8")
    ) as FixtureManifest;

    expect(manifest.schema_version).toBe(1);
    expect(manifest.catalog_version).toBe("v1.0");
    expect(manifest.source_repository).toBe("Phytomni-Bot");

    const stagingEntries = manifest.fixtures.filter(
      (entry) =>
        (entry as FixtureEntry & { class: string }).class === "staging-capture"
    );
    expect(stagingEntries).toHaveLength(0);

    const confirmEntries = manifest.fixtures.filter(
      (entry) => entry.id === "chat-confirm-downlink"
    );
    expect(confirmEntries).toHaveLength(1);

    const confirmEntry = confirmEntries[0];
    expect(confirmEntry).toMatchObject({
      id: "chat-confirm-downlink",
      class: "upstream-projection",
      partial: true,
      source_commit: "27448d121139699d99f24820afed3948658fe89f",
      source_path: "docs/contracts/a2ui/chat_confirm/downlink.json",
      sha256:
        "a495fb8c9af8ab0bdedac6f23178863e8a8720d2a8d0b0af3d3861373addae67",
      file: "upstream/chat_confirm/downlink.json",
    });

    const fixtureSha256 = createHash("sha256")
      .update(readFileSync(confirmFixturePath))
      .digest("hex");
    expect(fixtureSha256).toBe(confirmEntry.sha256);
  });
});
