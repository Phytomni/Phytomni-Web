import { writeSync } from "node:fs";

import process from "node:process";

const args = process.argv.slice(2);
const stderr = args.indexOf("--stderr");
const stdout = args.indexOf("--stdout");
const exit = args.indexOf("--exit");

if (stdout !== -1) writeSync(1, args[stdout + 1]);
if (stderr !== -1) writeSync(2, args[stderr + 1]);
if (exit !== -1) process.exitCode = Number(args[exit + 1]);
