import { afterEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import AgentCapabilityPopover from "@/components/agent/AgentCapabilityPopover.vue";
import { CANONICAL_AGENT_PRESENTATIONS } from "@/components/agent";

const t = vi.hoisted(() => {
  const messages: Record<string, string> = {
    "chat.agentLabels.chatAgent": "Chat Agent",
    "chat.agentLabels.deepGenomeAgent": "Deep Genome Agent",
    "chat.agents.chatAgent": "Natural-language plant research assistance.",
    "chat.agents.deepGenomeAgent":
      "Plant genome analysis for breeding research.",
    "chat.agentPresentation.chatAgentAlt": "Chat Agent workflow flowchart",
    "chat.agentPresentation.deepGenomeAgentAlt":
      "Deep Genome Agent workflow flowchart",
    "common.close": "Close",
  };
  return (key: string) => messages[key] ?? key;
});

vi.mock("vue-i18n", () => ({
  useI18n: () => ({ t }),
}));

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
  const wrapper = mount(AgentCapabilityPopover, {
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
});
