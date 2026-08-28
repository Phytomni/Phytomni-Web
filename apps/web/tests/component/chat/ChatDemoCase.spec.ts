import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { flushPromises } from "@vue/test-utils";
import { nextTick, ref } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import type { BotCapabilityByTool } from "@/views/chat/composables/useBotCapabilities";
import type { BotUploadCapability } from "@/api/types";
import ChatView from "@/views/chat/ChatView.vue";
import ChatDemoAskCta from "@/views/chat/components/ChatDemoAskCta.vue";
import { userStore } from "@/stores";
import { KNOWLEDGE_CASE } from "@/views/knowledge-agent/knowledge-case";
import { createTestAppContext } from "../../helpers/test-app-context";

const CHAT_SOURCE = readFileSync(
  resolve(__dirname, "../../../src/views/chat/ChatView.vue"),
  "utf8"
);
const SEND_SOURCE = readFileSync(
  resolve(__dirname, "../../../src/views/chat/composables/useSendMessage.ts"),
  "utf8"
);

const chatViewState = vi.hoisted(() => ({
  states: null as ReturnType<
    typeof import("@/views/chat/composables/useChatStates").useChatStates
  > | null,
}));

const chatSendHarness = vi.hoisted(() => ({
  getQueryAbortable: vi.fn(),
}));

const mockBotCapabilities = {
  byTool: ref<BotCapabilityByTool>({}),
  upload: ref<BotUploadCapability>({
    enabled: true,
    protocol: "obs-multipart-v2",
    upload_origin: "https://upload.example",
    max_file_bytes: 10 * 1024 * 1024 * 1024,
    max_attachments: 64,
  }),
  researchInput: ref({
    enabled: false,
    protocol: "research_input_resolution_v1",
    max_user_query_chars: 0,
    max_attachments_per_request: 0,
    max_research_dataset_paths: 0,
    max_research_input_references: 0,
  }),
  load: vi.fn().mockResolvedValue(undefined),
};

vi.mock("@/views/chat/composables/useChatStates", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/views/chat/composables/useChatStates")
    >();
  return {
    ...actual,
    useChatStates: () => {
      const states = actual.useChatStates();
      chatViewState.states = states;
      return states;
    },
  };
});

vi.mock("@/api/chat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/chat")>();
  return {
    ...actual,
    getHistoryQuestionList: vi.fn(() =>
      Promise.resolve({ code: 200, data: [] })
    ),
    getQueryAbortable: chatSendHarness.getQueryAbortable,
  };
});

vi.mock("@/views/chat/composables/useBotCapabilities", () => ({
  useBotCapabilities: () => ({
    byTool: mockBotCapabilities.byTool,
    upload: mockBotCapabilities.upload,
    researchInput: mockBotCapabilities.researchInput,
    load: mockBotCapabilities.load,
  }),
}));

vi.mock("vue-element-plus-x", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue-element-plus-x")>()),
  MentionSender: { name: "MentionSender", template: "<div />" },
  FilesCard: { name: "FilesCard", template: "<div />" },
}));

const chatViewStubs = {
  PhyAdaptiveShell: {
    name: "PhyAdaptiveShell",
    template:
      '<div><slot name="sidebar" /><slot name="main" /><slot name="artifact" /></div>',
  },
  Sidebar: {
    name: "Sidebar",
    props: ["chatList", "currentChatId"],
    emits: ["startNewChat"],
    template:
      '<button data-testid="sidebar-start-new" @click="$emit(\'startNewChat\')" />',
  },
  ChatComposer: {
    name: "ChatComposer",
    props: ["selectedAgent", "chatMode", "modelValue"],
    setup(
      _props: unknown,
      { expose }: { expose: (value: Record<string, unknown>) => void }
    ) {
      expose({ openHeader: vi.fn(), closeHeader: vi.fn() });
      return {};
    },
    template: '<div data-testid="chat-composer" />',
  },
  ChatCases: {
    name: "ChatCases",
    template: '<div data-testid="chat-cases" />',
  },
  ChatDemoAskCta: false,
  PhyEmptyState: false,
  PhyErrorState: false,
  ChatMessageRow: {
    name: "ChatMessageRow",
    props: ["role", "messageId"],
    template:
      '<div data-testid="chat-message-row" :data-message-role="role"><slot /><slot name="actions" /></div>',
  },
  ChatMessageContent: {
    name: "ChatMessageContent",
    props: ["message"],
    template: '<div class="message-text">{{ message.content }}</div>',
  },
};

function createDemoRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/chat", name: "chat", component: ChatView },
      {
        path: "/cases/knowledge-agent",
        name: "knowledgeAgentCase",
        component: ChatView,
        meta: { demoKey: "knowledge" },
      },
      {
        path: "/cases/analyst-agent",
        name: "analystAgentCase",
        component: ChatView,
        meta: { demoKey: "analyst" },
      },
    ],
  });
}

async function mountChatView(path: string) {
  const router = createDemoRouter();
  await router.push(path);
  await router.isReady();
  const context = createTestAppContext({ router, locale: "en-US" });
  const store = userStore();
  store.SET_ROLES(["KnowledgeAgent", "AnalystAgent"]);
  store.rolesLoading = false;
  store.expertEnabled = true;
  const wrapper = context.mount(ChatView, {
    shallow: true,
    global: { stubs: chatViewStubs },
  });
  await flushPromises();
  await nextTick();
  return { wrapper, router };
}

beforeEach(() => {
  setActivePinia(createPinia());
  chatViewState.states = null;
  chatSendHarness.getQueryAbortable.mockReset();
});

afterEach(() => {
  chatViewState.states = null;
});

describe("ChatView demo case tapes", () => {
  it("keeps ChatView demo wiring for the CTA, composer gate, and send guards", () => {
    expect(CHAT_SOURCE).toContain("ChatDemoAskCta");
    expect(CHAT_SOURCE).toContain('v-if="!demoKey"');
    expect(CHAT_SOURCE).toContain("isDemoDialogueId(currentChatId.value)");
    expect(SEND_SOURCE).toContain("isDemoDialogueId(currentChatId.value)");
    expect(CHAT_SOURCE).not.toContain("AgentDemoShell");
  });

  it("plays the knowledge tape as a read-only ChatView without cases or composer", async () => {
    const { wrapper } = await mountChatView("/cases/knowledge-agent");
    try {
      expect(wrapper.text()).toContain(KNOWLEDGE_CASE.question);
      expect(wrapper.html()).not.toContain("AgentDemoShell");
      expect(wrapper.find('[data-testid="chat-cases"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="chat-composer"]').exists()).toBe(
        false
      );
      expect(wrapper.find('[data-testid="chat-demo-ask"]').exists()).toBe(true);
      const sidebar = wrapper.findComponent({ name: "Sidebar" });
      const chatList = (sidebar.props("chatList") ?? []) as Array<{
        dialogue_id: string;
      }>;
      expect(
        chatList.some((chat) => chat.dialogue_id === "demo:knowledge")
      ).toBe(false);
      expect(chatSendHarness.getQueryAbortable).not.toHaveBeenCalled();
    } finally {
      wrapper.unmount();
    }
  });

  it("asks this agent into an empty Expert chat with KnowledgeAgent selected", async () => {
    const { wrapper, router } = await mountChatView("/cases/knowledge-agent");
    try {
      await wrapper
        .get('[data-testid="chat-demo-ask-button"]')
        .trigger("click");
      await flushPromises();
      await nextTick();
      expect(router.currentRoute.value.path).toBe("/chat");
      expect(wrapper.find('[data-testid="chat-composer"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="chat-demo-ask"]').exists()).toBe(
        false
      );
      const states = chatViewState.states;
      if (!states) throw new Error("ChatView state was not captured");
      expect(states.chatMode.value).toBe("expert");
      expect(states.selectedAgent.value).toBe("KnowledgeAgent");
      expect(states.messageInput.value).toBe("");
    } finally {
      wrapper.unmount();
    }
  });

  it("shows analyst empty copy with the CTA and no assistant bubble", async () => {
    const { wrapper } = await mountChatView("/cases/analyst-agent");
    try {
      expect(wrapper.text()).toContain("No example conversation yet");
      expect(wrapper.text()).toContain(
        "This is a static example. A sample report will be added later. You can ask this agent now."
      );
      expect(wrapper.find('[data-message-role="assistant"]').exists()).toBe(
        false
      );
      expect(wrapper.find('[data-testid="chat-demo-ask"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="chat-composer"]').exists()).toBe(
        false
      );
    } finally {
      wrapper.unmount();
    }
  });

  it("starts a new chat from a demo route without keeping the demo agent", async () => {
    const { wrapper, router } = await mountChatView("/cases/knowledge-agent");
    try {
      await wrapper.get('[data-testid="sidebar-start-new"]').trigger("click");
      await flushPromises();
      await nextTick();
      expect(router.currentRoute.value.path).toBe("/chat");
      const states = chatViewState.states;
      if (!states) throw new Error("ChatView state was not captured");
      expect(states.selectedAgent.value).toBe("");
      expect(states.messageInput.value).toBe("");
    } finally {
      wrapper.unmount();
    }
  });

  it("renders the Ask this agent label on the standalone CTA", () => {
    const english = createTestAppContext({ locale: "en-US" }).mount(
      ChatDemoAskCta
    );
    expect(english.get('[data-testid="chat-demo-ask"]').exists()).toBe(true);
    expect(english.get('[data-testid="chat-demo-ask-button"]').text()).toBe(
      "Ask this agent"
    );
    english.unmount();

    const chinese = createTestAppContext({ locale: "zh-CN" }).mount(
      ChatDemoAskCta
    );
    expect(chinese.get('[data-testid="chat-demo-ask-button"]').text()).toBe(
      "向它提问"
    );
    chinese.unmount();
  });
});
