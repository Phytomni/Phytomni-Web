import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import process from "node:process";

import { runCheckedProcess } from "./framework-warning-oracle.mjs";

export const COMMANDS = {
  build: ["vite", ["build", "--mode", "production"]],
  test: ["vitest", ["run"]],
  coverage: ["vitest", ["run", "--coverage"]],
};

const scriptDir = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(scriptDir, "../..");

export function resolveCommand(mode, forwardedArgs) {
  if (!Object.hasOwn(COMMANDS, mode)) return undefined;
  const command = COMMANDS[mode];

  const [name, args] = command;
  return {
    executable: resolve(webRoot, "node_modules", ".bin", name),
    args: [...args, ...forwardedArgs],
    cwd: webRoot,
  };
}

export async function main(argv = process.argv) {
  const [mode, ...forwardedArgs] = argv.slice(2);
  const command = resolveCommand(mode, forwardedArgs);
  if (!command) {
    process.stderr.write(`Unknown warning-oracle mode: ${mode ?? ""}\n`);
    return 64;
  }
  return runCheckedProcess(command);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const code = await main();
  process.exitCode = code;
}
