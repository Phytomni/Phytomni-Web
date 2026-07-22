import { describe, expect, it } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import ChatAgentPicker from "@/views/chat/components/ChatAgentPicker.vue";
import { CANONICAL_AGENT_TOOLS } from "@/constants/agents";

const allTools = [...CANONICAL_AGENT_TOOLS];

const makeOptions = (tools: string[]) =>
  tools.map((tool) => ({
    tool,
    label: tool,
    labelKey: `chat.agents.${tool.charAt(0).toLowerCase()}${tool.slice(1)}`,
  }));

const mountPicker = (props: Record<string, unknown> = {}) =>
  mount(ChatAgentPicker, {
    props: {
      options: makeOptions(allTools),
      rolesLoading: false,
      selectedAgent: "",
      disabled: false,
      ...props,
    },
    global: {
      mocks: {
        $t: (key: string) => `t:${key}`,
      },
    },
  });

describe("ChatAgentPicker", () => {
  it("renders a combobox with listbox semantics", async () => {
    const wrapper = mountPicker();
    const combobox = wrapper.find('[role="combobox"]');
    expect(combobox.exists()).toBe(true);
    expect(combobox.attributes("aria-expanded")).toBe("false");
    expect((combobox.element as HTMLInputElement).value).toBe("ChatAgent");

    await wrapper.find('[data-testid="agent-picker-trigger"]').trigger("click");
    await nextTick();

    expect(combobox.attributes("aria-expanded")).toBe("true");
    expect(combobox.attributes("aria-autocomplete")).toBe("list");
    expect((combobox.element as HTMLInputElement).value).toBe("");
    expect(wrapper.find('[role="listbox"]').exists()).toBe(true);
    const options = wrapper.findAll('[role="option"]');
    expect(options).toHaveLength(allTools.length);
  });

  it("formats closed and list labels without changing combobox value", async () => {
    const option = {
      tool: "InSilicoResearchAgent",
      label: "In Silico Research Agent",
      labelKey: "chat.agentLabels.inSilicoResearchAgent",
    };
    const wrapper = mountPicker({
      options: [option],
      selectedAgent: "InSilicoResearchAgent",
    });
    const input = wrapper.get('[role="combobox"]');

    expect((input.element as HTMLInputElement).value).toBe(
      "In Silico Research Agent"
    );
    expect(input.classes()).toContain("has-display-label");
    expect(wrapper.get(".picker-display-label em").text()).toBe("In Silico");

    await input.trigger("click");
    await nextTick();
    expect(wrapper.find(".picker-display-label").exists()).toBe(false);
    expect(input.classes()).not.toContain("has-display-label");
    expect(wrapper.get('[role="option"] em').text()).toBe("In Silico");
  });

  it("shows localized loading state while rolesLoading", () => {
    const wrapper = mountPicker({ rolesLoading: true, options: [] });
    expect(wrapper.text()).toContain("chat.agentPicker.loading");
    expect(wrapper.find('[role="combobox"]').exists()).toBe(false);
  });

  it("shows localized empty state when the permitted intersection is empty", () => {
    const wrapper = mountPicker({ options: [] });
    expect(wrapper.text()).toContain("chat.agentPicker.empty");
    expect(wrapper.find('[role="combobox"]').exists()).toBe(false);
  });

  it("emits select with @tool, command on Enter", async () => {
    const wrapper = mountPicker();
    const combobox = wrapper.find('[role="combobox"]');
    await combobox.trigger("click");
    await nextTick();

    await combobox.trigger("keydown", { key: "Enter" });

    expect(wrapper.emitted("select")?.[0]).toEqual(["@ChatAgent,"]);
  });

  it("moves active option with ArrowDown/ArrowUp and Home/End", async () => {
    const wrapper = mountPicker();
    const combobox = wrapper.find('[role="combobox"]');
    await combobox.trigger("click");
    await nextTick();

    await combobox.trigger("keydown", { key: "End" });
    expect(combobox.attributes("aria-activedescendant")).toContain(
      `agent-option-${allTools.length - 1}`
    );

    await combobox.trigger("keydown", { key: "Home" });
    expect(combobox.attributes("aria-activedescendant")).toContain(
      "agent-option-0"
    );

    await combobox.trigger("keydown", { key: "ArrowDown" });
    expect(combobox.attributes("aria-activedescendant")).toContain(
      "agent-option-1"
    );

    await combobox.trigger("keydown", { key: "ArrowUp" });
    expect(combobox.attributes("aria-activedescendant")).toContain(
      "agent-option-0"
    );
  });

  it("closes on Escape and restores focus to the combobox trigger", async () => {
    const wrapper = mountPicker();
    const combobox = wrapper.find('[role="combobox"]');
    await combobox.trigger("click");
    await nextTick();
    expect(combobox.attributes("aria-expanded")).toBe("true");

    await combobox.trigger("keydown", { key: "Escape" });
    await flushPromises();
    expect(combobox.attributes("aria-expanded")).toBe("false");
  });

  it("shows a removable chip for the selected agent", async () => {
    const wrapper = mountPicker({ selectedAgent: "KnowledgeAgent" });
    const chip = wrapper.find('[data-testid="agent-picker-chip"]');
    expect(chip.exists()).toBe(true);
    expect((chip.find("input").element as HTMLInputElement).value).toBe(
      "KnowledgeAgent"
    );

    await chip.find('[data-testid="agent-picker-clear"]').trigger("click");
    expect(wrapper.emitted("clear")).toHaveLength(1);
  });

  it("rejects select when disabled while sending", async () => {
    const wrapper = mountPicker({ disabled: true });
    const combobox = wrapper.find('[role="combobox"]');
    expect(combobox.attributes("aria-disabled")).toBe("true");
    await combobox.trigger("click");
    await combobox.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("select")).toBeUndefined();
  });

  it("filters options by search query", async () => {
    const wrapper = mountPicker();
    const combobox = wrapper.find('[role="combobox"]');
    await combobox.trigger("click");
    await combobox.setValue("Data");
    await nextTick();

    const options = wrapper.findAll('[role="option"]');
    expect(options).toHaveLength(1);
    expect(options[0].text()).toContain("DataAgent");
  });

  it("keeps the popover open with a localized no-results state", async () => {
    const wrapper = mountPicker();
    const combobox = wrapper.find('[role="combobox"]');
    await combobox.trigger("click");
    await combobox.setValue("missing-agent");
    await nextTick();

    expect(combobox.attributes("aria-expanded")).toBe("true");
    expect(wrapper.findAll('[role="option"]')).toHaveLength(0);
    expect(wrapper.text()).toContain("chat.agentPicker.noResults");
  });

  it("closes the listbox on blur", async () => {
    const wrapper = mountPicker();
    const combobox = wrapper.find('[role="combobox"]');
    await combobox.trigger("click");
    await nextTick();

    await combobox.trigger("blur");
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(combobox.attributes("aria-expanded")).toBe("false");
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false);
  });

  it("does not emit select for a tool outside the permitted options", async () => {
    const wrapper = mountPicker({
      options: makeOptions(["ChatAgent"]),
    });
    await wrapper.vm.trySelect("@KnowledgeAgent,");
    expect(wrapper.emitted("select")).toBeUndefined();
  });
});
