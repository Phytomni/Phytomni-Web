import { flushPromises } from "@vue/test-utils";
import { computed, defineComponent, nextTick, reactive, ref } from "vue";
import type { Ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSelectChat } from "@/views/chat/composables/useSelectChat";
import ChatMessageContent from "@/views/chat/components/ChatMessageContent.vue";
import type { Chat, ChatUIState } from "@/views/chat/types";
import {
  buildApiEnvelope,
  buildChatHistoryRecord,
} from "../../../helpers/apiBuilders";
import { buildChat, buildChatState } from "../../../helpers/chatBuilders";
import { mountWithApp } from "../../../helpers/test-app-context";

vi.mock("@/utils/auth", () => ({ getToken: () => "tok" }));
vi.mock("@/api/chat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/chat")>();
  return {
    ...actual,
    getAnswerCheck: vi.fn(),
  };
});
vi.mock("@/utils/request", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/request")>();
  return {
    ...actual,
    registerAbortController: vi.fn(),
    unregisterAbortController: vi.fn(),
  };
});
vi.mock("element-plus", async (importOriginal) => {
  const actual = await importOriginal<typeof import("element-plus")>();
  return {
    ...actual,
    ElMessage: { warning: vi.fn() },
  };
});
vi.mock("@/views/chat/utils/agent-log", () => ({
  readServerFile: vi.fn(),
}));

import { getAnswerCheck } from "@/api/chat";

const CANONICAL_DIALOGUE_ID = "11111111-1111-4111-8111-111111111177";

function sseFrame(type: string, data: Record<string, unknown>, id: number) {
  return `id: ${id}\nevent: ${type}\ndata: ${JSON.stringify({
    type,
    ...data,
  })}\n\n`;
}

describe("useSelectChat stream resume reactivity", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let streamReady: Promise<ReadableStreamDefaultController<Uint8Array>>;

  beforeEach(() => {
    vi.clearAllMocks();
    streamReady = new Promise((resolve) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          resolve(controller);
        },
      });
      fetchMock = vi.fn().mockResolvedValue(
        new Response(body, {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream",
            "X-Phyto-Dialogue-Id": CANONICAL_DIALOGUE_ID,
            "X-Phyto-Message-Id": "77",
          },
        })
      );
      vi.stubGlobal("fetch", fetchMock);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders controlled resume SSE blocks before RunFinished", async () => {
    vi.mocked(getAnswerCheck).mockResolvedValueOnce(
      buildApiEnvelope([
        buildChatHistoryRecord({
          id: "77",
          query: "resume after reload",
          answer: "",
          status: "RUNNING",
          tool_name: "ChatAgent",
        }),
      ])
    );
    const encoder = new TextEncoder();
    let selectPromise: Promise<void> | undefined;
    const state = reactive(buildChatState()) as ChatUIState;
    const Harness = defineComponent({
      components: { ChatMessageContent },
      setup() {
        const currentChatId = ref("");
        const chatList: Ref<Chat[]> = ref([
          buildChat({
            id: 1,
            dialogue_id: "d1",
            title: "Resume fixture",
          }),
        ]);
        const getChatState = () => state;
        const { selectChat } = useSelectChat({
          getChatState,
          ownsChatState: (_dialogueId, candidate) => candidate === state,
          currentChatId,
          scrollToBottom: vi.fn().mockResolvedValue(undefined),
          updateUrlWithChatId: vi.fn(),
          chatList,
          timestamp: ref(0),
        });
        const assistant = computed(
          () =>
            state.renderedChat?.messages.find(
              (message) => message.role === "assistant"
            ) ?? null
        );
        const renderedText = computed(() =>
          (assistant.value?.blocks ?? [])
            .map((block) => (block.type === "markdown" ? block.text : ""))
            .join("")
        );
        const startHydrate = () => {
          selectPromise = selectChat("d1");
        };
        return { assistant, renderedText, startHydrate };
      },
      template: `
        <div>
          <button data-testid="hydrate" @click="startHydrate">hydrate</button>
          <div data-testid="resume-block-text">{{ renderedText }}</div>
          <ChatMessageContent
            v-if="assistant"
            :message="assistant"
            :index="1"
            :is-last-message="true"
            :gene-network-images="{}"
            :gene-network-images-loading="{}"
            :digital-design-images="{}"
            :digital-design-images-loading="{}"
          />
        </div>
      `,
    });

    const wrapper = mountWithApp(Harness, {
      global: {
        stubs: {
          StreamMessage: {
            name: "StreamMessage",
            props: ["blocks"],
            template:
              '<div data-testid="stream-message">{{ blocks.map((block) => block.type === "markdown" ? block.text : "").join("") }}</div>',
          },
          SendProgress: {
            name: "SendProgress",
            template: '<div data-test="send-progress">wait-card</div>',
          },
          ScientificMarkdown: {
            name: "ScientificMarkdown",
            props: ["source"],
            template:
              '<div data-testid="scientific-markdown">{{ source }}</div>',
          },
          ScientificMarkdownTypewriter: {
            name: "ScientificMarkdownTypewriter",
            props: ["source"],
            emits: ["finish"],
            template:
              '<div data-testid="scientific-markdown">{{ source }}</div>',
          },
          ElIcon: true,
          Loading: true,
        },
      },
    });

    await wrapper.get('[data-testid="hydrate"]').trigger("click");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const streamController = await streamReady;

    try {
      streamController.enqueue(
        encoder.encode(sseFrame("RunStarted", { run_id: "run-resume" }, 1))
      );
      streamController.enqueue(
        encoder.encode(sseFrame("TextMessageStart", { message_id: "77" }, 2))
      );
      streamController.enqueue(
        encoder.encode(
          sseFrame(
            "TextMessageContent",
            { delta: "TASK10 resume line 01\n" },
            3
          )
        )
      );

      await flushPromises();
      await nextTick();

      expect(state.isSending).toBe(true);
      expect(wrapper.get('[data-testid="resume-block-text"]').text()).toContain(
        "TASK10 resume line 01"
      );
      expect(wrapper.get('[data-testid="stream-message"]').text()).toContain(
        "TASK10 resume line 01"
      );
      expect(wrapper.find(".agent-wait[data-test='agent-wait']").exists()).toBe(
        false
      );
    } finally {
      streamController.enqueue(
        encoder.encode(sseFrame("RunFinished", { run_id: "run-resume" }, 4))
      );
      streamController.close();
      await selectPromise;
    }
  });
});
