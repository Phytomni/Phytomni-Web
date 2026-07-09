import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(process.cwd(), "src/views");

function read(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

describe("date call-site migration contracts", () => {
  it("profile keeps a raw lastLoginAt field and formats via formatDisplayDate", () => {
    const src = read("profile/index.vue");
    expect(src).toMatch(/lastLoginAt/);
    expect(src).toMatch(/formatDisplayDate/);
    expect(src).not.toMatch(/toLocaleDateString\(\s*[\"']zh-CN[\"']/);
    expect(src).not.toMatch(/padStart\(2,\s*[\"']0[\"']\)/);
  });

  it("global-config formats timestamps via formatDisplayDate and does not call toLocaleString zh-CN", () => {
    const src = read("global-config/index.vue");
    expect(src).toMatch(/formatDisplayDate/);
    expect(src).not.toMatch(/toLocaleString\(\s*[\"']zh-CN[\"']/);
  });
});
