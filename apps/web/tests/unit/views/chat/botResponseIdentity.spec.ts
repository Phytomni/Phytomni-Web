import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ref, type Ref } from "vue";
import type { ChatMessage, ChatUIState, ChatView } from "@/views/chat/types";
import { buildChatState } from "../../../helpers/chatBuilders";
import { mustGet } from "../../../helpers/mockFactories";

const mockGetQueryAbortable = vi.hoisted(() => vi.fn());

vi.mock("@/api/chat", () => ({
  getQueryAbortable: mockGetQueryAbortable,
  getAnswerCheck: vi.fn(),
}));

vi.mock("@/views/chat/composables/useStreamMessage", () => ({
  useStreamMessage: () => ({
    streamMessage: vi.fn(async () => ({})),
  }),
}));

vi.mock("element-plus", () => ({
  ElMessage: { warning: vi.fn() },
  ElMessageBox: { alert: vi.fn() },
}));

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

import { useSendMessage } from "@/views/chat/composables/useSendMessage";

function makeState(): ChatUIState {
  return buildChatState({ messageInput: "question" });
}

function lastMessage(state: ChatUIState, label: string): ChatMessage {
  const renderedChat = mustGet(state.renderedChat, `${label}: rendered chat`);
  return mustGet(renderedChat.messages.at(-1), `${label}: last message`);
}

describe("blocking Bot response identity", () => {
  let state: ReturnType<typeof makeState>;
  let currentChat: Ref<ChatView | null>;
  let getHistoryQuestionData: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("VITE_STREAM_ENABLED", "false");
    state = makeState();
    currentChat = ref<ChatView | null>({ messages: [] });
    getHistoryQuestionData = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function makeComposable() {
    const currentChatId = ref("dialogue-a");
    return {
      state,
      sendMessage: useSendMessage({
        getChatState: () => state,
        currentChatId,
        currentChat,
        composerRef: ref(null),
        t: (key: string) => key,
        userStore: () => ({
          FedLogOut: vi
            .fn<() => Promise<unknown>>()
            .mockResolvedValue(undefined),
        }),
        getHistoryQuestionData,
        chatList: ref([
          {
            id: 41,
            dialogue_id: "dialogue-a",
            title: "",
            date: "",
            isFavorite: false,
          },
        ]),
        timestamp: ref(0),
        selectChat: vi.fn(),
        scrollToBottom: vi.fn().mockResolvedValue(undefined),
      }).sendMessage,
    };
  }

  it("stores bot_run_id separately from the Web response id", async () => {
    mockGetQueryAbortable.mockResolvedValueOnce({
      data: {
        id: 41,
        bot_run_id: "run-41",
        answer: "answer",
        status: "SUCCEEDED",
      },
    });

    const { sendMessage } = makeComposable();
    await sendMessage();

    const assistant = lastMessage(state, "bot run identity");
    expect(assistant.id).toBe(41);
    expect(assistant.botProjection?.runId).toBe("run-41");
    expect(assistant.botProjection?.status).toBe("SUCCEEDED");
    expect(state.agentRunLifecycles).toEqual({});
  });

  it("does not synthesize identity for tracking-degraded success", async () => {
    mockGetQueryAbortable.mockResolvedValueOnce({
      data: {
        id: 42,
        bot_run_id: null,
        tracking_degraded: true,
        answer: "answer",
        status: "SUCCEEDED",
      },
    });

    const { sendMessage } = makeComposable();
    await sendMessage();

    const assistant = lastMessage(state, "tracking-degraded response");
    expect(assistant.id).toBe(42);
    expect(assistant.botProjection?.runId).toBeNull();
    expect(assistant.botProjection?.trackingDegraded).toBe(true);
    expect(state).not.toHaveProperty("botProjection");
  });

  it("keeps report and request metadata on the assistant message projection", async () => {
    mockGetQueryAbortable.mockResolvedValueOnce({
      data: {
        id: 43,
        bot_run_id: "run-43",
        report_revision: 4,
        request_id: "web-request-43",
        answer: "answer",
        status: "SUCCEEDED",
      },
    });

    const { sendMessage } = makeComposable();
    await sendMessage();

    const assistant = lastMessage(state, "report metadata response");
    expect(assistant.botProjection).toMatchObject({
      reportRevision: 4,
      requestId: "web-request-43",
    });
  });

  it("defensively completes a Review answer with a contradictory input-required status", async () => {
    mockGetQueryAbortable.mockResolvedValueOnce({
      data: {
        id: 44,
        bot_run_id: "run-review-complete",
        dialogue_id: "dialogue-a",
        tool_name: "ReviewAgent",
        answer: JSON.stringify({
          content: "# Complete review\n\nFinal evidence-backed answer.",
          doc_list: [{ title: "Review source" }],
        }),
        status: "INPUT_REQUIRED",
        a2ui: {
          catalog_version: "v1.0",
          surface_id: "surface-stale",
          widget: "confirm",
          props: { title: "Approve" },
        },
      },
    });

    const { sendMessage } = makeComposable();
    await sendMessage();

    const assistant = lastMessage(state, "completed Review response");
    expect(assistant).toMatchObject({
      tool_name: "ReviewAgent",
      status: "SUCCEEDED",
      content: "# Complete review\n\nFinal evidence-backed answer.",
      doc_list: [{ title: "Review source" }],
    });
    expect(assistant.blocks).toBeUndefined();
    expect(assistant.a2uiRuntime).toBeUndefined();
  });

  it("preserves legacy task and download fields on an Analyst response", async () => {
    mockGetQueryAbortable.mockResolvedValueOnce({
      data: {
        id: 45,
        tool_name: "AnalystAgent",
        answer: "job submitted",
        task_id: "task-45",
        download_path: "obs://bucket/report-45",
        status: "SUCCEEDED",
      },
    });

    const { sendMessage } = makeComposable();
    await sendMessage();

    const assistant = lastMessage(state, "legacy analyst response");
    expect(assistant).toMatchObject({
      task_id: "task-45",
      download_path: "obs://bucket/report-45",
    });
    expect(assistant.botProjection?.runId).toBeNull();
  });

  it("attaches only the bounded A2UI snapshot for input-required responses", async () => {
    mockGetQueryAbortable.mockResolvedValueOnce({
      data: {
        id: 44,
        bot_run_id: "run-44",
        dialogue_id: "dialogue-a",
        tool_name: "ReviewAgent",
        answer: "",
        status: "INPUT_REQUIRED",
        a2ui: {
          catalog_version: "v1.0",
          surface_id: "surface-44",
          widget: "confirm",
          props: {
            title: "Continue",
            body: "Review the result",
            confirm_label: "Continue",
            cancel_label: "Cancel",
          },
          raw_provider_field: "must-not-cross-boundary",
        },
      },
    });

    const { sendMessage } = makeComposable();
    await sendMessage();

    const assistant = lastMessage(state, "A2UI input-required response");
    expect(assistant.status).toBe("INPUT_REQUIRED");
    expect(assistant.botProjection?.status).toBe("INPUT_REQUIRED");
    expect(assistant.blocks).toHaveLength(1);
    const block = mustGet(assistant.blocks?.[0], "A2UI first block");
    expect(block).toMatchObject({
      type: "agent-surface",
      authority: "agent",
      interactive: true,
      a2ui: {
        surface: {
          catalog_version: "v1.0",
          surface_id: "surface-44",
          widget: "confirm",
          props: {
            title: "Continue",
            body: "Review the result",
            confirm_label: "Continue",
            cancel_label: "Cancel",
          },
        },
        state: { status: "ready", round: 1 },
      },
    });
    expect(JSON.stringify(assistant.blocks)).not.toContain(
      "raw_provider_field"
    );
  });

  it("retains the decoded A2UI surface without creating a runtime for an unsafe dialogue id", async () => {
    mockGetQueryAbortable.mockResolvedValueOnce({
      data: {
        id: 46,
        bot_run_id: "run-46",
        dialogue_id: "dialogue/a?x=1\u0000",
        answer: "",
        status: "INPUT_REQUIRED",
        a2ui: {
          catalog_version: "v1.0",
          surface_id: "surface-46",
          widget: "confirm",
          props: {
            title: "Continue",
            body: "Review the result",
            confirm_label: "Continue",
            cancel_label: "Cancel",
          },
        },
      },
    });

    const { sendMessage } = makeComposable();
    await sendMessage();

    const assistant = lastMessage(state, "unsafe dialogue A2UI response");
    expect(assistant.blocks).toHaveLength(1);
    expect(assistant.blocks?.[0]).toMatchObject({
      a2ui: { surface: { surface_id: "surface-46" } },
    });
    expect(assistant.a2uiRuntime).toBeUndefined();
  });
});
