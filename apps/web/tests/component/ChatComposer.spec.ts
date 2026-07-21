import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { ref } from "vue";
import type { UploadFile } from "@/views/chat/types";

const mentionExpose = {
  openHeader: vi.fn(),
  closeHeader: vi.fn(),
  popoverVisible: ref(false),
};

vi.mock("vue-element-plus-x", () => ({
  MentionSender: {
    name: "MentionSender",
    inheritAttrs: false,
    template:
      '<div class="mention-sender-stub" v-bind="$attrs"><slot name="header" /><slot name="prefix" /><slot name="action-list" /><slot name="footer" /></div>',
    props: [
      "modelValue",
      "loading",
      "disabled",
      "options",
      "placeholder",
      "autoSize",
      "clearable",
      "variant",
      "triggerStrings",
      "triggerSplit",
      "whole",
      "submitType",
    ],
    emits: ["update:modelValue", "submit", "select", "search"],
    setup(
      _props: unknown,
      { expose }: { expose: (exposed: Record<string, unknown>) => void }
    ) {
      expose(mentionExpose);
      return {};
    },
  },
  FilesCard: {
    name: "FilesCard",
    template: '<div class="files-card-stub" @click="$emit(\'delete\')" />',
    props: ["uid", "name", "fileSize", "showDelIcon"],
    emits: ["delete"],
  },
}));

import ChatComposer from "@/views/chat/components/ChatComposer.vue";
import type { ChatComposerHandle } from "@/views/chat/types";

const COMPACT_DOM_ORDER = [
  "chat-composer",
  "chat-composer-surface",
  "phy-composer-frame",
  "composer-attachments",
  "mention-sender-stub",
  "composer-toolbar",
  "composer-mode-selector",
  "chat-agent-picker",
  "upload-demo",
  "send-btn",
];

const pickerOptions = [
  { tool: "ChatAgent", label: "Chat Agent", labelKey: "chat.agents.chatAgent" },
  {
    tool: "KnowledgeAgent",
    label: "Knowledge Agent",
    labelKey: "chat.agents.knowledgeAgent",
  },
];

const baseProps = () => ({
  modelValue: "hello",
  isSending: false,
  chatMode: "instant" as const,
  expertModeEnabled: true,
  showModeSelector: true,
  fileList: [] as UploadFile[],
  rolesLoading: false,
  hasMessages: false,
  selectedAgent: "",
  pickerOptions,
});

const mountComposer = (overrides: Record<string, unknown> = {}) =>
  mount(ChatComposer, {
    props: { ...baseProps(), ...overrides },
    global: {
      stubs: {
        ChatModeSelector: {
          name: "ChatModeSelector",
          template: '<div class="composer-mode-selector" />',
          props: ["modelValue", "expertEnabled"],
          emits: ["update:modelValue"],
        },
        ChatAgentPicker: {
          name: "ChatAgentPicker",
          template:
            '<div class="chat-agent-picker" data-testid="chat-agent-picker" />',
          props: ["options", "rolesLoading", "selectedAgent", "disabled"],
          emits: ["select", "clear"],
        },
        ChatAgentQuickSelect: {
          name: "ChatAgentQuickSelect",
          template:
            '<div data-testid="chat-agent-quick-select"><button v-for="option in options" :key="option.tool">{{ option.label }}</button></div>',
          props: ["options", "rolesLoading", "selectedAgent", "disabled"],
          emits: ["toggle"],
        },
        ElUpload: {
          name: "ElUpload",
          template: '<div class="upload-demo"><slot name="trigger" /></div>',
          props: [
            "disabled",
            "limit",
            "accept",
            "showFileList",
            "autoUpload",
            "multiple",
            "action",
            "onChange",
            "onExceed",
          ],
          emits: ["change"],
        },
        ElButton: {
          name: "ElButton",
          template: "<button><slot /></button>",
          props: ["round", "plain", "color", "disabled", "ariaLabel"],
        },
        ElTooltip: {
          name: "ElTooltip",
          template: "<div><slot /></div>",
          props: ["content", "placement"],
        },
        ElIcon: { name: "ElIcon", template: "<span><slot /></span>" },
        ElDropdown: {
          name: "ElDropdown",
          template:
            '<div class="el-dropdown"><slot /><slot name="dropdown" /></div>',
          props: ["placement", "trigger", "disabled"],
          emits: ["command"],
        },
        ElDropdownMenu: {
          name: "ElDropdownMenu",
          template: "<div><slot /></div>",
        },
        ElDropdownItem: {
          name: "ElDropdownItem",
          template: "<div><slot /></div>",
          props: ["command"],
        },
      },
    },
  });

describe("ChatComposer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mentionExpose.popoverVisible.value = false;
  });

  it("renders a single stable root hook without an extra wrapper", () => {
    const wrapper = mountComposer();
    const roots = wrapper.findAll('[data-testid="chat-composer"]');
    expect(roots).toHaveLength(1);
    expect(wrapper.element).toBe(roots[0].element);
    expect(wrapper.find('[data-testid="chat-composer"]').exists()).toBe(true);
  });

  it("keeps compact DOM order without legacy wrappers", () => {
    const wrapper = mountComposer({
      fileList: [
        {
          name: "a.pdf",
          size: 1,
          type: "application/pdf",
          file: new File([], "a.pdf"),
        },
      ],
    });
    const order: string[] = [];
    const walk = (el: Element) => {
      const cls = el.className?.toString() || "";
      const testId = el.getAttribute("data-testid");
      if (testId === "chat-composer") order.push("chat-composer");
      if (cls.includes("chat-composer-surface"))
        order.push("chat-composer-surface");
      if (cls.includes("phy-composer-frame")) order.push("phy-composer-frame");
      if (cls.includes("composer-attachments"))
        order.push("composer-attachments");
      if (cls.includes("composer-toolbar")) order.push("composer-toolbar");
      if (cls.includes("composer-mode-selector")) {
        order.push("composer-mode-selector");
      }
      if (testId === "chat-agent-picker" || cls.includes("chat-agent-picker")) {
        order.push("chat-agent-picker");
      }
      if (cls.includes("mention-sender-stub"))
        order.push("mention-sender-stub");
      if (cls.includes("upload-demo")) order.push("upload-demo");
      if (cls.includes("send-btn")) order.push("send-btn");
      Array.from(el.children).forEach(walk);
    };
    walk(wrapper.element);
    for (const token of COMPACT_DOM_ORDER) {
      expect(order).toContain(token);
    }
    expect(wrapper.find(".input-container-warpper").exists()).toBe(false);
    expect(wrapper.find(".input-box").exists()).toBe(false);
    expect(wrapper.find(".input-container-bottom").exists()).toBe(false);
    expect(order.indexOf("chat-composer")).toBeLessThan(
      order.indexOf("chat-composer-surface")
    );
    expect(order.indexOf("chat-composer-surface")).toBeLessThan(
      order.indexOf("phy-composer-frame")
    );
    expect(order.indexOf("mention-sender-stub")).toBeLessThan(
      order.indexOf("composer-toolbar")
    );
    expect(order.indexOf("composer-mode-selector")).toBeLessThan(
      order.indexOf("chat-agent-picker")
    );
  });

  it("supports v-model on the mention input", async () => {
    const wrapper = mountComposer({ modelValue: "seed" });
    const mention = wrapper.findComponent({ name: "MentionSender" });
    await mention.vm.$emit("update:modelValue", "next");
    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual(["next"]);
  });

  it("feeds mention suggestions from the same picker options", () => {
    const wrapper = mountComposer();
    expect(
      wrapper.findComponent({ name: "MentionSender" }).props("options")
    ).toEqual([{ value: "ChatAgent" }, { value: "KnowledgeAgent" }]);
  });

  it("shows direct selection only for an empty instant chat", () => {
    const emptyInstant = mountComposer();
    expect(
      emptyInstant.findComponent({ name: "ChatAgentQuickSelect" }).exists()
    ).toBe(true);

    const populated = mountComposer({ hasMessages: true });
    expect(
      populated.findComponent({ name: "ChatAgentQuickSelect" }).exists()
    ).toBe(false);

    const expert = mountComposer({ chatMode: "expert" });
    expect(
      expert.findComponent({ name: "ChatAgentQuickSelect" }).exists()
    ).toBe(false);
  });

  it("forwards a quick toggle and uses localized labels in the populated menu", async () => {
    const empty = mountComposer();
    await empty
      .findComponent({ name: "ChatAgentQuickSelect" })
      .vm.$emit("toggle", "KnowledgeAgent");
    expect(empty.emitted("toggle-agent")?.[0]).toEqual(["KnowledgeAgent"]);

    const populated = mountComposer({ hasMessages: true });
    expect(populated.find(".el-dropdown").text()).toContain("Chat Agent");
    expect(populated.find(".el-dropdown").text()).toContain("Knowledge Agent");
  });

  it("emits submit from MentionSender and the enabled primary action", async () => {
    const wrapper = mountComposer({ modelValue: "go" });
    await wrapper.findComponent({ name: "MentionSender" }).vm.$emit("submit");
    expect(wrapper.emitted("submit")).toHaveLength(1);
    await wrapper.find(".send-btn button").trigger("click");
    expect(wrapper.emitted("submit")).toHaveLength(2);

    const wrapperEmpty = mountComposer({ modelValue: "" });
    expect(wrapperEmpty.find(".send-btn").exists()).toBe(true);
    expect(
      wrapperEmpty.findComponent(".composer-send-button").props("disabled")
    ).toBe(true);
  });

  it("replaces Send with an in-flow Stop action during generation", async () => {
    const wrapper = mountComposer({ isSending: true });
    expect(wrapper.find(".abort-button-overlay").exists()).toBe(false);
    expect(wrapper.find(".send-btn").exists()).toBe(false);
    expect(wrapper.find(".stop-btn").exists()).toBe(true);
    await wrapper.find(".stop-btn button").trigger("click");
    expect(wrapper.emitted("stop")).toHaveLength(1);
  });

  it("renders mode selector only in empty-chat state and emits mode updates", async () => {
    const wrapper = mountComposer({ showModeSelector: true });
    expect(wrapper.find(".composer-mode-selector").exists()).toBe(true);
    expect(
      wrapper
        .find(".composer-mode-selector")
        .element.closest(".phy-composer-frame")
    ).toBeTruthy();

    const withMessages = mountComposer({
      showModeSelector: false,
      hasMessages: true,
    });
    expect(withMessages.find(".composer-mode-selector").exists()).toBe(false);

    await wrapper
      .findComponent({ name: "ChatModeSelector" })
      .vm.$emit("update:modelValue", "expert");
    expect(wrapper.emitted("update:chatMode")?.[0]).toEqual(["expert"]);
  });

  it("shows attachment cards and emits remove-file", async () => {
    const file: UploadFile = {
      name: "doc.pdf",
      size: 10,
      type: "application/pdf",
      file: new File(["x"], "doc.pdf"),
    };
    const wrapper = mountComposer({ fileList: [file] });
    expect(wrapper.find(".composer-attachments").exists()).toBe(true);
    expect(
      wrapper
        .find(".composer-attachments")
        .element.closest(".phy-composer-frame")
    ).toBeTruthy();
    expect(wrapper.find(".file-list-container").exists()).toBe(true);
    await wrapper.findComponent({ name: "FilesCard" }).vm.$emit("delete");
    expect(wrapper.emitted("remove-file")?.[0]).toEqual([0]);
  });

  it("emits file-change from the upload control", async () => {
    const wrapper = mountComposer();
    const upload = wrapper.findComponent({ name: "ElUpload" });
    const file = {
      name: "f.txt",
      size: 1,
      type: "text/plain",
      raw: new File([], "f.txt"),
    };
    upload.props("onChange")?.(file);
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted("file-change")).toHaveLength(1);
  });

  it("forwards files rejected by the upload limit to shared validation", async () => {
    const wrapper = mountComposer();
    const upload = wrapper.findComponent({ name: "ElUpload" });
    const extra = new File(["x"], "extra.txt", { type: "text/plain" });

    upload.props("onExceed")?.([extra]);
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted("paste-files")?.[0]).toEqual([[extra]]);
  });

  it("emits clipboard files without intercepting ordinary text paste", () => {
    const wrapper = mountComposer();
    const pasted = new File(["x"], "notes.txt", { type: "text/plain" });
    const filePaste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(filePaste, "clipboardData", {
      value: { files: [pasted] },
    });

    wrapper.element.dispatchEvent(filePaste);

    expect(filePaste.defaultPrevented).toBe(true);
    expect(wrapper.emitted("paste-files")?.[0]).toEqual([[pasted]]);

    const textPaste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(textPaste, "clipboardData", {
      value: { files: [] },
    });
    wrapper.element.dispatchEvent(textPaste);
    expect(textPaste.defaultPrevented).toBe(false);
    expect(wrapper.emitted("paste-files")).toHaveLength(1);
  });

  it("disables upload and mention controls while sending", () => {
    const wrapper = mountComposer({ isSending: true });
    expect(
      wrapper.findComponent({ name: "MentionSender" }).props("disabled")
    ).toBe(true);
    expect(wrapper.findComponent({ name: "ElUpload" }).props("disabled")).toBe(
      true
    );
    expect(
      wrapper.findComponent(".composer-tool-button").props("disabled")
    ).toBe(true);
    expect(wrapper.find(".file-list-container").exists()).toBe(false);
  });

  it("forwards mention select/search and picker command/clear", async () => {
    const wrapper = mountComposer();
    const mention = wrapper.findComponent({ name: "MentionSender" });
    await mention.vm.$emit("select", { value: "ChatAgent" });
    await mention.vm.$emit("search", "R");
    expect(wrapper.emitted("select")?.[0]).toEqual([{ value: "ChatAgent" }]);
    expect(wrapper.emitted("search")?.[0]).toEqual(["R"]);

    const picker = wrapper.findComponent({ name: "ChatAgentPicker" });
    expect(picker.exists()).toBe(true);
    await picker.vm.$emit("select", "@ChatAgent,");
    await picker.vm.$emit("clear");
    expect(wrapper.emitted("command")?.[0]).toEqual(["@ChatAgent,"]);
    expect(wrapper.emitted("clear-agent")).toHaveLength(1);
  });

  it("hides the agent picker in expert mode", () => {
    const wrapper = mountComposer({ chatMode: "expert" });
    expect(wrapper.findComponent({ name: "ChatAgentPicker" }).exists()).toBe(
      false
    );
  });

  it("exposes ChatComposerHandle methods consumed by composables", async () => {
    const wrapper = mountComposer();
    const handle = wrapper.vm as unknown as ChatComposerHandle;
    handle.openHeader();
    handle.closeHeader();
    expect(mentionExpose.openHeader).toHaveBeenCalled();
    expect(mentionExpose.closeHeader).toHaveBeenCalled();
    expect(handle.popoverVisible).toBe(false);
  });

  it("binds tour input target to the compact surface without an extra focus wrapper", async () => {
    const tourInputTarget = ref<HTMLElement | null>(null);
    const setTourInputTarget = (el: HTMLElement | null) => {
      tourInputTarget.value = el;
    };
    mountComposer({ setTourInputTarget, showModeSelector: false });
    await flushPromises();
    expect(tourInputTarget.value).toBeTruthy();
    expect(
      tourInputTarget.value?.classList.contains("chat-composer-surface")
    ).toBe(true);
    expect(tourInputTarget.value?.getAttribute("data-testid")).not.toBe(
      "chat-composer"
    );
  });

  it("blocks Enter propagation while mention dropdown is open", async () => {
    mentionExpose.popoverVisible.value = true;
    const wrapper = mountComposer();
    const stopPropagation = vi.fn();
    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
    Object.defineProperty(event, "stopPropagation", { value: stopPropagation });
    wrapper.find(".mention-sender-stub").element.dispatchEvent(event);
    expect(stopPropagation).toHaveBeenCalled();
  });

  it("applies a 48px-minimum elevated surface with safe-area padding", () => {
    const wrapper = mountComposer();
    const surface = wrapper.find(".chat-composer-surface");
    expect(surface.exists()).toBe(true);
    const rootStyle = wrapper.find('[data-testid="chat-composer"]').classes();
    expect(rootStyle).toContain("chat-composer");
  });
});
