import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import enUS from "@/locales/langs/en-US";
import zhCN from "@/locales/langs/zh-CN";

const routerBack = vi.hoisted(() => vi.fn());

const SAMPLE_QUESTION =
  'Your data is {"/obs/phytomni/agent_data/raw_data/04.benchmark_data/07.testbenchmark/epigenetic/callpeak/data1_1.fq.gz": "pair-end 1 chip-seq data for rice", "/obs/phytomni/agent_data/raw_data/04.benchmark_data/07.testbenchmark/epigenetic/callpeak/data1_2.fq.gz": "pair-end 2 chip-seq data for rice", "/obs/phytomni/agent_data/raw_data/04.benchmark_data/07.testbenchmark/epigenetic/callpeak/NIP_genome_final.fa": "rice genome fasta file"}, please help me to perform the callpeak analysis.';

vi.mock("vue-router", () => ({
  useRouter: () => ({ back: routerBack }),
}));

vi.mock("vue-element-plus-x", () => ({
  Typewriter: { name: "Typewriter", template: "<div />" },
}));

const AgentDemoShellStub = {
  props: ["title", "subtitle"],
  emits: ["back"],
  template: `
    <div data-test="demo-shell">
      <span data-test="agent-demo-static-badge">Static example</span>
      <button data-test="shell-back" @click="$emit('back')">Back</button>
      <slot name="question" />
      <slot name="result" />
      <slot name="footer" />
    </div>
  `,
};

const i18n = createI18n({
  legacy: false,
  locale: "en-US",
  messages: { "en-US": enUS, "zh-CN": zhCN },
});

import AnalystAgent from "@/views/analyst-agent/AnalystAgentView.vue";

const ANALYST_AGENT_SOURCE = readFileSync(
  resolve(__dirname, "../../../src/views/analyst-agent/AnalystAgentView.vue"),
  "utf8"
);

function mountDemo() {
  return mount(AnalystAgent, {
    global: {
      plugins: [i18n, ElementPlus],
      stubs: { AgentDemoShell: AgentDemoShellStub },
    },
  });
}

describe("Analyst Agent static demonstration", () => {
  it("wraps long task identifiers within a shrinkable result column", () => {
    expect(ANALYST_AGENT_SOURCE).toContain("overflow-wrap: anywhere;");
    expect(ANALYST_AGENT_SOURCE).toContain(
      "grid-template-columns: minmax(0, 1fr);"
    );
  });

  it("discloses the sample question, task ID, and result without live status claims", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const wrapper = mountDemo();

    expect(wrapper.get("[data-test=agent-demo-static-badge]").text()).toContain(
      "Static example"
    );
    expect(wrapper.get("[data-test=analyst-question]").text()).toBe(
      SAMPLE_QUESTION
    );
    expect(SAMPLE_QUESTION).toContain(
      '{"/obs/phytomni/agent_data/raw_data/04.benchmark_data/07.testbenchmark/epigenetic/callpeak/data1_1.fq.gz":'
    );
    expect(wrapper.get("[data-test=analyst-task-label]").text()).toContain(
      "4a7715a-996a-22e0-acd5-fb278e7d45b3"
    );
    expect(wrapper.get("[data-test=analyst-result-label]").text()).toContain(
      "Static sample result"
    );
    expect(wrapper.text()).not.toMatch(
      /created successfully|completed|progress|loading/i
    );
    const progressNodes = wrapper
      .findAll("[data-test], [aria-label]")
      .filter((node) =>
        /progress/i.test(
          `${node.attributes("data-test") ?? ""} ${
            node.attributes("aria-label") ?? ""
          }`
        )
      );
    expect(progressNodes).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("keeps the bundled download target, filename, cleanup, and keyboard activation", async () => {
    const appendSpy = vi.spyOn(document.body, "appendChild");
    const removeSpy = vi.spyOn(document.body, "removeChild");
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const wrapper = mountDemo();
    const download = wrapper.get("[data-test=analyst-download]");

    await download.trigger("click");
    await download.trigger("keydown.enter");

    const anchors = appendSpy.mock.calls
      .map(([node]) => node)
      .filter(
        (node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement
      );
    const anchor = anchors.at(-1);
    expect(anchor).toBeDefined();
    expect(anchor?.getAttribute("href")).toBe(
      "/static/downloads/3.Analyst Agent/1.AnalystAgent/results/callpeak_results.zip"
    );
    expect(anchor?.download).toBe("callpeak_results.zip");
    expect(clickSpy).toHaveBeenCalledTimes(2);
    expect(removeSpy).toHaveBeenCalledWith(anchor);
  });

  it("keeps Back navigation and avoids legacy chat chrome", async () => {
    routerBack.mockReset();
    const wrapper = mountDemo();

    expect(
      wrapper.findAll(".chat-header, .chat-messages, .message-avatar")
    ).toHaveLength(0);
    expect(wrapper.find("[data-test=analyst-question]").classes()).toEqual([]);
    expect(wrapper.find("[data-test=analyst-result]").classes()).toContain(
      "analyst-result"
    );
    expect(wrapper.findAll(".analyst-message")).toHaveLength(0);

    await wrapper.get("[data-test=shell-back]").trigger("click");
    expect(routerBack).toHaveBeenCalledTimes(1);
  });
});
