import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE = readFileSync(
  resolve(__dirname, "../../src/layout/index.vue"),
  "utf8"
);

describe("Workspace layout responsive contract", () => {
  it("uses the locked mobile and compact boundaries", () => {
    expect(SOURCE).toContain("window.innerWidth < 900");
    expect(SOURCE).toContain("window.innerWidth < 1280");
    expect(SOURCE).toContain("@media (max-width: 899px)");
    expect(SOURCE).toContain("@media (max-width: 599px)");
    expect(SOURCE).toContain("isCompactViewport");
    expect(SOURCE).toContain("'64px'");
    expect(SOURCE).toContain("'272px'");
  });

  it("keeps workspace content and Footer in a non-fixed flow", () => {
    expect(SOURCE).toContain('class="main-content"');
    expect(SOURCE).toMatch(/\.main-content\s*\{[\s\S]*overflow-y:\s*auto/);
    expect(SOURCE).toMatch(/\.layout-footer\s*\{[\s\S]*border-top/);
    expect(SOURCE).not.toMatch(/\.layout-footer\s*\{[\s\S]*position:\s*fixed/);
    expect(SOURCE).not.toMatch(/transition:\s*all/);
    expect(SOURCE).not.toMatch(/background-color:\s*#[0-9a-f]{3,8}\b/i);
  });

  it("keeps the application root from creating a second page scroll", () => {
    expect(SOURCE).toMatch(/\.layout-container\s*\{[\s\S]*overflow:\s*hidden/);
    expect(SOURCE).toMatch(/\.layout-container\s*\{[\s\S]*height:\s*100dvh/);
    expect(SOURCE).not.toMatch(/\.layout-container\s*\{[\s\S]*height:\s*100vh/);
  });
});
