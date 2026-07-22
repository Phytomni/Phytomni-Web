import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE = readFileSync(resolve(__dirname, "../../src/App.vue"), "utf8");

describe("App product-layout ownership", () => {
  it("keeps the root responsible only for Element Plus locale and transfer overlays", () => {
    expect(SOURCE).toContain("el-config-provider");
    expect(SOURCE).toContain("TransferProgressList");
    expect(SOURCE).not.toContain("useRoute");
    expect(SOURCE).not.toContain("normalizeCompatibilityPath");
  });

  it("does not mount a compatibility Footer or fixed footer selector", () => {
    expect(SOURCE).not.toContain("<Footer");
    expect(SOURCE).not.toContain("showFooter");
    expect(SOURCE).not.toContain("app-footer");
    expect(SOURCE).not.toMatch(/position:\s*fixed/);
  });

  it("leaves Footer ownership to route shells", () => {
    expect(SOURCE).not.toContain("@/components/AppFooter.vue");
    expect(SOURCE).toContain("<RouterView />");
  });
});
