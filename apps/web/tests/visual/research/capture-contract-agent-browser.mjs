#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { runInNewContext } from "node:vm";

const args = process.argv.slice(2);
const sessionIndex = args.indexOf("--session");
const commandIndex = sessionIndex === -1 ? 0 : sessionIndex + 2;
const command = args[commandIndex];
const commandArgs = args.slice(commandIndex + 1);

function failHarness(message) {
  process.stderr.write(`Harness error: ${message}\n`);
  process.exitCode = 2;
}

function evaluationMessage(error) {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String(error.message);
  }
  return "unknown evaluation error";
}

function createWindow(oracleMode) {
  const window = {};
  switch (oracleMode) {
    case "absent":
      break;
    case "non-function":
      window.assertScientificMarkdownVisualContract = "private oracle value";
      break;
    case "failed-result":
      window.assertScientificMarkdownVisualContract = () => ({
        pass: false,
        detail: "private contract detail",
      });
      break;
    case "pass":
      window.assertScientificMarkdownVisualContract = () => ({ pass: true });
      break;
    default:
      failHarness(`unsupported oracle mode: ${oracleMode}`);
      return window;
  }
  return window;
}

switch (command) {
  case "set":
  case "open":
  case "wait":
  case "close":
    break;
  case "eval": {
    const expression = commandArgs[0];
    if (!expression) {
      failHarness("eval expression missing");
      break;
    }

    const root = { dataset: { fixtureReady: "true" } };
    const window = createWindow(process.env.PHYTOMNI_CAPTURE_HARNESS_ORACLE);
    if (process.exitCode === 2) break;
    const context = {
      document: { querySelector: () => root },
      window,
    };
    try {
      const result = runInNewContext(expression, context);
      if (result !== undefined) {
        process.stdout.write(`${JSON.stringify(result)}\n`);
      }
    } catch (error) {
      process.stderr.write(`Evaluation error: ${evaluationMessage(error)}\n`);
      process.exitCode = 1;
    }
    break;
  }
  case "screenshot": {
    const outputPath = commandArgs[0];
    if (!outputPath) {
      failHarness("screenshot path missing");
      break;
    }
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, "capture reached\n");
    break;
  }
  default:
    failHarness(`unsupported command: ${command}`);
}
