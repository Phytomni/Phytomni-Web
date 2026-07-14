import { describe, expect, it, vi } from "vitest";
import { config, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import enUS from "@/locales/langs/en-US";
import zhCN from "@/locales/langs/zh-CN";

vi.mock("vue-router", () => ({
  useRouter: () => ({
    back: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock("@/utils/auth", () => ({
  getToken: () => "synthetic-token",
}));

vi.mock("vue-element-plus-x", () => ({
  Typewriter: { name: "Typewriter", template: "<div />" },
}));

import HelpView from "@/views/help/index.vue";

const i18n = createI18n({
  legacy: false,
  locale: "en-US",
  messages: { "en-US": enUS, "zh-CN": zhCN },
});
config.global.plugins = [i18n, ElementPlus];

describe("HelpView", () => {
  it("renders real section anchors instead of leaking HTML wrappers into markdown", () => {
    const wrapper = mount(HelpView, {
      global: { stubs: { Typewriter: true } },
    });

    const sections = wrapper.findAll(".help-article > section");
    expect(sections).toHaveLength(5);
    expect(sections.map((section) => section.attributes("id"))).toEqual([
      "what-is-phytomni",
      "getting-started",
      "how-it-works",
      "resources",
      "limitations",
    ]);
    expect(wrapper.find(".help-article").text()).not.toContain("<div id=");
    expect(wrapper.findAll(".help-article > section > h1")).toHaveLength(5);
    expect(wrapper.find(".phy-doc-layout__footer").exists()).toBe(true);
  });
});
