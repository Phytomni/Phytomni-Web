import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config, enableAutoUnmount, mount } from "@vue/test-utils";
import { defineComponent, nextTick } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import enUS from "@/locales/langs/en-US";
import zhCN from "@/locales/langs/zh-CN";

const mocks = vi.hoisted(() => ({
  back: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  getToken: vi.fn(() => "token"),
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({
    back: mocks.back,
    push: mocks.push,
    replace: mocks.replace,
  }),
}));
vi.mock("@/utils/auth", () => ({ getToken: mocks.getToken }));
vi.mock("vue-element-plus-x", () => ({
  Typewriter: { name: "Typewriter", template: "<div />" },
}));

import HelpPage from "@/views/help/HelpView.vue";

const i18n = createI18n({
  legacy: false,
  locale: "en-US",
  fallbackLocale: "en-US",
  messages: { "en-US": enUS, "zh-CN": zhCN },
});

const MarkdownStub = defineComponent({
  name: "MarkdownViewer",
  props: {
    content: { type: String, required: true },
    surface: { type: String, default: "legacy" },
  },
  template:
    '<div class="markdown-test" :data-surface="surface">{{ content }}</div>',
});

config.global.plugins = [i18n, ElementPlus];
enableAutoUnmount(afterEach);

const mountHelp = () =>
  mount(HelpPage, {
    attachTo: document.body,
    global: {
      stubs: {
        LangSwitch: { template: '<div data-test="lang-switch" />' },
        MarkdownViewer: MarkdownStub,
        PhyPageHeader: {
          template:
            '<header class="page-header-test"><slot name="actions" /></header>',
        },
      },
    },
  });

describe("Help product document", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    i18n.global.locale.value = "en-US";
    mocks.getToken.mockReturnValue("token");
  });

  it("keeps the five section ids, locale bodies, and document Markdown surface", () => {
    const wrapper = mountHelp();
    const ids = wrapper
      .findAll(".help-section")
      .map((section) => section.attributes("id"));
    expect(ids).toEqual([
      "what-is-phytomni",
      "getting-started",
      "how-it-works",
      "resources",
      "limitations",
    ]);

    const bodies = wrapper
      .findAllComponents(MarkdownStub)
      .map((markdown) => markdown.props("content"));
    expect(bodies).toEqual([
      enUS.help.doc.whatIs.body,
      enUS.help.doc.gettingStarted.body,
      enUS.help.doc.howItWorks.body,
      enUS.help.doc.resources.body,
      enUS.help.doc.limitations.body,
    ]);
    expect(wrapper.findAll('[data-surface="document"]')).toHaveLength(5);
  });

  it("keeps TOC targets and moves focus after keyboard activation", async () => {
    const wrapper = mountHelp();
    const scrollRoot = wrapper.find(".help-page").element as HTMLElement & {
      scrollTo: ReturnType<typeof vi.fn>;
    };
    scrollRoot.scrollTo = vi.fn();
    const target = wrapper.find("#resources h1").element as HTMLElement;
    const focus = vi.spyOn(target, "focus");

    const link = wrapper.find('[data-section-id="resources"]');
    await link.trigger("keydown", { key: "Enter" });

    expect(scrollRoot.scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: "smooth" })
    );
    expect(focus).toHaveBeenCalled();
    expect(link.classes()).toContain("active");
  });

  it("updates the TOC and document bodies on an in-place locale switch", async () => {
    const wrapper = mountHelp();
    i18n.global.locale.value = "zh-CN";
    await nextTick();

    expect(wrapper.find(".toc-title").text()).toBe("目录");
    expect(wrapper.find("#what-is-phytomni h1").text()).toBe(
      zhCN.help.doc.whatIs.heading
    );
    expect(wrapper.findAllComponents(MarkdownStub)[0].props("content")).toBe(
      zhCN.help.doc.whatIs.body
    );
  });

  it("documents all ten agents and distinguishes general attachments from dataset channels", () => {
    const english = enUS.help.doc.howItWorks.body;
    for (const agent of [
      "Chat Agent",
      "Knowledge Agent",
      "Data Agent",
      "Analyst Agent",
      "Review Agent",
      "In Silico",
      "Gene Network Agent",
      "Brief Gene Agent",
      "Deep Genome Agent",
      "Digital Design Agent",
    ]) {
      expect(english).toContain(agent);
    }
    expect(english).toContain("CSV is not a universal chat attachment format");
    expect(english).toContain("Best starting input");
    expect(english).toContain("***In Silico* Research Agent:**");
    expect(english).not.toContain("**In Silico Research Agent:**");
    expect(enUS.chat.agentLabels.inSilicoResearchAgent).toBe(
      "In Silico Research Agent"
    );
    expect(enUS.agents.research.title).toBe("In Silico Research Agent");

    const chinese = zhCN.help.doc.howItWorks.body;
    for (const agent of [
      "对话智能体",
      "知识智能体",
      "数据智能体",
      "分析智能体",
      "综述智能体",
      "虚拟研究智能体",
      "基因网络智能体",
      "基因综述智能体",
      "基因深度分析智能体",
      "智能设计智能体",
    ]) {
      expect(chinese).toContain(agent);
    }
    expect(chinese).toContain("CSV 不是所有对话智能体通用的附件格式");
    expect(chinese).toContain("推荐起始输入");
  });

  it("keeps token-aware back branches and one flowing footer in the help scroll root", async () => {
    const wrapper = mountHelp();
    expect(
      wrapper.find(".help-header-actions [data-test=lang-switch]").exists()
    ).toBe(true);
    expect(wrapper.find(".help-header-actions .back-btn").exists()).toBe(true);
    expect(
      wrapper.find(".help-page").findAll(".footer-container")
    ).toHaveLength(1);
    expect(
      wrapper
        .find(".help-page")
        .element.contains(wrapper.find(".help-page .footer-container").element)
    ).toBe(true);

    await wrapper.find(".back-btn").trigger("click");
    expect(mocks.back).toHaveBeenCalledTimes(1);

    mocks.getToken.mockReturnValue(undefined);
    await wrapper.find(".back-btn").trigger("click");
    expect(mocks.replace).toHaveBeenCalledWith("/login");
  });

  it("cleans the scroll listener when unmounted", () => {
    const remove = vi.spyOn(HTMLElement.prototype, "removeEventListener");
    const wrapper = mountHelp();
    wrapper.unmount();
    expect(remove).toHaveBeenCalledWith("scroll", expect.any(Function));
  });
});
