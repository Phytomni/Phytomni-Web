import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const pkgPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../package.json",
);

describe("moment retirement", () => {
  it("does not list moment in package.json dependencies", () => {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      dependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.moment).toBeUndefined();
  });
});
