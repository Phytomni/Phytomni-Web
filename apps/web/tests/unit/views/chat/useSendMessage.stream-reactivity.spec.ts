import { flushPromises } from "@vue/test-utils";
import { computed, defineComponent, nextTick, reactive, ref } from "vue";
import type { Ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ChatComposer from "@/views/chat/components/ChatComposer.vue";
import { useSendMessage } from "@/views/chat/composables/useSendMessage";
import type {
  BotCapabilityByTool,
  BotResearchInputCapability,
} from "@/views/chat/composables/useBotCapabilities";
import type {
  Chat,
  ChatComposerHandle,
  ChatUIState,
  ChatView,
} from "@/views/chat/types";
import type { ResumableUploadItem } from "@/views/chat/upload/types";
import { buildChatState } from "../../../helpers/chatBuilders";
import { mountWithApp } from "../../../helpers/test-app-context";

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
}));

vi.mock("@/api/chat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/chat")>();
  return {
    ...actual,
    getQueryAbortable: vi.fn(),
    getAnswerCheck: vi.fn(),
  };
});

vi.mock("element-plus", async (importOriginal) => {
  const actual = await importOriginal<typeof import("element-plus")>();
  return {
    ...actual,
    ElMessage: { warning: vi.fn() },
    ElMessageBox: { alert: vi.fn() },
  };
});

vi.mock("@/utils/pending-chat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/pending-chat")>();
  return {
    ...actual,
    writePendingChat: vi.fn(),
    clearPendingChat: vi.fn(),
    isLocalStorageChat: vi.fn(() => false),
  };
});

vi.mock("@/utils/network-error", () => ({
  isNetworkError: vi.fn(() => false),
}));

function researchInputCapability(): BotResearchInputCapability {
  return {
    enabled: true,
    protocol: "research_input_resolution_v1",
    max_user_query_chars: 131072,
    max_attachments_per_request: 64,
    max_research_dataset_paths: 64,
    max_research_input_references: 128,
  };
}

function streamCapabilities(): BotCapabilityByTool {
  return {
    ChatAgent: {
      tool: "ChatAgent",
      slug: "ChatAgent",
      execution: "chat",
      stream: true,
      a2ui: false,
      resolver: false,
      attachments: false,
      attachmentChannels: [],
      artifacts: false,
      enabled: true,
    },
  } as BotCapabilityByTool;
}

function sseFrame(type: string, data: Record<string, unknown>, id: number) {
  return `id: ${id}\nevent: ${type}\ndata: ${JSON.stringify({
    type,
    ...data,
  })}\n\n`;
}

function chatComposerStubs() {
  return {
    ChatModeSelector: {
      name: "ChatModeSelector",
      template: '<div class="composer-mode-selector" />',
      props: ["modelValue", "instantEnabled", "expertEnabled"],
      emits: ["update:modelValue"],
    },
    ChatAgentPicker: {
      name: "ChatAgentPicker",
      template: '<div class="chat-agent-picker" />',
      props: ["options", "rolesLoading", "selectedAgent", "disabled"],
      emits: ["select", "clear"],
    },
    ChatAgentQuickSelect: {
      name: "ChatAgentQuickSelect",
      template: '<div data-testid="chat-agent-quick-select" />',
      props: ["options", "rolesLoading", "selectedAgent", "disabled"],
      emits: ["toggle"],
    },
    AttachmentChipStrip: {
      name: "AttachmentChipStrip",
      template: '<div data-testid="attachment-chip-strip" />',
      props: ["items", "disabled", "announcement", "announcementNonce"],
      emits: [
        "select",
        "pause",
        "resume",
        "retry",
        "reselect",
        "cancel",
        "remove",
      ],
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
    },
    ElButton: {
      name: "ElButton",
      template: "<button><slot /></button>",
      props: ["circle", "round", "plain", "color", "disabled", "ariaLabel"],
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
  };
}

describe("useSendMessage stream reactivity", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let streamReady: Promise<ReadableStreamDefaultController<Uint8Array>>;

  beforeEach(() => {
    vi.clearAllMocks();
    mentionExpose.popoverVisible.value = false;
    streamReady = new Promise((resolve) => {
      const body = new ReadableStream<Uint8Array>({
        start(nextController) {
          resolve(nextController);
        },
      });
      fetchMock = vi.fn().mockResolvedValue(
        new Response(body, {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream",
            "X-Phyto-Dialogue-Id": "11111111-1111-4111-8111-111111111111",
            "X-Phyto-Message-Id": "42",
          },
        })
      );
      vi.stubGlobal("fetch", fetchMock);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders intermediate stream blocks while Stop is still visible", async () => {
    const encoder = new TextEncoder();
    let sendPromise: Promise<void> | undefined;
    const Harness = defineComponent({
      components: { ChatComposer },
      setup() {
        const state = reactive(
          buildChatState({
            messageInput: "stream one frame",
            mode: "instant",
            renderedChat: null,
          })
        ) as ChatUIState;
        const currentChatId = ref("A");
        const currentChat = ref<ChatView | null>({ messages: [] });
        const composerRef: Ref<ChatComposerHandle | null> = ref(null);
        const chatList = ref<Chat[]>([
          {
            id: 1,
            dialogue_id: "A",
            title: "A",
            date: "",
            isFavorite: false,
          },
        ]);
        const getChatState = () => state;
        const { sendMessage } = useSendMessage({
          getChatState,
          currentChatId,
          currentChat,
          composerRef,
          t: (key: string) => key,
          userStore: () => ({
            FedLogOut: vi
              .fn<() => Promise<unknown>>()
              .mockResolvedValue(undefined),
          }),
          getHistoryQuestionData: vi.fn().mockResolvedValue(undefined),
          chatList,
          timestamp: ref(0),
          selectChat: vi.fn().mockResolvedValue(undefined),
          scrollToBottom: vi.fn().mockResolvedValue(undefined),
          researchInputCapability: ref(researchInputCapability()),
          botCapabilitiesByTool: ref(streamCapabilities()),
        });
        const inputValue = computed({
          get: () => state.messageInput,
          set: (value: string) => {
            state.messageInput = value;
          },
        });
        const emptyFileList: ResumableUploadItem[] = [];
        const renderedText = computed(() =>
          (state.renderedChat?.messages ?? [])
            .flatMap((message) => message.blocks ?? [])
            .map((block) => (block.type === "markdown" ? block.text : ""))
            .join("")
        );
        const startSend = () => {
          sendPromise = sendMessage();
        };
        return { emptyFileList, inputValue, renderedText, startSend, state };
      },
      template: `
        <div>
          <button data-testid="start-send" @click="startSend">send</button>
          <div data-testid="rendered-stream">{{ renderedText }}</div>
          <ChatComposer
            ref="composerRef"
            v-model="inputValue"
            :is-sending="state.isSending"
            chat-mode="instant"
            :instant-mode-enabled="true"
            :expert-mode-enabled="true"
            :mode-usable="true"
            :show-mode-selector="true"
            :max-attachments="64"
            :file-list="emptyFileList"
            :has-blocking-uploads="false"
            :attachment-target-available="true"
            :attachment-target-blocked="false"
            :roles-loading="false"
            :has-messages="true"
            selected-agent=""
            :picker-options="[]"
          />
        </div>
      `,
    });

    const wrapper = mountWithApp(Harness, {
      global: { stubs: chatComposerStubs() },
    });

    await wrapper.get('[data-testid="start-send"]').trigger("click");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const streamController = await streamReady;

    try {
      streamController.enqueue(
        encoder.encode(sseFrame("RunStarted", { run_id: "run-live" }, 1))
      );
      streamController.enqueue(
        encoder.encode(sseFrame("TextMessageStart", { message_id: "42" }, 2))
      );
      streamController.enqueue(
        encoder.encode(
          sseFrame("TextMessageContent", { delta: "TASK10 line 01\n" }, 3)
        )
      );

      await flushPromises();
      await nextTick();

      expect(wrapper.get(".composer-stop-button").exists()).toBe(true);
      expect(wrapper.get('[data-testid="rendered-stream"]').text()).toContain(
        "TASK10 line 01"
      );
    } finally {
      streamController.enqueue(
        encoder.encode(sseFrame("RunFinished", { run_id: "run-live" }, 4))
      );
      streamController.close();
      await sendPromise;
    }
  });
});
