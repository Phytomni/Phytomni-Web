import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import ChatAgentQuickSelect from "@/views/chat/components/ChatAgentQuickSelect.vue";

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
  it("renders only supplied authorized options in order", () => {
    const wrapper = mountQuickSelect();
    const buttons = wrapper.findAll(
      '[data-testid="chat-agent-quick-option"]'
    );
    expect(buttons).toHaveLength(2);
    expect(buttons.map((button) => button.text())).toEqual([
      "Chat Agent",
      "Deep Genome Agent",
    ]);
  });

  it("marks the selected tool and emits a toggle for the clicked tool", async () => {
    const wrapper = mountQuickSelect({ selectedAgent: "DeepGenomeAgent" });
    const buttons = wrapper.findAll(
      '[data-testid="chat-agent-quick-option"]'
    );
    expect(buttons[0].attributes("aria-pressed")).toBe("false");
    expect(buttons[1].attributes("aria-pressed")).toBe("true");

    await buttons[1].trigger("click");
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
