import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { ref } from "vue";
import { guardEnterSubmit } from "@/views/chat/utils/guardEnterSubmit";

const mentionExpose = {
  openHeader: vi.fn(),
  closeHeader: vi.fn(),
  popoverVisible: ref(false),
};

vi.mock("vue-element-plus-x", () => ({
  MentionSender: {
    name: "MentionSender",
    inheritAttrs: false,
    template: '<div class="mention-sender-stub" v-bind="$attrs"><slot /></div>',
    props: ["modelValue", "loading", "disabled"],
    setup(_props: unknown, { expose }: { expose: (exposed: Record<string, unknown>) => void }) {
      expose(mentionExpose);
      return {};
    },
  },
  FilesCard: { name: "FilesCard", template: "<div />" },
}));

import ChatComposer from "@/views/chat/components/ChatComposer.vue";

const baseProps = () => ({
  modelValue: "",
  isSending: false,
  chatMode: "instant" as const,
  expertModeEnabled: true,
  showModeSelector: false,
  fileList: [],
  rolesTool: ["RAG"],
  rolesLoading: false,
  hasMessages: false,
  activeButton: "",
  getAgentTooltip: (item: string) => item,
});

describe("guardEnterSubmit at ChatComposer boundary", () => {
  it("swallows Enter in capture phase while mention dropdown is open", async () => {
    mentionExpose.popoverVisible.value = true;
    const wrapper = mount(ChatComposer, {
      props: baseProps(),
      global: {
        stubs: {
          ChatModeSelector: true,
          PhyComposerFrame: { template: "<div><slot /></div>" },
        },
      },
    });

    const stopPropagation = vi.fn();
    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
    Object.defineProperty(event, "stopPropagation", { value: stopPropagation });
    wrapper.find(".mention-sender-stub").element.dispatchEvent(event);
    expect(stopPropagation).toHaveBeenCalled();
  });

  it("allows Enter when popoverVisible is false on the exposed handle", () => {
    const stopPropagation = vi.fn();
    const result = guardEnterSubmit({ stopPropagation }, false);
    expect(result).toBe(false);
    expect(stopPropagation).not.toHaveBeenCalled();
  });
});
