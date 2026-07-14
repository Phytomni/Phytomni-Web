import { afterEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import enUS from "@/locales/langs/en-US";
import zhCN from "@/locales/langs/zh-CN";

const routerBack = vi.hoisted(() => vi.fn());

const GENE_NETWORK_QUESTION =
  "Please help me to analysis the hormone regulatory network in the traits of TO:0000011";
const GENE_NETWORK_TASK_ID = "8ab4434b-772a-44f0-aaa5-fa163e7f84a3";
const GENE_NETWORK_BASE_PATH =
  "/static/downloads/5.Gene Netwrok Agent/3.NetwrokAgent/results/";
const GENE_NETWORK_FILES = [
  "network_results.zip.001",
  "network_results.zip.002",
  "network_results.zip.003",
  "network_results.zip.004",
  "network_results.zip.005",
] as const;

const DIGITAL_DESIGN_QUESTION =
  "Please help me design the protein structure based on evolution information for gene Os01g0177400.";
const DIGITAL_DESIGN_TASK_ID = "3b5564b-772a-44f0-abc5-fb163e7d13c4";
const DIGITAL_DESIGN_HREF =
  "/static/downloads/7.Digital Design Agent/2.DigitalAgent/results/design_results.zip";

vi.mock("vue-router", () => ({
  useRouter: () => ({ back: routerBack }),
}));

const AgentDemoShellStub = {
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

import GeneNetworkAgent from "@/views/gene-network-agent/index.vue";
import DigitalDesignAgent from "@/views/digital-design-agent/index.vue";

function mountDemo(component: typeof GeneNetworkAgent | typeof DigitalDesignAgent) {
  return mount(component, {
    global: {
      plugins: [i18n, ElementPlus],
      stubs: { AgentDemoShell: AgentDemoShellStub },
    },
  });
}

afterEach(() => {
  vi.useRealTimers();
  routerBack.mockReset();
});

describe("media agent static demonstrations", () => {
  it("keeps exact questions, task IDs, static labels, and shared shell ownership", () => {
    const geneWrapper = mountDemo(GeneNetworkAgent);
    const digitalWrapper = mountDemo(DigitalDesignAgent);

    expect(geneWrapper.get("[data-test=agent-demo-static-badge]").text()).toBe(
      "Static example"
    );
    expect(geneWrapper.get("[data-test=gene-network-question]").text()).toBe(
      GENE_NETWORK_QUESTION
    );
    expect(geneWrapper.get("[data-test=gene-network-task]").text()).toContain(
      GENE_NETWORK_TASK_ID
    );
    expect(geneWrapper.get("[data-test=gene-network-result-label]").text()).toBe(
      "Static sample result"
    );

    expect(digitalWrapper.get("[data-test=agent-demo-static-badge]").text()).toBe(
      "Static example"
    );
    expect(digitalWrapper.get("[data-test=digital-design-question]").text()).toBe(
      DIGITAL_DESIGN_QUESTION
    );
    expect(digitalWrapper.get("[data-test=digital-design-task]").text()).toContain(
      DIGITAL_DESIGN_TASK_ID
    );
    expect(
      digitalWrapper.get("[data-test=digital-design-result-label]").text()
    ).toBe("Static sample result");

    for (const wrapper of [geneWrapper, digitalWrapper]) {
      expect(
        wrapper.findAll(".chat-header, .chat-messages, .message-avatar, .message-content")
      ).toHaveLength(0);
      expect(wrapper.findAll("[role=progressbar]")).toHaveLength(0);
      expect(wrapper.text()).not.toMatch(/created successfully|completed|downloading|progress|percent|eta/i);
    }
  });

  it("starts each Gene Network part one second apart and reports request starts only", async () => {
    vi.useFakeTimers();
    const appendSpy = vi.spyOn(document.body, "appendChild");
    const removeSpy = vi.spyOn(document.body, "removeChild");
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const wrapper = mountDemo(GeneNetworkAgent);

    await wrapper.get("[data-test=gene-network-download]").trigger("click");
    expect(wrapper.get("[data-test=gene-network-download-status]").text()).toBe(
      "Starting download 1 of 5"
    );
    expect(wrapper.get("[data-test=gene-network-current-file]").text()).toBe(
      GENE_NETWORK_FILES[0]
    );
    expect(clickSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(0);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(wrapper.get("[data-test=gene-network-current-file]").text()).toBe(
      GENE_NETWORK_FILES[0]
    );

    await vi.advanceTimersByTimeAsync(999);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(clickSpy).toHaveBeenCalledTimes(2);
    expect(wrapper.get("[data-test=gene-network-download-status]").text()).toBe(
      "Starting download 2 of 5"
    );
    expect(wrapper.get("[data-test=gene-network-current-file]").text()).toBe(
      GENE_NETWORK_FILES[1]
    );

    await vi.advanceTimersByTimeAsync(3000);
    expect(clickSpy).toHaveBeenCalledTimes(5);
    expect(wrapper.get("[data-test=gene-network-download-status]").text()).toBe(
      "All five download requests started"
    );
    expect(wrapper.get("[data-test=gene-network-current-file]").text()).toBe(
      GENE_NETWORK_FILES[4]
    );
    expect(wrapper.findAll("[role=progressbar]")).toHaveLength(0);
    expect(wrapper.text()).not.toMatch(/finished|downloaded|percent|eta|progress/i);

    const anchors = appendSpy.mock.calls
      .map(([node]) => node)
      .filter((node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement);
    expect(anchors.map((anchor) => anchor.getAttribute("href"))).toEqual(
      GENE_NETWORK_FILES.map((file) => GENE_NETWORK_BASE_PATH + file)
    );
    expect(anchors.map((anchor) => anchor.download)).toEqual([...GENE_NETWORK_FILES]);
    expect(removeSpy.mock.calls.map(([node]) => node)).toEqual(anchors);
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
    appendSpy.mockRestore();
    removeSpy.mockRestore();
    clickSpy.mockRestore();
  });

  it("preserves the Digital Design static target, DOM cleanup, keyboard activation, and Back", async () => {
    const appendSpy = vi.spyOn(document.body, "appendChild");
    const removeSpy = vi.spyOn(document.body, "removeChild");
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const wrapper = mountDemo(DigitalDesignAgent);

    const download = wrapper.get("[data-test=digital-design-download]");
    await download.trigger("click");
    await download.trigger("keydown.enter");

    const anchors = appendSpy.mock.calls
      .map(([node]) => node)
      .filter((node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement);
    expect(anchors).toHaveLength(2);
    expect(anchors.every((anchor) => anchor.getAttribute("href") === DIGITAL_DESIGN_HREF)).toBe(
      true
    );
    expect(anchors.every((anchor) => anchor.download === "design_results.zip")).toBe(true);
    expect(clickSpy).toHaveBeenCalledTimes(2);
    expect(removeSpy.mock.calls.map(([node]) => node)).toEqual(anchors);
    expect(fetchSpy).not.toHaveBeenCalled();

    await wrapper.get("[data-test=shell-back]").trigger("click");
    expect(routerBack).toHaveBeenCalledTimes(1);

    fetchSpy.mockRestore();
    appendSpy.mockRestore();
    removeSpy.mockRestore();
    clickSpy.mockRestore();
  });
});
