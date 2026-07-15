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
const expectedTerminalProjections = [
  {
    id: "chat-confirm-success-accept",
    source_path: "docs/contracts/a2ui/chat_confirm/success_accept.json",
    sha256:
      "ff2707277e12c142c07f89027d3a84b99caa2756b3d67f8f4d465090cb4b172e",
    file: "upstream/chat_confirm/success_accept.json",
  },
  {
    id: "chat-form-success-submit",
    source_path: "docs/contracts/a2ui/chat_form/success_submit.json",
    sha256:
      "6907007f2824c83c6aa8fa92d826e065819355d8e4a17670b3ce995065652b28",
    file: "upstream/chat_form/success_submit.json",
  },
  {
    id: "chat-form-success-cancel",
    source_path: "docs/contracts/a2ui/chat_form/success_cancel.json",
    sha256:
      "155f80b6a1c51f6ee8dfa7f4f3b074e846343b266d88e2823bbf08e3f57a0d53",
    file: "upstream/chat_form/success_cancel.json",
  },
  {
    id: "chat-choice-success-submit",
    source_path: "docs/contracts/a2ui/chat_choice/success_submit.json",
    sha256:
      "61d1f9b9614d6c76ad14b88b8453835987ae132ea309c998ea39c9c625964f56",
    file: "upstream/chat_choice/success_submit.json",
  },
  {
    id: "chat-choice-success-cancel",
    source_path: "docs/contracts/a2ui/chat_choice/success_cancel.json",
    sha256:
      "e801e85c0782ab47e3545b4fbb1e70b325c52f94cee10f8d82687f65bb6f090b",
    file: "upstream/chat_choice/success_cancel.json",
  },
] as const;
const expectedWebHttpFixtures = [
  {
    id: "web-http-terminal-succeeded",
    source_path: "docs/contracts/a2ui/chat_confirm/success_accept.json",
    file: "http/terminal_succeeded.json",
  },
  {
    id: "web-http-input-required-round2",
    source_path: "docs/contracts/a2ui/multi_turn/round2_downlink.json",
    file: "http/input_required_round2.json",
  },
  {
    id: "web-http-conflict-not-open",
    source_path: "docs/contracts/a2ui/chat_confirm/errors/not_input_required_409.json",
    file: "http/conflict_not_open.json",
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

  it.each(expectedTerminalProjections)(
    "pins the $id terminal projection and preserves its partial response shape",
    (expected) => {
      const manifest = JSON.parse(
        readFileSync(manifestPath, "utf8")
      ) as FixtureManifest;
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

      const fixturePath = resolve(
        process.cwd(),
        "tests/fixtures/a2ui",
        entry.file
      );
      const fixtureSha256 = createHash("sha256")
        .update(readFileSync(fixturePath))
        .digest("hex");
      expect(fixtureSha256).toBe(entry.sha256);

      const body = JSON.parse(readFileSync(fixturePath, "utf8")) as Record<
        string,
        unknown
      >;
      expect(body).toMatchObject({
        status: "succeeded",
        result: expect.objectContaining({
          a2ui: expect.anything(),
        }),
      });
      for (const envelopeField of ["id", "run_id", "object", "task_ids"]) {
        expect(body).not.toHaveProperty(envelopeField);
      }
    }
  );

  it.each(expectedWebHttpFixtures)(
    "registers $id as a complete Web-owned HTTP envelope",
    (expected) => {
      const manifest = JSON.parse(
        readFileSync(manifestPath, "utf8")
      ) as FixtureManifest;
      const entries = manifest.fixtures.filter(
        (entry) => entry.id === expected.id
      );
      expect(entries).toHaveLength(1);

      const entry = entries[0];
      expect(entry).toMatchObject({
        id: expected.id,
        class: "web-http-synthetic",
        partial: false,
        source_commit: sourceCommit,
        source_path: expected.source_path,
        file: expected.file,
      });
      expect(entry.source_path).not.toMatch(/golden/i);
      expect(entry.file).not.toMatch(/^upstream\//);
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);

      const fixturePath = resolve(
        process.cwd(),
        "tests/fixtures/a2ui",
        entry.file
      );
      const fixtureSha256 = createHash("sha256")
        .update(readFileSync(fixturePath))
        .digest("hex");
      expect(fixtureSha256).toBe(entry.sha256);

      const body = JSON.parse(readFileSync(fixturePath, "utf8")) as Record<
        string,
        unknown
      >;
      if (expected.id === "web-http-conflict-not-open") {
        expect(body).toMatchObject({
          error: {
            type: "conflict",
            code: 409,
            message: "Run is not waiting for input.",
            request_id: expect.any(String),
          },
        });
        return;
      }

      expect(body).toMatchObject({
        id: expect.any(String),
        run_id: expect.any(String),
        object: "agent.run",
        agent: expect.any(String),
        status: expect.any(String),
        task_ids: expect.any(Array),
      });
    }
  );
});
