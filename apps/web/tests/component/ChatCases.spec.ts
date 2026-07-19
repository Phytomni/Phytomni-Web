import { defineComponent } from "vue";
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import ChatCases from "@/views/chat/components/ChatCases.vue";
import enUS from "@/locales/langs/en-US";
import zhCN from "@/locales/langs/zh-CN";

const routes = [
  "/knowledge-agent",
  "/data-agent",
  "/analyst-agent",
  "/brief-gene-agent",
  "/gene-network-agent",
  "/deep-genome-agent",
  "/digital-design-agent",
];

const enTitles = [
  "Knowledge Agent",
  "Data Agent",
  "Analyst Agent",
  "Brief Gene Agent",
  "Gene Network Agent",
  "Deep Genome Agent",
  "Digital Design Agent",
];

const zhTitles = [
  "知识智能体",
  "数据智能体",
  "分析智能体",
  "基因综述智能体",
  "基因网络智能体",
  "基因深度分析智能体",
  "智能设计智能体",
];

const RouterLinkStub = defineComponent({
  name: "RouterLink",
  props: {
    to: { type: String, required: true },
  },
  template: '<a :href="to"><slot /></a>',
});

const mountCases = (locale: "en-US" | "zh-CN") => {
  const i18n = createI18n({
    legacy: false,
    locale,
    fallbackLocale: "en-US",
    messages: { "en-US": enUS, "zh-CN": zhCN },
  });
  return mount(ChatCases, {
    global: {
      plugins: [i18n],
      stubs: { RouterLink: RouterLinkStub },
    },
  });
};

describe("ChatCases", () => {
  it("renders every routed case in registry order without role props", () => {
    const wrapper = mountCases("en-US");
    const links = wrapper.findAll('[data-testid="chat-case-link"]');

    expect(wrapper.props()).toEqual({});
    expect(links).toHaveLength(7);
    expect(links.map((link) => link.attributes("href"))).toEqual(routes);
    expect(links.map((link) => link.text())).toEqual(enTitles);
  });

  it("uses Chinese page titles without leaking English registry names", () => {
    const wrapper = mountCases("zh-CN");
    const links = wrapper.findAll('[data-testid="chat-case-link"]');

    expect(wrapper.get("h2").text()).toBe("智能体案例");
    expect(links.map((link) => link.text())).toEqual(zhTitles);
    expect(wrapper.text()).not.toContain("Knowledge Agent");
    expect(wrapper.text()).not.toContain("Deep Genome Agent");
  });
});
