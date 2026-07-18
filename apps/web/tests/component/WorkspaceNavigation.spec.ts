import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE = readFileSync(
  resolve(__dirname, "../../src/layout/index.vue"),
  "utf8"
);

describe("Workspace navigation keyboard contract", () => {
  it("keeps the monolithic workspace navigation on semantic controls", () => {
    expect(SOURCE).toContain("<el-menu");
    expect(SOURCE).toContain('type="button"');
    expect(SOURCE).toContain('class="mobile-sidebar-toggle"');
    expect(SOURCE).toContain('class="mobile-sidebar-backdrop"');
    expect(SOURCE).toContain('class="collapse-btn"');
    expect(SOURCE).toContain("aria-expanded");
  });

  it("does not expose a fixed footer or broad transition suppression", () => {
    expect(SOURCE).not.toMatch(/\.layout-footer\s*\{[\s\S]*position:\s*fixed/);
    expect(SOURCE).not.toMatch(/transition:\s*all\b/);
    expect(SOURCE).not.toMatch(/outline:\s*(?:none|0|unset)\b/);
  });
});
