import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE = readFileSync(resolve(__dirname, "../../src/App.vue"), "utf8");
const DESIGN_SYSTEM_SOURCE = readFileSync(
  resolve(__dirname, "../../../../docs/frontend-design-system.md"),
  "utf8"
);

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

  it("documents App root locale and overlay ownership without a page shell", () => {
    expect(SOURCE).toContain('<el-config-provider :locale="epLocale">');
    expect(SOURCE).toContain("<TransferProgressList />");
    expect(SOURCE).toContain("const epLocale = computed");
    expect(DESIGN_SYSTEM_SOURCE).toContain(
      "`App.vue` owns only the Element Plus locale provider and transfer overlay"
    );
    expect(DESIGN_SYSTEM_SOURCE).toContain(
      "Footer ownership stays with the route or shell"
    );
  });

  it("keeps the global overflow lock subordinate to route-owned scroll roots", () => {
    expect(SOURCE).toContain("html,");
    expect(SOURCE).toContain("body {");
    expect(SOURCE).toContain("#app {");
    expect(SOURCE.match(/overflow:\s*hidden/g)?.length).toBeGreaterThanOrEqual(
      2
    );
    expect(DESIGN_SYSTEM_SOURCE).toContain(
      "route-owned scroll roots rather than document scrolling"
    );
  });
});
