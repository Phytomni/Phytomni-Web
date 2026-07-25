import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

import {
  decodeA2uiActionResponse,
  decodeA2uiOpenSurface,
  decodeA2uiTerminalSurface,
} from "@/views/chat/streaming/a2uiParse";

type ContractKind =
  "open_surface" | "terminal_projection" | "action_response" | "error_response";

interface FixtureEntry {
  id: string;
  contract_kind: ContractKind;
  file: string;
}

interface FixtureManifest {
  fixtures: FixtureEntry[];
}

type JsonObject = Record<string, unknown>;

const fixtureRoot = resolve(process.cwd(), "tests/fixtures/a2ui");
const manifestPath = resolve(fixtureRoot, "manifest.json");
const contractKinds = new Set<ContractKind>([
  "open_surface",
  "terminal_projection",
  "action_response",
  "error_response",
]);

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readManifest(): FixtureManifest {
  return JSON.parse(readFileSync(manifestPath, "utf8")) as FixtureManifest;
}

function isWithinFixtureRoot(path: string): boolean {
  const relativePath = relative(fixtureRoot, path);
  return (
    relativePath !== "" &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${sep}`) &&
    !relativePath.startsWith(sep)
  );
}

function resolveFixturePath(entry: FixtureEntry): string {
  const path = resolve(fixtureRoot, entry.file);
  expect(isWithinFixtureRoot(path), entry.file).toBe(true);
  if (!isWithinFixtureRoot(path)) {
    throw new Error(`Fixture path escapes root: ${entry.file}`);
  }
  expect(statSync(path).isFile(), entry.file).toBe(true);
  return path;
}

function readFixture(entry: FixtureEntry): JsonObject {
  return JSON.parse(
    readFileSync(resolveFixturePath(entry), "utf8")
  ) as JsonObject;
}

function jsonFilesUnder(root: string): string[] {
  return readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      const path = resolve(root, entry.name);
      if (entry.isDirectory()) return jsonFilesUnder(path);
      if (!entry.isFile() || !entry.name.endsWith(".json")) return [];
      return [relative(fixtureRoot, path).split(sep).join("/")];
    })
    .sort();
}

function assertBoundedErrorObject(body: JsonObject): void {
  const error = body.error;
  expect(isJsonObject(error)).toBe(true);
  if (!isJsonObject(error)) return;

  const keys = Object.keys(error);
  expect(keys.length).toBeLessThanOrEqual(8);
  expect(JSON.stringify(error).length).toBeLessThanOrEqual(2048);
  expect(error).toMatchObject({
    type: expect.any(String),
    code: expect.anything(),
    message: expect.any(String),
    request_id: expect.any(String),
  });

  for (const key of keys) {
    expect(key.length).toBeLessThanOrEqual(64);
    const value = error[key];
    if (typeof value === "string") {
      expect(value.length).toBeLessThanOrEqual(512);
    }
  }
  expect((error.request_id as string).length).toBeLessThanOrEqual(256);
}

describe("A2UI contract matrix", () => {
  it("executes every manifest entry exactly once through its declared decoder", () => {
    const manifest = readManifest();
    const executedIds: string[] = [];

    for (const entry of manifest.fixtures) {
      expect(contractKinds.has(entry.contract_kind), entry.id).toBe(true);
      expect(executedIds).not.toContain(entry.id);
      executedIds.push(entry.id);

      const body = readFixture(entry);
      switch (entry.contract_kind) {
        case "open_surface": {
          const decoded = decodeA2uiOpenSurface(body);
          expect(decoded.ok, entry.id).toBe(true);
          break;
        }
        case "terminal_projection": {
          const terminalSurface = isJsonObject(body.result)
            ? body.result.a2ui
            : undefined;
          const decoded = decodeA2uiTerminalSurface(terminalSurface);
          expect(decoded.ok, entry.id).toBe(true);
          break;
        }
        case "action_response": {
          const decoded = decodeA2uiActionResponse(body);
          expect(decoded.ok, entry.id).toBe(true);
          break;
        }
        case "error_response": {
          const decoded = decodeA2uiActionResponse(body);
          expect(decoded.ok, entry.id).toBe(false);
          assertBoundedErrorObject(body);
          break;
        }
        default:
          throw new Error(`Unknown A2UI contract kind: ${entry.contract_kind}`);
      }
    }

    expect(executedIds).toEqual(manifest.fixtures.map((entry) => entry.id));
    expect(new Set(executedIds).size).toBe(manifest.fixtures.length);
  });

  it("registers every fixture JSON without allowing orphaned files", () => {
    const manifest = readManifest();
    const manifestFiles = manifest.fixtures.map((entry) => entry.file).sort();
    const fixtureFiles = jsonFilesUnder(fixtureRoot).filter(
      (file) => file !== "manifest.json"
    );

    expect(manifestFiles).toEqual(fixtureFiles);
  });

  it("keeps every manifest path inside the fixture root", () => {
    const manifest = readManifest();

    for (const entry of manifest.fixtures) {
      const path = resolve(fixtureRoot, entry.file);
      expect(isWithinFixtureRoot(path), entry.id).toBe(true);
    }
  });
});
