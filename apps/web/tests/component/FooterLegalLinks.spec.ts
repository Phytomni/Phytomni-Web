import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Footer from "@/components/AppFooter.vue";
import { mountWithApp } from "../helpers/test-app-context";

const SOURCE = readFileSync(
  resolve(__dirname, "../../src/components/AppFooter.vue"),
  "utf8"
);

const mountFooter = () => mountWithApp(Footer);

describe("Footer legal links", () => {
  it("keeps the ICP filing id and links Terms/Privacy", () => {
    const wrapper = mountFooter();
    expect(wrapper.text()).toContain("京ICP备07026971号-9");
    const hrefs = wrapper.findAll("a").map((a) => a.attributes("href"));
    expect(hrefs).toContain("/terms");
    expect(hrefs).toContain("/privacy");
    expect(hrefs.some((h) => h?.includes("beian.miit.gov.cn"))).toBe(true);
  });

  it("wraps narrow legal copy with tokenized colors and focus states", () => {
    expect(SOURCE).toMatch(
      /\.footer-container\s*\{[\s\S]*box-sizing:\s*border-box/
    );
    expect(SOURCE).toMatch(/\.footer-content\s*\{[\s\S]*flex-wrap:\s*wrap/);
    expect(SOURCE).toMatch(/padding:\s*0 var\(--phy-space-16\)/);
    expect(SOURCE).toMatch(/:focus-visible/);
    expect(SOURCE).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
    expect(SOURCE).not.toMatch(/\.theme-dark/);
    expect(SOURCE).not.toMatch(/position\s*:\s*(?:fixed|sticky)/);
    expect(SOURCE).toMatch(/min-height:\s*var\(--phy-control-height-default\)/);
    expect(SOURCE).toContain("@media (max-width: 899px)");
  });
});
