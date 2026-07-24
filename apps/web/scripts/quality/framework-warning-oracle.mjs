import { spawn } from "node:child_process";
import process from "node:process";

export const MAX_RETAINED_OUTPUT_BYTES = 1024 * 1024;
export const MAX_SCAN_TAIL_CHARS = 512;

export function classifyFrameworkWarnings(text) {
  return [
    ["vue", /^\[Vue warn\]/m],
    ["intlify", /^\[intlify\]/m],
    ["sass", /^DEPRECATION WARNING(?: \[[^\]]+\])?:/m],
    [
      "vite",
      /The CJS build of Vite's Node API is deprecated|Vite(?:'s)?[^\n]*\bdeprecated\b/i,
    ],
  ]
    .filter(([, pattern]) => pattern.test(text))
    .map(([category]) => category);
}

export function createWarningDetector() {
  const categories = new Set();
  let output = "";
  let scanTail = "";

  return {
    write(chunk) {
      const text = String(chunk);
      const combined = scanTail + text;
      for (const category of classifyFrameworkWarnings(combined)) {
        categories.add(category);
      }
      scanTail = combined.slice(-MAX_SCAN_TAIL_CHARS);
      output += text.slice(0, MAX_RETAINED_OUTPUT_BYTES - output.length);
    },
    categories() {
      return [...categories];
    },
    output() {
      return output;
    },
  };
}

export async function runCheckedProcess({ executable, args, cwd }) {
  const detector = createWarningDetector();
  const child = spawn(executable, args, { cwd, shell: false });

  child.stdout.on("data", (chunk) => {
    process.stdout.write(chunk);
    detector.write(chunk);
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(chunk);
    detector.write(chunk);
  });

  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) {
        resolve(code ?? 1);
        return;
      }
      resolve(detector.categories().length > 0 ? 86 : 0);
    });
  });
}
