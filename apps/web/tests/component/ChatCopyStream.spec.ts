/**
 * Instant / stream-family copy uses the visible Markdown, not empty content.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { nextTick } from "vue";
import type { VueWrapper } from "@vue/test-utils";
import { chatContentToText } from "@/views/chat/messageTypes";
import type { ChatMessage } from "@/views/chat/types";
import { MESSAGE_SHORT_GENERIC } from "../fixtures/chat";
import { createTestAppContext } from "../helpers/test-app-context";

const testState = vi.hoisted(() => ({
  chatStates: null as ReturnType<
    typeof import("@/views/chat/composables/useChatStates").useChatStates
  > | null,
  copiedText: vi.fn(),
}));

vi.mock("vue-element-plus-x", () => ({
  XMarkdown: { name: "XMarkdown", template: "<div />" },
  Typewriter: { name: "Typewriter", template: "<div />" },
  FilesCard: { name: "FilesCard", template: "<div />" },
  Prompts: { name: "Prompts", template: "<div />" },
}));

vi.mock("@/views/chat/composables/useChatStates", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/views/chat/composables/useChatStates")
    >();
  return {
    ...actual,
    useChatStates: () => {
      const state = actual.useChatStates();
      testState.chatStates = state;
      return state;
    },
  };
});

vi.mock("@/views/chat/composables/useCopyDownload", () => ({
  useCopyDownload: () => ({
    fallbackCopyText: (text: string) => testState.copiedText(text),
    downloadFile: vi.fn(),
    getFileDownUrl: vi.fn(),
  }),
}));

vi.mock("@/api/chat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/chat")>();
  return {
    ...actual,
    getHistoryQuestionList: vi.fn(() => new Promise(() => undefined)),
    getAnswerCheck: vi.fn(),
    getAnalystAgentLog: vi.fn(),
    getUserTool: vi.fn(async () => ({
      code: 200,
      data: {
        permission: "",
        tool_list: [],
        permission_list: [],
        expert_enabled: false,
      },
    })),
  };
});

vi.mock("vue-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("vue-router")>();
  return {
    ...actual,
    useRoute: () => ({ meta: {}, query: {}, params: {} }),
    useRouter: () => ({ push: vi.fn(), back: vi.fn(), go: vi.fn() }),
  };
});

import ChatIndex from "@/views/chat/ChatView.vue";
import ChatMessageContent from "@/views/chat/components/ChatMessageContent.vue";

const CHAT_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/ChatView.vue"),
  "utf8"
);

const VISIBLE_ANSWER = "Rice has 12 chromosomes.";

function streamAssistant(
  toolName: ChatMessage["tool_name"],
  text: string,
  extras: Partial<ChatMessage> = {}
): ChatMessage {
  return {
    role: "assistant",
    id: `${toolName}-stream-1`,
    tool_name: toolName,
    content: "",
    streaming: false,
    instantMessage: true,
    blocks: [
      {
        type: "markdown",
        authority: "web",
        text,
        complete: true,
      },
    ],
    ...extras,
  };
}

const instantChatAgent = streamAssistant("ChatAgent", VISIBLE_ANSWER);

const mountedWrappers: VueWrapper[] = [];
let appContext: ReturnType<typeof createTestAppContext>;

async function mountChatWithMessages(messages: ChatMessage[]) {
  const wrapper = appContext.mount(ChatIndex, {
    global: {
      stubs: {
        RouterLink: {
          name: "RouterLink",
          props: ["to"],
          template: '<a :href="to"><slot /></a>',
        },
        ChatComposer: {
          name: "ChatComposer",
          props: ["modelValue"],
          emits: ["update:modelValue"],
          setup(
            _props: unknown,
            { expose }: { expose: (value: Record<string, unknown>) => void }
          ) {
            expose({
              openHeader: vi.fn(),
              closeHeader: vi.fn(),
              popoverVisible: false,
            });
            return {};
          },
          template:
            '<textarea data-testid="chat-composer" :value="modelValue" />',
        },
        ScientificMarkdown: {
          name: "ScientificMarkdown",
          props: ["source"],
          template: '<article data-test="markdown-body">{{ source }}</article>',
        },
        ChatMessageActions: {
          name: "ChatMessageActions",
          emits: ["copy"],
          template:
            '<button type="button" data-test="copy-source" @click="$emit(\'copy\')">copy</button>',
        },
        StreamMessage: {
          name: "StreamMessage",
          props: ["blocks"],
          template:
            '<div data-testid="stream-message">{{ blocks?.[0]?.text }}</div>',
        },
        ChatSidebarNav: true,
        ChatHistoryList: true,
        FollowUpQuestions: true,
        ChatActivity: true,
        ChatAnalystLog: true,
        TransferProgress: true,
        SendProgress: true,
        ElTour: true,
        ElTourStep: true,
        ElBacktop: true,
        ElDialog: true,
        ElAvatar: true,
        ElIcon: true,
        ElTable: true,
        ElTableColumn: true,
        ElButton: { template: '<button type="button"><slot /></button>' },
      },
    },
  });
  mountedWrappers.push(wrapper);
  const state = testState.chatStates;
  if (!state) throw new Error("chat state was not captured");
  state.getChatState("instant-copy").renderedChat = {
    dialogue_id: "instant-copy",
    title: "Quick ChatAgent",
    messages,
  };
  state.currentChatId.value = "instant-copy";
  await nextTick();
  await nextTick();
  return wrapper;
}

async function copyAssistant(messages: ChatMessage[]) {
  const wrapper = await mountChatWithMessages(messages);
  const copyButtons = wrapper.findAll("[data-test=copy-source]");
  expect(copyButtons.length).toBeGreaterThanOrEqual(2);
  await copyButtons[copyButtons.length - 1]?.trigger("click");
  return wrapper;
}

beforeEach(() => {
  appContext = createTestAppContext({ locale: "en-US" });
  testState.chatStates = null;
  testState.copiedText.mockReset();
});

afterEach(() => {
  while (mountedWrappers.length) {
    mountedWrappers.pop()?.unmount();
  }
});

describe("stream family copy", () => {
  it("copy handler reads the visible message text, not the artifact preview", () => {
    expect(CHAT_SOURCE).toContain('@copy="handleMessageCopy(message, index)"');
    expect(CHAT_SOURCE).toContain("messagePlainText(message)");
    expect(CHAT_SOURCE).not.toMatch(
      /handleMessageCopy[\s\S]{0,500}artifactPreview/
    );
  });

  it("ChatMessageContent renders StreamMessage for a completed ChatAgent stream", () => {
    const wrapper = appContext.mount(ChatMessageContent, {
      props: {
        message: instantChatAgent,
        index: 1,
        isLastMessage: true,
        geneNetworkImages: {},
        geneNetworkImagesLoading: {},
        digitalDesignImages: {},
        digitalDesignImagesLoading: {},
      },
      global: {
        stubs: {
          StreamMessage: {
            name: "StreamMessage",
            props: ["blocks"],
            template:
              '<div data-testid="stream-message">{{ blocks?.[0]?.text }}</div>',
          },
          SendProgress: true,
          ElIcon: true,
        },
      },
    });
    mountedWrappers.push(wrapper);
    expect(wrapper.get('[data-testid="stream-message"]').text()).toBe(
      VISIBLE_ANSWER
    );
  });

  it("clicking copy on a completed instant ChatAgent writes the visible Markdown", async () => {
    const wrapper = await copyAssistant([
      { role: "user", content: "What does the stream say?" },
      instantChatAgent,
    ]);
    expect(wrapper.get('[data-testid="stream-message"]').text()).toBe(
      VISIBLE_ANSWER
    );
    expect(testState.copiedText).toHaveBeenCalledTimes(1);
    expect(testState.copiedText).toHaveBeenCalledWith(VISIBLE_ANSWER);
  });

  it.each([
    ["KnowledgeAgent", "Knowledge stream answer."],
    ["BriefGeneAgent", "BriefGene stream answer."],
  ] as const)(
    "clicking copy on a completed %s stream writes the visible Markdown",
    async (tool, text) => {
      await copyAssistant([
        { role: "user", content: "stream please" },
        streamAssistant(tool, text),
      ]);
      expect(testState.copiedText).toHaveBeenCalledWith(text);
    }
  );

  it("appends references after streamed Markdown instead of copying only citations", async () => {
    await copyAssistant([
      { role: "user", content: "cite this" },
      streamAssistant("ChatAgent", VISIBLE_ANSWER, {
        doc_list: [{ title: "Complete source document" }],
      }),
    ]);
    expect(testState.copiedText).toHaveBeenCalledWith(
      `${VISIBLE_ANSWER}\nReferences:\n1. Complete source document`
    );
  });

  it("blocking ChatAgent content still copies the visible string", async () => {
    await copyAssistant([
      { role: "user", content: "generic" },
      MESSAGE_SHORT_GENERIC,
    ]);
    expect(testState.copiedText).toHaveBeenCalledWith(
      chatContentToText(MESSAGE_SHORT_GENERIC.content)
    );
  });

  it("user copy still uses the authored prompt", async () => {
    const wrapper = await mountChatWithMessages([
      { role: "user", content: "Count rice chromosomes." },
      instantChatAgent,
    ]);
    await wrapper.findAll("[data-test=copy-source]")[0]?.trigger("click");
    expect(testState.copiedText).toHaveBeenCalledWith(
      "Count rice chromosomes."
    );
  });

  it("table copy still uses the original serialized rows", async () => {
    await copyAssistant([
      { role: "user", content: "table" },
      {
        role: "assistant",
        content: [{ gene: "Os01g01010" }],
        tableHeaders: [{ prop: "gene", label: "Gene" }],
        original: "gene\nOs01g01010",
      },
    ]);
    expect(testState.copiedText).toHaveBeenCalledWith("gene\nOs01g01010");
  });
});
