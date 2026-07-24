import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mount } from "@vue/test-utils";
import AgentCapabilityPopover from "@/components/agent/AgentCapabilityPopover.vue";
import ChatAgentQuickSelect from "@/views/chat/components/ChatAgentQuickSelect.vue";

const QUICK_SELECT_SOURCE = readFileSync(
  resolve(
    __dirname,
    "../../src/views/chat/components/ChatAgentQuickSelect.vue"
  ),
  "utf8"
);

const options = [
  {
    tool: "ChatAgent",
    label: "Chat Agent",
    labelKey: "chat.agents.chatAgent",
  },
  {
    tool: "DeepGenomeAgent",
    label: "Deep Genome Agent",
    labelKey: "chat.agents.deepGenomeAgent",
  },
  {
    tool: "InSilicoResearchAgent",
    label: "In Silico Research Agent",
    labelKey: "chat.agents.inSilicoResearchAgent",
  },
];

const mountQuickSelect = (props: Record<string, unknown> = {}) =>
  mount(ChatAgentQuickSelect, {
    props: {
      options,
      rolesLoading: false,
      selectedAgent: "",
      disabled: false,
      ...props,
    },
    global: {
      mocks: { $t: (key: string) => key },
    },
  });

describe("ChatAgentQuickSelect", () => {
  it("keeps the mobile rail touch-scrollable without native scrollbar chrome", () => {
    expect(QUICK_SELECT_SOURCE).toMatch(
      /@media \(max-width: 599px\)[\s\S]*?\.agent-quick-list\s*\{[\s\S]*?overflow-x:\s*auto;[\s\S]*?scrollbar-width:\s*none;/
    );
    expect(QUICK_SELECT_SOURCE).toMatch(
      /\.agent-quick-list::-webkit-scrollbar\s*\{[\s\S]*?display:\s*none;/
    );
  });

  it("renders only supplied authorized options in order", () => {
    const wrapper = mountQuickSelect();
    const buttons = wrapper.findAll('[data-testid="chat-agent-quick-option"]');
    expect(buttons).toHaveLength(3);
    expect(buttons.map((button) => button.text())).toEqual([
      "Chat Agent",
      "Deep Genome Agent",
      "In Silico Research Agent",
    ]);
  });

  it("italicizes only In Silico in direct selection", () => {
    const wrapper = mountQuickSelect();
    const option = wrapper
      .findAll('[data-testid="chat-agent-quick-option"]')
      .find((button) => button.text() === "In Silico Research Agent");
    expect(option).toBeTruthy();
    expect(option?.get("em").text()).toBe("In Silico");
    expect(option?.get("em").text()).not.toContain("Research Agent");
  });

  it("marks the selected tool and emits a toggle for the clicked tool", async () => {
    const wrapper = mountQuickSelect({ selectedAgent: "DeepGenomeAgent" });
    const buttons = wrapper.findAll('[data-testid="chat-agent-quick-option"]');
    expect(buttons[0].attributes("aria-pressed")).toBe("false");
    expect(buttons[1].attributes("aria-pressed")).toBe("true");

    await buttons[1].trigger("click");
    expect(wrapper.emitted("toggle")?.[0]).toEqual(["DeepGenomeAgent"]);
  });

  it("maps each permitted option to its capability preview without changing toggle values", async () => {
    const wrapper = mountQuickSelect({ selectedAgent: "DeepGenomeAgent" });
    const previews = wrapper.findAllComponents(AgentCapabilityPopover);
    expect(previews).toHaveLength(3);
    expect(
      previews.map((preview) => preview.props("presentation").tool)
    ).toEqual(options.map((option) => option.tool));

    const trigger = wrapper
      .findAll('[data-testid="chat-agent-quick-option"]')
      .find((button) => button.text() === "Deep Genome Agent");
    expect(trigger).toBeTruthy();
    await trigger?.trigger("focus");
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
    await trigger?.trigger("click");
    expect(wrapper.emitted("toggle")?.[0]).toEqual(["DeepGenomeAgent"]);
  });

  it("shows loading without leaking option names", () => {
    const wrapper = mountQuickSelect({ rolesLoading: true });
    expect(wrapper.find('[role="status"]').text()).toContain(
      "chat.agentPicker.loading"
    );
    expect(
      wrapper.findAll('[data-testid="chat-agent-quick-option"]')
    ).toHaveLength(0);
    expect(wrapper.text()).not.toContain("Deep Genome Agent");
  });

  it("shows the localized empty state when no agent is granted", () => {
    const wrapper = mountQuickSelect({ options: [] });
    expect(wrapper.find('[role="status"]').text()).toContain(
      "chat.agentPicker.empty"
    );
  });

  it("disables every option while sending", () => {
    const wrapper = mountQuickSelect({ disabled: true });
    for (const button of wrapper.findAll("button")) {
      expect(button.attributes()).toHaveProperty("disabled");
    }
  });

  it("updates localized labels without changing the selected command value", async () => {
    const wrapper = mountQuickSelect({ selectedAgent: "ChatAgent" });
    await wrapper.setProps({
      options: [
        {
          tool: "ChatAgent",
          label: "对话智能体",
          labelKey: "chat.agents.chatAgent",
        },
      ],
    });

    const button = wrapper.get('[data-testid="chat-agent-quick-option"]');
    expect(button.text()).toBe("对话智能体");
    expect(button.attributes("aria-pressed")).toBe("true");
    expect(wrapper.emitted("toggle")).toBeUndefined();
  });
});
