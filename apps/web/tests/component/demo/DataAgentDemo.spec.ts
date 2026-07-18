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

const MarkdownViewerStub = {
  props: ["content", "instantMessage", "surface"],
  template: `
    <div
      class="phy-markdown phy-markdown--chat"
      data-test="markdown-result"
      :data-surface="surface"
      :data-instant="String(instantMessage)"
      :data-content="content"
    >
      <table><tbody><tr><td>{{ content }}</td></tr></tbody></table>
    </div>
  `,
};

const AgentDemoShellStub = {
  emits: ["back"],
  template: `
    <div data-test="demo-shell">
      <span data-test="agent-demo-static-badge">Static example</span>
      <button data-test="shell-back" @click="$emit('back')">Back</button>
      <slot name="question" />
      <slot name="result" />
      <slot />
      <slot name="footer" />
    </div>
  `,
};

const i18n = createI18n({
  legacy: false,
  locale: "en-US",
  messages: { "en-US": enUS, "zh-CN": zhCN },
});

function mountDemo() {
  return mount(DataAgent, {
    global: {
      plugins: [i18n],
      stubs: {
        AgentDemoShell: AgentDemoShellStub,
        MarkdownViewer: MarkdownViewerStub,
      },
    },
  });
}

import DataAgent from "@/views/data-agent/index.vue";

describe("Data Agent static demonstration", () => {
  it("keeps the three sample rounds in their exact order", () => {
    const wrapper = mountDemo();
    const rounds = wrapper.findAll("[data-test=data-agent-round]");

    expect(rounds).toHaveLength(3);
    expect(
      rounds.map((round) => round.get("[data-test=data-agent-question]").text())
    ).toEqual([
      "Please list the transcript ID of Os01g0177400 in rice.",
      "How many bases does the CDS sequence of rice transcript Os01t0177400-01 contain?",
      "List the homologous genes of rice Os01g0177400 in maize.",
    ]);

    expect(
      rounds.map((round) =>
        round.get("[data-test=markdown-result]").attributes("data-content")
      )
    ).toEqual([
      "|  Transcript ID  |\n| :-------------: |\n| Os01t0177400-01 |\n",
      "| LENGTH([sequence_2]) |\n| :------------------: |\n|         1113         |",
      "| Query Gene ID | Query Species | Homology Gene ID | Homology Species |\n| ------------- | :-----------: | :--------------: | :--------------: |\n| Os01g0177400  |      osa      | Zm00001eb122500  |       zma        |",
    ]);
  });

  it("uses the static shell, chat Markdown surface, and accessible table regions", () => {
    const wrapper = mountDemo();

    expect(wrapper.get("[data-test=agent-demo-static-badge]").text()).toContain(
      "Static example"
    );
    expect(wrapper.findAll("[data-test=data-agent-table-scroll]")).toHaveLength(
      3
    );
    expect(wrapper.findAll("figcaption")).toHaveLength(3);

    wrapper
      .findAll("[data-test=data-agent-table-scroll]")
      .forEach((region, index) => {
        const caption = wrapper.findAll("figcaption")[index];
        expect(region.attributes("aria-labelledby")).toBe(
          caption.attributes("id")
        );
        expect(
          region.find(".phy-markdown--chat").attributes("data-surface")
        ).toBe("chat");
        expect(
          region.find(".phy-markdown--chat").attributes("data-instant")
        ).toBe("true");
      });
  });

  it("keeps navigation and static-only controls honest", async () => {
    routerBack.mockReset();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const wrapper = mountDemo();

    await wrapper.get("[data-test=shell-back]").trigger("click");
    expect(routerBack).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(
      wrapper.findAll("[data-test*=progress], [aria-label*=progress i]")
    ).toHaveLength(0);
    expect(wrapper.findAll("button")).toHaveLength(1);
    expect(wrapper.text()).not.toMatch(/export|download|loading/i);

    fetchSpy.mockRestore();
  });
});
