import assert from "node:assert/strict";
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

const scriptDir = dirname(fileURLToPath(import.meta.url));
const fixture = resolve(scriptDir, "fixtures/emit-output.mjs");

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

test("retains bounded diagnostic output while scanning chunk boundaries", () => {
  const detector = createWarningDetector();
  detector.write("x".repeat(MAX_RETAINED_OUTPUT_BYTES + 20));
  detector.write("\n[intlify] late warning");
  assert.equal(detector.output().length, MAX_RETAINED_OUTPUT_BYTES);
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
