import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import enUS from "@/locales/langs/en-US";
import zhCN from "@/locales/langs/zh-CN";
import Footer from "@/components/Footer.vue";

const SOURCE = readFileSync(
  resolve(__dirname, "../../src/components/Footer.vue"),
  "utf8"
);

const i18n = createI18n({
  legacy: false,
  locale: "en-US",
  messages: { "en-US": enUS, "zh-CN": zhCN },
});

const mountFooter = () => mount(Footer, { global: { plugins: [i18n] } });

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
  });
});
