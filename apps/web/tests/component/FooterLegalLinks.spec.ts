import { describe, it, expect } from "vitest";
import { mount, config } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import enUS from "@/locales/langs/en-US";
import zhCN from "@/locales/langs/zh-CN";
import Footer from "@/components/Footer.vue";

const i18n = createI18n({
  legacy: false,
  locale: "en-US",
  messages: { "en-US": enUS, "zh-CN": zhCN },
});
config.global.plugins = [i18n];

describe("Footer legal links", () => {
  it("keeps the ICP filing id and links Terms/Privacy", () => {
    const wrapper = mount(Footer);
    expect(wrapper.text()).toContain("京ICP备07026971号-9");
    const hrefs = wrapper.findAll("a").map((a) => a.attributes("href"));
    expect(hrefs).toContain("/terms");
    expect(hrefs).toContain("/privacy");
    expect(hrefs.some((h) => h?.includes("beian.miit.gov.cn"))).toBe(true);
  });
});
