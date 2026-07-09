import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, config, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import enUS from "@/locales/langs/en-US";
import zhCN from "@/locales/langs/zh-CN";

vi.mock("vue-router", () => ({
  useRoute: () => ({ meta: { doc: "terms" } }),
  useRouter: () => ({ push: vi.fn() }),
}));

import LegalPage from "@/views/legal/index.vue";

const i18n = createI18n({
  legacy: false,
  locale: "en-US",
  fallbackLocale: "en-US",
  messages: { "en-US": enUS, "zh-CN": zhCN },
});
config.global.plugins = [i18n, ElementPlus];

describe("LegalPage", () => {
  beforeEach(() => {
    (i18n.global.locale as { value: string }).value = "en-US";
  });

  it("renders terms version and markdown-derived heading", async () => {
    const wrapper = mount(LegalPage, { global: { stubs: { LangSwitch: true } } });
    await flushPromises();
    expect(wrapper.text()).toMatch(/0\.1\.0/);
    expect(wrapper.find(".legal-body").html().length).toBeGreaterThan(20);
    expect(wrapper.text()).toMatch(/draft|review/i);
  });
});
