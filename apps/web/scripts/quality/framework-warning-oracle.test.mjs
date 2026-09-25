import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import process from "node:process";
import test from "node:test";

import {
  MAX_RETAINED_OUTPUT_BYTES,
  classifyFrameworkWarnings,
  createWarningDetector,
  runCheckedProcess,
} from "./framework-warning-oracle.mjs";
import { COMMANDS, main, resolveCommand } from "./run-with-warning-oracle.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const fixture = resolve(scriptDir, "fixtures/emit-output.mjs");

test("limits warning-oracle modes to the approved local commands", () => {
  assert.deepEqual(COMMANDS, {
    build: ["vite", ["build", "--mode", "production"]],
    test: ["vitest", ["run"]],
    coverage: ["vitest", ["run", "--coverage"]],
  });

  const command = resolveCommand("build", ["--minify", "esbuild"]);
  assert.equal(
    command.executable,
    resolve(scriptDir, "../../node_modules/.bin/vite")
  );
  assert.deepEqual(command.args, [
    "build",
    "--mode",
    "production",
    "--minify",
    "esbuild",
  ]);
  assert.equal(command.cwd, resolve(scriptDir, "../.."));
  assert.equal(resolveCommand("unknown", []), undefined);
  assert.equal(resolveCommand("toString", []), undefined);
  assert.equal(resolveCommand("constructor", []), undefined);
});

test("rejects an unknown warning-oracle mode with EX_USAGE", async () => {
  assert.equal(await main(["node", "runner", "unknown"]), 64);
});

test("classifies clean output without business-warning false positives", () => {
  assert.deepEqual(
    classifyFrameworkWarnings("business warning: retrying request"),
    []
  );
});

for (const [category, output] of [
  ["vue", "[Vue warn] Component is missing"],
  ["intlify", "[intlify] Not found 'chat.title' key"],
  ["sass", "DEPRECATION WARNING [legacy-js-api]: migrate now"],
  ["vite", "The CJS build of Vite's Node API is deprecated"],
]) {
  test(`classifies ${category} framework warnings`, () => {
    assert.deepEqual(classifyFrameworkWarnings(output), [category]);
  });
}

test("detects a warning divided between output chunks", () => {
  const detector = createWarningDetector();
  detector.write("prefix\n[Vu");
  detector.write("e warn] split warning");
  assert.deepEqual(detector.categories(), ["vue"]);
});

test("retains UTF-8-byte-bounded output while scanning chunk boundaries", () => {
  const detector = createWarningDetector();
  detector.write("x".repeat(MAX_RETAINED_OUTPUT_BYTES - 4));
  detector.write("界界");
  assert.equal(
    Buffer.byteLength(detector.output()),
    MAX_RETAINED_OUTPUT_BYTES - 1
  );
  detector.write("\n[intlify] late warning");
  assert.ok(Buffer.byteLength(detector.output()) <= MAX_RETAINED_OUTPUT_BYTES);
  assert.deepEqual(detector.categories(), ["intlify"]);
});

test("runs a child without a shell and propagates its exit code", async () => {
  const code = await runCheckedProcess({
    executable: process.execPath,
    args: [fixture, "--exit", "17"],
    cwd: scriptDir,
  });
  assert.equal(code, 17);
});

test("returns 86 after a successful child emits a prohibited warning", async () => {
  const code = await runCheckedProcess({
    executable: process.execPath,
    args: [fixture, "--stderr", "[Vue warn] emitted by fixture"],
    cwd: scriptDir,
  });
  assert.equal(code, 86);
});

test("keeps ordinary business warnings non-blocking", async () => {
  const code = await runCheckedProcess({
    executable: process.execPath,
    args: [fixture, "--stderr", "business warning: emitted by fixture"],
    cwd: scriptDir,
  });
  assert.equal(code, 0);
});

for (const [category, warning] of [
  ["vue", "[Vue warn] emitted by fixture"],
  ["intlify", "[intlify] emitted by fixture"],
  ["sass", "DEPRECATION WARNING [legacy-js-api]: emitted by fixture"],
  ["vite", "The CJS build of Vite's Node API is deprecated"],
]) {
  test(`returns 86 for a successful child emitting a ${category} warning`, async () => {
    const code = await runCheckedProcess({
      executable: process.execPath,
      args: [fixture, "--stderr", warning],
      cwd: scriptDir,
    });
    assert.equal(code, 86);
  });
}
