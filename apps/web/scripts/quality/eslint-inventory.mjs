#!/usr/bin/env node
/* eslint-env node */

import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(scriptDir, "../..");
const require = createRequire(resolve(webRoot, "package.json"));
const { ESLint } = require("eslint");
const eslintVersion = require("eslint/package.json").version;
const tsParser = require("@typescript-eslint/parser");
const tsParserPath = require.resolve("@typescript-eslint/parser");
const vueParser = require("vue-eslint-parser");

function usage() {
  return [
    "Usage: node apps/web/scripts/quality/eslint-inventory.mjs [options]",
    "",
    "Options:",
    "  --root <path>       ESLint project root (default: apps/web)",
    "  --file <path>       Tracked file relative to --root (repeatable)",
    "  --help              Show this help text",
  ].join("\n");
}

function parseArgs(argv) {
  let root = webRoot;
  const files = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") {
      return { help: true, root, files };
    }
    if (argument === "--root" || argument === "--file") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${argument} requires a value`);
      }
      if (argument === "--root") root = resolve(value);
      else files.push(value);
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${argument}`);
  }
  return { help: false, root, files };
}

function normalizeSource(source) {
  return source.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trim();
}

function lineStartOffsets(source) {
  const offsets = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") offsets.push(index + 1);
  }
  return offsets;
}

function locationOffset(offsets, line, column) {
  const lineStart = offsets[Math.max(0, line - 1)] ?? 0;
  return lineStart + Math.max(0, column - 1);
}

function nodeRange(node, offsets) {
  if (Array.isArray(node.range) && node.range.length === 2) return node.range;
  if (!node.loc?.start || !node.loc?.end) return null;
  return [
    locationOffset(offsets, node.loc.start.line, node.loc.start.column + 1),
    locationOffset(offsets, node.loc.end.line, node.loc.end.column + 1),
  ];
}

function nodeIdentity(node) {
  if (node.type === "VElement") {
    return `element:${node.rawName ?? node.name}`;
  }
  if (node.id?.name) return `${node.type}:${node.id.name}`;
  if (node.key?.name) return `${node.type}:${node.key.name}`;
  if (typeof node.key?.value === "string") {
    return `${node.type}:${node.key.value}`;
  }
  return null;
}

function containingSymbol(ast, message, source) {
  const offsets = lineStartOffsets(source);
  const point = locationOffset(offsets, message.line, message.column);
  const endLine = message.endLine ?? message.line;
  const endColumn = message.endColumn ?? message.column;
  const location = `${message.line}:${message.column}-${endLine}:${endColumn}`;
  let best = null;
  const visited = new Set();

  function visit(node) {
    if (!node || typeof node !== "object" || visited.has(node)) return;
    visited.add(node);
    const range = nodeRange(node, offsets);
    if (range && range[0] <= point && point <= range[1]) {
      const identity = nodeIdentity(node);
      if (
        identity &&
        (!best || range[1] - range[0] < best.range[1] - best.range[0])
      ) {
        best = { identity, range };
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === "parent" || key === "tokens" || key === "comments") continue;
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") visit(value);
    }
  }

  visit(ast);
  if (best) {
    return {
      kind: "symbol",
      identity: `${best.identity}@${location}`,
      normalizedSource: normalizeSource(
        source.slice(best.range[0], best.range[1])
      ),
    };
  }
  const line = source.split("\n")[Math.max(0, message.line - 1)] ?? "";
  const normalizedLine = normalizeSource(line);
  return {
    kind: "span",
    identity: `span:${location}:${normalizedLine}`,
    normalizedSource: normalizedLine,
  };
}

function parseAst(source, filePath) {
  const parser =
    extname(filePath).toLowerCase() === ".vue" ? vueParser : tsParser;
  const result = parser.parseForESLint(source, {
    filePath,
    loc: true,
    range: true,
    tokens: true,
    comment: true,
    ecmaVersion: "latest",
    sourceType: "module",
    parser:
      extname(filePath).toLowerCase() === ".vue" ? tsParserPath : undefined,
  });
  return result.ast ?? result;
}

async function inventory({ root, files }) {
  const resolvedFiles = files.map((file) => resolve(root, file));
  for (const file of resolvedFiles) {
    const relativePath = relative(root, file);
    if (
      !relativePath ||
      relativePath.startsWith("..") ||
      relativePath.includes("\0")
    ) {
      throw new Error(`file is outside root: ${file}`);
    }
  }
  if (resolvedFiles.length === 0) {
    return {
      schemaVersion: 1,
      toolVersion: eslintVersion,
      filesScanned: 0,
      findings: [],
    };
  }

  process.env.PHYTOMNI_WEB_ROOT = webRoot;
  const eslint = new ESLint({
    cwd: root,
    errorOnUnmatchedPattern: true,
    reportUnusedDisableDirectives: "error",
    resolvePluginsRelativeTo: webRoot,
    useEslintrc: true,
  });
  const lintableFiles = [];
  for (const file of resolvedFiles) {
    if (!(await eslint.isPathIgnored(file))) lintableFiles.push(file);
  }
  if (lintableFiles.length === 0) {
    return {
      schemaVersion: 1,
      toolVersion: eslintVersion,
      filesScanned: 0,
      findings: [],
    };
  }
  const results = await eslint.lintFiles(lintableFiles);
  const findings = [];
  for (const result of results) {
    const source = result.source ?? (await readFile(result.filePath, "utf8"));
    let ast;
    try {
      ast = parseAst(source, result.filePath);
    } catch (error) {
      throw new Error(`parser failed for ${result.filePath}: ${error.message}`);
    }
    for (const message of result.messages) {
      if (message.fatal) {
        throw new Error(
          `ESLint fatal diagnostic for ${result.filePath}: ${message.message}`
        );
      }
      const relativePath = relative(root, result.filePath)
        .split("\\")
        .join("/");
      const target = containingSymbol(ast, message, source);
      findings.push({
        tool: "eslint",
        toolVersion: eslintVersion,
        rule: message.ruleId ?? "eslint-internal",
        path: relativePath,
        message: message.message,
        severity: message.severity === 2 ? 2 : 1,
        display: {
          line: message.line ?? 1,
          column: message.column ?? 1,
          ...(message.endLine == null ? {} : { endLine: message.endLine }),
          ...(message.endColumn == null
            ? {}
            : { endColumn: message.endColumn }),
        },
        target,
      });
    }
  }
  findings.sort((left, right) => {
    const leftKey = [
      left.path,
      left.display.line,
      left.display.column,
      left.rule,
      left.message,
    ]
      .map(String)
      .join("\u0000");
    const rightKey = [
      right.path,
      right.display.line,
      right.display.column,
      right.rule,
      right.message,
    ]
      .map(String)
      .join("\u0000");
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  return {
    schemaVersion: 1,
    toolVersion: eslintVersion,
    filesScanned: lintableFiles.length,
    findings,
  };
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  process.stdout.write(`${usage()}\n`);
} else {
  try {
    const document = await inventory(options);
    process.stdout.write(`${JSON.stringify(document)}\n`);
  } catch (error) {
    process.stderr.write(
      `eslint-inventory: ${
        error instanceof Error ? error.message : String(error)
      }\n`
    );
    process.exitCode = 1;
  }
}
