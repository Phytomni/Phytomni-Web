import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE = readFileSync(resolve(__dirname, "../../src/App.vue"), "utf8");

describe("App product-layout hand-off", () => {
  it("does not stage the compatibility Footer for auth routes", () => {
    expect(SOURCE).toContain('route.meta?.productLayout === "auth"');
    expect(SOURCE).toContain('"/change-password"');
    expect(SOURCE).toMatch(
      /if\s*\(route\.meta\?\.productLayout\s*===\s*"auth"\)\s*return\s*false/,
    );
  });

  it("keeps the global Footer mount available for non-auth compatibility routes", () => {
    expect(SOURCE).toMatch(/<Footer\s+v-if="showFooter"\s+class="app-footer"\s*\/>/);
    expect(SOURCE).toContain("productLayout");
  });
});
