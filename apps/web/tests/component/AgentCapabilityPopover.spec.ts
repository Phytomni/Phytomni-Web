import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mountWithApp } from "../helpers/test-app-context";
import { nextTick } from "vue";
import AgentCapabilityPopover from "@/components/agent/AgentCapabilityPopover.vue";
import { CANONICAL_AGENT_PRESENTATIONS } from "@/components/agent";

const AGENT_CAPABILITY_POPOVER_SOURCE = readFileSync(
  resolve(__dirname, "../../src/components/agent/AgentCapabilityPopover.vue"),
  "utf8"
);

const t = vi.hoisted(() => {
  const messages: Record<string, string> = {
    "chat.agentLabels.chatAgent": "Chat Agent",
    "chat.agentLabels.deepGenomeAgent": "Deep Genome Agent",
    "chat.agentLabels.briefGeneAgent": "Brief Gene Agent",
    "chat.agents.chatAgent": "Natural-language plant research assistance.",
    "chat.agents.deepGenomeAgent":
      "Plant genome analysis for breeding research.",
    "chat.agents.briefGeneAgent":
      "Creates rapid gene-function briefs and research leads.",
    "chat.agentPresentation.chatAgentAlt": "Chat Agent workflow flowchart",
    "chat.agentPresentation.deepGenomeAgentAlt":
      "Deep Genome Agent workflow flowchart",
    "common.close": "Close",
  };
  return (key: string) => messages[key] ?? key;
});

vi.mock("vue-i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("vue-i18n")>();
  return {
    ...actual,
    useI18n: () => ({ t }),
  };
});

const presentationFor = (tool: keyof typeof CANONICAL_AGENT_PRESENTATIONS) =>
  CANONICAL_AGENT_PRESENTATIONS[tool];

const mountedPopovers: Array<{
  unmount: () => void;
  host: HTMLElement;
}> = [];

const mountPopover = (
  tool: keyof typeof CANONICAL_AGENT_PRESENTATIONS = "ChatAgent"
) => {
  const host = document.createElement("div");
  document.body.append(host);
  const wrapper = mountWithApp(AgentCapabilityPopover, {
    props: { presentation: presentationFor(tool) },
    attachTo: host,
  });
  mountedPopovers.push({ unmount: () => wrapper.unmount(), host });
  return wrapper;
};

afterEach(() => {
  for (const mounted of mountedPopovers.splice(0)) {
    mounted.unmount();
    mounted.host.remove();
  }
});

describe("AgentCapabilityPopover", () => {
  it("resets the desktop top offset for the mobile bottom sheet", () => {
    expect(AGENT_CAPABILITY_POPOVER_SOURCE).toMatch(
      /@media \(max-width: 599px\)[\s\S]*?\.agent-capability-popover\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?top:\s*auto;[\s\S]*?right:\s*0;[\s\S]*?bottom:\s*0;/
    );
  });

  it("opens from keyboard focus and keeps the full flowchart inspectable", async () => {
    const wrapper = mountPopover("DeepGenomeAgent");
    await wrapper.get("button").trigger("focus");

    const panel = wrapper.get('[role="dialog"]');
    expect(panel.attributes("aria-labelledby")).toBeTruthy();
    expect(
      wrapper.get(`#${panel.attributes("aria-labelledby")}`).text()
    ).toContain("Deep Genome Agent");
    expect(wrapper.get("img").attributes("src")).toContain(
      "DeepGenomeAgent.png"
    );
    expect(wrapper.get("img").attributes("alt")).toContain("Deep Genome");
    expect(wrapper.get(".agent-capability-popover__media").classes()).toContain(
      "is-scrollable"
    );
    expect(wrapper.get("button").attributes("aria-expanded")).toBe("true");
    expect(wrapper.get("button").attributes("aria-controls")).toBe(
      panel.attributes("id")
    );
  });

  it("renders BriefGene description without an empty workflow frame", async () => {
    const wrapper = mountPopover("BriefGeneAgent");
    await wrapper.get("button").trigger("focus");

    expect(wrapper.get('[role="dialog"]').text()).toContain("Brief Gene Agent");
    expect(wrapper.get('[role="dialog"]').text()).toContain(
      "rapid gene-function briefs"
    );
    expect(wrapper.find(".agent-capability-popover__media").exists()).toBe(
      false
    );
    expect(wrapper.find("img").exists()).toBe(false);
  });

  it("emits selection on click", async () => {
    const wrapper = mountPopover();
    await wrapper.get("button").trigger("click");
    expect(wrapper.emitted("select")).toHaveLength(1);
  });

  it("closes on Escape and restores focus to the trigger", async () => {
    const wrapper = mountPopover();
    const trigger = wrapper.get("button");
    await trigger.trigger("focus");
    await trigger.trigger("keydown", { key: "Escape" });
    await nextTick();

    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(document.activeElement).toBe(trigger.element);
  });

  it("closes on Escape from dialog content and restores focus to the trigger", async () => {
    const wrapper = mountPopover();
    const trigger = wrapper.get("button");
    await trigger.trigger("focus");
    const closeButton = wrapper.get(".agent-capability-popover__close");
    await closeButton.trigger("focus");
    await closeButton.trigger("keydown", { key: "Escape" });
    await nextTick();

    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(document.activeElement).toBe(trigger.element);
  });

  it("closes outside the trigger and panel", async () => {
    const wrapper = mountPopover();
    await wrapper.get("button").trigger("focus");
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    await nextTick();

    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
  });

  it("keeps the panel open while the pointer crosses from trigger to media", async () => {
    vi.useFakeTimers();
    try {
      const wrapper = mountPopover();
      const trigger = wrapper.get("button");
      await trigger.trigger("pointerenter");
      await trigger.trigger("pointerleave");
      await wrapper.get('[role="dialog"]').trigger("pointerenter");
      await vi.advanceTimersByTimeAsync(200);

      expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a desktop preview inside the viewport near the right edge", async () => {
    const previousWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1024,
    });

    try {
      const wrapper = mountPopover("DeepGenomeAgent");
      const root = wrapper.get(".agent-capability-preview").element;
      vi.spyOn(root, "getBoundingClientRect").mockReturnValue({
        left: 920,
        top: 0,
        right: 980,
        bottom: 32,
        width: 60,
        height: 32,
        x: 920,
        y: 0,
        toJSON: () => ({}),
      });

      await wrapper.get("button").trigger("focus");
      await nextTick();

      const panel = wrapper.get('[role="dialog"]').element;
      vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({
        left: 920,
        top: 40,
        right: 1360,
        bottom: 480,
        width: 440,
        height: 440,
        x: 920,
        y: 40,
        toJSON: () => ({}),
      });
      window.dispatchEvent(new Event("resize"));
      await nextTick();

      expect(panel.style.left).toBe("-352px");
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: previousWidth,
      });
    }
  });

  it("keeps a desktop preview inside the viewport near the bottom edge", async () => {
    const previousWidth = window.innerWidth;
    const previousHeight = window.innerHeight;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1024,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 900,
    });

    try {
      const wrapper = mountPopover("DeepGenomeAgent");
      const root = wrapper.get(".agent-capability-preview").element;
      vi.spyOn(root, "getBoundingClientRect").mockReturnValue({
        left: 120,
        top: 820,
        right: 180,
        bottom: 852,
        width: 60,
        height: 32,
        x: 120,
        y: 820,
        toJSON: () => ({}),
      });

      await wrapper.get("button").trigger("focus");
      await nextTick();

      const panel = wrapper.get('[role="dialog"]').element;
      vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({
        left: 120,
        top: 860,
        right: 560,
        bottom: 1300,
        width: 440,
        height: 440,
        x: 120,
        y: 860,
        toJSON: () => ({}),
      });
      window.dispatchEvent(new Event("resize"));
      await nextTick();

      expect(panel.style.top).toBe("-376px");
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: previousWidth,
      });
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: previousHeight,
      });
    }
  });
});
