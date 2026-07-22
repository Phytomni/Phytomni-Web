import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import enUS from "@/locales/langs/en-US";
import zhCN from "@/locales/langs/zh-CN";

const routerBack = vi.hoisted(() => vi.fn());

vi.mock("vue-router", () => ({
  useRouter: () => ({ back: routerBack }),
}));

vi.mock("vue-element-plus-x", () => ({
  Typewriter: { name: "Typewriter", template: "<div />" },
}));

import KnowledgeAgent from "@/views/knowledge-agent/KnowledgeAgentView.vue";
import BriefGeneAgent from "@/views/brief-gene-agent/BriefGeneAgentView.vue";

const i18n = createI18n({
  legacy: false,
  locale: "en-US",
  messages: { "en-US": enUS, "zh-CN": zhCN },
});

function mountDemo(component: typeof KnowledgeAgent | typeof BriefGeneAgent) {
  return mount(component, {
    global: {
      plugins: [i18n],
      stubs: {
        AgentDemoShell: {
          emits: ["back"],
          template: `
            <div data-test="demo-shell">
              <button data-test="shell-back" @click="$emit('back')">Back</button>
              <slot name="question" />
              <slot name="result" />
              <slot name="footer" />
            </div>
          `,
        },
        CitedAnswer: {
          props: ["content", "references", "ns", "surface"],
          template: `
            <div
              data-test="cited-answer"
              :data-ns="ns"
              :data-surface="surface"
              :data-reference-count="references?.length ?? 0"
            >{{ content }}</div>
          `,
        },
      },
    },
  });
}

describe("cited agent demonstrations", () => {
  it.each([
    [KnowledgeAgent, "kb", "20", "epigenetic modifications"],
    [BriefGeneAgent, "bg", "17", "single-cell RNA sequencing"],
  ])(
    "keeps the %s cited report in the shared static shell",
    async (component, namespace, referenceCount, contentMarker) => {
      routerBack.mockReset();
      const wrapper = mountDemo(component);

      expect(wrapper.findAll("[data-test=cited-answer]")).toHaveLength(1);
      const cited = wrapper.get("[data-test=cited-answer]");
      expect(cited.attributes("data-ns")).toBe(namespace);
      expect(cited.attributes("data-surface")).toBe("artifact");
      expect(cited.attributes("data-reference-count")).toBe(referenceCount);
      expect(cited.text().toLowerCase()).toContain(contentMarker.toLowerCase());
      expect(
        wrapper.findAll(".chat-header, .chat-messages, .message-avatar")
      ).toHaveLength(0);

      await wrapper.get("[data-test=shell-back]").trigger("click");
      expect(routerBack).toHaveBeenCalledTimes(1);
    }
  );
});
