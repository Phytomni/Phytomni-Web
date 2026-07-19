import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ref } from "vue";

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

vi.mock("@/utils/pending-chat", () => ({
  writePendingChat: vi.fn(),
  clearPendingChat: vi.fn(),
  isLocalStorageChat: vi.fn(() => false),
}));

vi.mock("@/utils/network-error", () => ({
  isNetworkError: vi.fn(() => false),
}));

import { useSendMessage } from "@/views/chat/composables/useSendMessage";

function makeState() {
  return {
    isSending: false,
    messageInput: "question",
    fileList: [],
    historyQuestion: null,
    reactions: {},
    uploadTransfer: null,
    activeRequestId: "",
    generationStopped: false,
    renderedChat: null as { messages: any[] } | null,
    mode: "instant" as const,
    sendStartedAt: null,
    activeAgentName: "",
    completing: false,
  };
}

describe("blocking Bot response identity", () => {
  let state: ReturnType<typeof makeState>;
  let currentChat: ReturnType<typeof ref<any>>;
  let getHistoryQuestionData: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("VITE_STREAM_ENABLED", "false");
    state = makeState();
    currentChat = ref({ messages: [] });
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
        userStore: () => ({}),
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

    const assistant = state.renderedChat!.messages.at(-1);
    expect(assistant.id).toBe(41);
    expect(assistant.botProjection?.runId).toBe("run-41");
    expect(assistant.botProjection?.status).toBe("SUCCEEDED");
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

    const assistant = state.renderedChat!.messages.at(-1);
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

    const assistant = state.renderedChat!.messages.at(-1);
    expect(assistant.botProjection).toMatchObject({
      reportRevision: 4,
      requestId: "web-request-43",
    });
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

    const assistant = state.renderedChat!.messages.at(-1);
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

    const assistant = state.renderedChat!.messages.at(-1);
    expect(assistant.blocks).toHaveLength(1);
    expect(assistant.blocks[0]).toMatchObject({
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

    const assistant = state.renderedChat!.messages.at(-1);
    expect(assistant.blocks).toHaveLength(1);
    expect(assistant.blocks[0].a2ui.surface.surface_id).toBe("surface-46");
    expect(assistant.a2uiRuntime).toBeUndefined();
  });
});
