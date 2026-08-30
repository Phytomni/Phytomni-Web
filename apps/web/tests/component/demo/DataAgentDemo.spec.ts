import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mountWithApp } from "../../helpers/test-app-context";

const routerBack = vi.hoisted(() => vi.fn());

vi.mock("vue-router", () => ({
  useRouter: () => ({ back: routerBack }),
}));

const ScientificMarkdownStub = {
  props: ["source", "surface"],
  template: `
    <div
      class="phy-markdown phy-markdown--chat"
      data-test="markdown-result"
      :data-surface="surface"
      :data-content="source"
    >
      <table><tbody><tr><td>{{ source }}</td></tr></tbody></table>
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

function mountDemo() {
  return mountWithApp(DataAgent, {
    global: {
      stubs: {
        AgentDemoShell: AgentDemoShellStub,
        ScientificMarkdown: ScientificMarkdownStub,
      },
    },
  });
}

import DataAgent from "@/views/data-agent/DataAgentView.vue";

const DATA_AGENT_SOURCE = readFileSync(
  resolve(__dirname, "../../../src/views/data-agent/DataAgentView.vue"),
  "utf8"
);

describe("Data Agent static demonstration", () => {
  it("keeps result columns shrinkable while table overflow stays local", () => {
    expect(DATA_AGENT_SOURCE).toContain(
      "grid-template-columns: minmax(0, 1fr);"
    );
    expect(DATA_AGENT_SOURCE).toContain("overflow-x: auto;");
    expect(DATA_AGENT_SOURCE).not.toContain("citation-namespace");
  });

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
      "| CDS length (bp) |\n| :-------------: |\n|      1113       |",
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
      });
  });

  it("keeps navigation and static-only controls honest", async () => {
    routerBack.mockReset();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const wrapper = mountDemo();

    await wrapper.get("[data-test=shell-back]").trigger("click");
    expect(routerBack).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
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
    expect(wrapper.findAll("button")).toHaveLength(1);
    expect(wrapper.text()).not.toMatch(/export|download|loading/i);

    fetchSpy.mockRestore();
  });
});
