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
const expectedUpstreamProjections = [
  {
    id: "chat-confirm-downlink",
    source_path: "docs/contracts/a2ui/chat_confirm/downlink.json",
    sha256:
      "a495fb8c9af8ab0bdedac6f23178863e8a8720d2a8d0b0af3d3861373addae67",
    file: "upstream/chat_confirm/downlink.json",
  },
  {
    id: "chat-form-downlink",
    source_path: "docs/contracts/a2ui/chat_form/downlink.json",
    sha256:
      "9068a2bd6885b8b87631bea819e543ea77fefb154acb7eff8d7291a464b2fd0e",
    file: "upstream/chat_form/downlink.json",
  },
  {
    id: "chat-choice-downlink",
    source_path: "docs/contracts/a2ui/chat_choice/downlink.json",
    sha256:
      "76b80db916ace2b384771535376ea2fefe45d245c514dfe3194ab4df0b301f16",
    file: "upstream/chat_choice/downlink.json",
  },
  {
    id: "multi-turn-round2-downlink",
    source_path: "docs/contracts/a2ui/multi_turn/round2_downlink.json",
    sha256:
      "4f9d57799e06deeae324bddadc6b4ac1cbc683abec67d80838d60a34cb739cc4",
    file: "upstream/multi_turn/round2_downlink.json",
  },
] as const;
const sourceCommit = "27448d121139699d99f24820afed3948658fe89f";

describe("A2UI contract fixtures", () => {
  it.each(expectedUpstreamProjections)(
    "pins the $id projection to its audited Bot source",
    (expected) => {
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

      const entries = manifest.fixtures.filter(
        (entry) => entry.id === expected.id
      );
      expect(entries).toHaveLength(1);

      const entry = entries[0];
      expect(entry).toMatchObject({
        id: expected.id,
        class: "upstream-projection",
        partial: true,
        source_commit: sourceCommit,
        source_path: expected.source_path,
        sha256: expected.sha256,
        file: expected.file,
      });

      const fixtureSha256 = createHash("sha256")
        .update(
          readFileSync(
            resolve(process.cwd(), "tests/fixtures/a2ui", entry.file)
          )
        )
        .digest("hex");
      expect(fixtureSha256).toBe(entry.sha256);
    }
  );

  it("marks every upstream projection as partial", () => {
    const manifest = JSON.parse(
      readFileSync(manifestPath, "utf8")
    ) as FixtureManifest;
    const upstreamEntries = manifest.fixtures.filter(
      (entry) => entry.class === "upstream-projection"
    );

    expect(upstreamEntries.length).toBeGreaterThan(0);
    expect(upstreamEntries.every((entry) => entry.partial)).toBe(true);
  });
});
