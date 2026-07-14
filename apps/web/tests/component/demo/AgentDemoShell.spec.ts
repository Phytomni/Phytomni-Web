import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import AgentDemoShell from "@/components/demo/AgentDemoShell.vue";
import enUS from "@/locales/langs/en-US";

const i18n = createI18n({
  legacy: false,
  locale: "en-US",
  messages: { "en-US": enUS },
});

describe("AgentDemoShell", () => {
  it("owns the scroll surface, renders slots, and associates static status with the result", async () => {
    const wrapper = mount(AgentDemoShell, {
      props: { title: "Knowledge Agent", subtitle: "A static report" },
      global: { plugins: [i18n, ElementPlus] },
      slots: {
        question: '<p data-test="question">Example question</p>',
        result: '<article data-test="result">Example result</article>',
        footer: '<p data-test="footer">Research note</p>',
      },
    });

    expect(wrapper.attributes("data-scroll-root")).toBe("agent-demo");
    expect(wrapper.get("[data-test=agent-demo-static-badge]").text()).toContain(
      "Static example"
    );
    expect(wrapper.get("[data-test=agent-demo-question]").text()).toContain(
      "Example question"
    );
    expect(wrapper.get("[data-test=agent-demo-result]").text()).toContain(
      "Example result"
    );
    expect(wrapper.get("[data-test=agent-demo-result]").attributes("aria-describedby")).toBe(
      wrapper.get("[data-test=agent-demo-static-badge]").attributes("id")
    );
    expect(wrapper.get("[data-test=footer]").exists()).toBe(true);

    await wrapper.get("[data-test=agent-demo-back]").trigger("click");
    expect(wrapper.emitted("back")).toHaveLength(1);
  });
});
