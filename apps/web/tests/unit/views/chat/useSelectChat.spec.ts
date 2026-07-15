import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import { useSelectChat } from "@/views/chat/composables/useSelectChat";
import type { ChatMessage, ChatUIState } from "@/views/chat/types";

// Mock getAnswerCheck API (the only API selectChat calls)
vi.mock("@/api/chat", () => ({
  getAnswerCheck: vi.fn(),
}));

import { getAnswerCheck } from "@/api/chat";

const mockGetAnswerCheck = vi.mocked(getAnswerCheck);

function makeState(): ChatUIState {
  return {
    isSending: false,
    messageInput: "",
    fileList: [],
    historyQuestion: null,
    copyVisible: 0,
    copyTimeRef: undefined,
    logData: {},
    loadingLog: {},
    refreshingMessages: {},
    reactions: {},
    updatingLog: {},
    logErrorKinds: {},
    sendStartedAt: null,
    activeAgentName: "",
    completing: false,
    mode: "instant",
    isStreaming: false,
    streamingMessageId: null,
    uploadTransfer: null,
    selectedAgent: "",
    renderedChat: null,
    activeRequestId: "",
    generationStopped: false,
    activityExpandedByMessage: {},
  };
}

describe("useSelectChat", () => {
  // Each dialogueId maps to one mutable state record; repeated getChatState(id) returns the same object
  let states: Map<string, ChatUIState>;
  let getChatState: (dialogueId: string) => ChatUIState;
  let currentChatId: ReturnType<typeof ref<string>>;
  let chatList: ReturnType<typeof ref<any>>;
  let scrollToBottom: ReturnType<typeof vi.fn>;
  let updateUrlWithChatId: ReturnType<typeof vi.fn>;
  let timestamp: ReturnType<typeof ref<number>>;

  beforeEach(() => {
    vi.clearAllMocks();
    states = new Map();
    getChatState = (dialogueId: string) => {
      if (!states.has(dialogueId)) {
        states.set(dialogueId, makeState());
      }
      return states.get(dialogueId)!;
    };
    currentChatId = ref("");
    chatList = ref([
      { id: 1, dialogue_id: "d1", title: "t", date: "", isFavorite: false },
      { id: 2, dialogue_id: "d2", title: "t2", date: "", isFavorite: false },
    ]);
    scrollToBottom = vi.fn();
    updateUrlWithChatId = vi.fn();
    timestamp = ref(0);
  });

  function makeComposable() {
    return useSelectChat({
      getChatState,
      currentChatId,
      scrollToBottom,
      updateUrlWithChatId,
      chatList,
      timestamp,
    });
  }

  it("ChatAgent history: syncs currentChatId, hydrates reaction, rebuilds messages, sets historyQuestion, updates URL", async () => {
    mockGetAnswerCheck.mockResolvedValueOnce({
      code: 200,
      data: [
        {
          id: "msg-1",
          reaction_type: "1",
          query: "Hello",
          answer: "Hello, I'm the assistant",
          tool_name: "ChatAgent",
        },
      ],
    } as any);

    const { selectChat } = makeComposable();
    await selectChat("d1");

    // currentChatId is written synchronously before the await
    expect(currentChatId.value).toBe("d1");

    // reaction hydration (string "1" → number 1)
    expect(getChatState("d1").reactions["msg-1"]).toBe(1);

    // messages rebuilt into this dialogue's renderedChat owner
    const rendered = getChatState("d1").renderedChat;
    expect(rendered).not.toBeNull();
    const messages = rendered!.messages;
    expect(Array.isArray(messages)).toBe(true);
    expect(messages.length).toBe(2);

    const userMsg = messages[0];
    expect(userMsg.role).toBe("user");
    expect(userMsg.content).toBe("Hello");

    const assistantMsg = messages[1];
    expect(assistantMsg.role).toBe("assistant");
    expect(assistantMsg.content).toBe("Hello, I'm the assistant");
    expect(assistantMsg.tool_name).toBe("ChatAgent");
    expect(assistantMsg.id).toBe("msg-1");

    // renderedChat merges in the original chat record's fields
    expect(rendered!.dialogue_id).toBe("d1");
    expect(rendered!.title).toBe("t");

    // historyQuestion is set (non-null, holding two condensed records)
    const hq = getChatState("d1").historyQuestion;
    expect(Array.isArray(hq)).toBe(true);
    expect(hq.length).toBe(2);
    expect(hq[0]).toEqual({ role: "user", content: "Hello" });
    expect(hq[1]).toEqual({ role: "assistant", content: "Hello, I'm the assistant" });

    // URL updated
    expect(updateUrlWithChatId).toHaveBeenCalledWith("d1");

    // Scroll to bottom when there are messages
    expect(scrollToBottom).toHaveBeenCalled();
  });

  it("resets reaction state before loading: stale entries are cleared before hydration", async () => {
    // Seed a stale reaction (pointing to the same d1 record)
    const stale = getChatState("d1");
    stale.reactions = { "old-msg": 2 };

    mockGetAnswerCheck.mockResolvedValueOnce({
      code: 200,
      data: [
        {
          id: "msg-1",
          reaction_type: "1",
          query: "Question",
          answer: "Answer",
          tool_name: "ChatAgent",
        },
      ],
    } as any);

    const { selectChat } = makeComposable();
    await selectChat("d1");

    const reactions = getChatState("d1").reactions;
    // The stale entry is cleared
    expect(reactions["old-msg"]).toBeUndefined();
    // The new entry is hydrated
    expect(reactions["msg-1"]).toBe(1);
  });

  it("reselects a live rendered owner without overwriting its message runtime from history", async () => {
    const transport = vi.fn();
    const runtime = {
      dialogueId: "d1",
      messageId: "live-message",
      runId: "live-run",
      transport,
    };
    const liveMessage: ChatMessage = {
      role: "assistant",
      content: "",
      streaming: true,
      a2uiRuntime: runtime,
      blocks: [],
    };
    const state = getChatState("d1");
    state.renderedChat = { dialogue_id: "d1", messages: [liveMessage] };
    const renderedOwner = state.renderedChat;

    const { selectChat } = makeComposable();
    await selectChat("d1");

    expect(mockGetAnswerCheck).not.toHaveBeenCalled();
    expect(state.renderedChat).toBe(renderedOwner);
    expect(state.renderedChat?.messages[0].a2uiRuntime).toBe(runtime);
    expect(updateUrlWithChatId).toHaveBeenCalledWith("d1");
    expect(scrollToBottom).toHaveBeenCalledTimes(1);
  });

  it("non-200 response: does not rebuild messages or reset historyQuestion, but still updates URL when still active", async () => {
    // Seed a non-empty historyQuestion to verify the non-200 branch does not touch it
    const st = getChatState("d1");
    st.historyQuestion = [{ role: "user", content: "keep me" }];

    mockGetAnswerCheck.mockResolvedValueOnce({ code: 500, data: [] } as any);

    const { selectChat } = makeComposable();
    await selectChat("d1");

    // The synchronous currentChatId write still happens
    expect(currentChatId.value).toBe("d1");
    // The non-200 branch skips the renderedChat assignment
    expect(getChatState("d1").renderedChat).toBeNull();
    // historyQuestion is not reset
    expect(getChatState("d1").historyQuestion).toEqual([
      { role: "user", content: "keep me" },
    ]);
    // The URL is updated while still active
    expect(updateUrlWithChatId).toHaveBeenCalledWith("d1");
  });

  it("concurrent-switch safety: after mid-fetch currentChatId switch, reaction and historyQuestion write back to the argument dialogueId, not the live currentChatId", async () => {
    // Manually control when getAnswerCheck resolves
    let resolveCheck!: (v: any) => void;
    const pendingCheck = new Promise<any>((resolve) => {
      resolveCheck = resolve;
    });
    mockGetAnswerCheck.mockReturnValueOnce(pendingCheck);

    const { selectChat } = makeComposable();

    // 1. Start selectChat("d1") but don't await — the fetch hangs
    const p = selectChat("d1");

    // 2. During the await, the user switches to d2
    currentChatId.value = "d2";

    // 3. Resolve the fetch with a ChatAgent-style reaction_type
    resolveCheck({
      code: 200,
      data: [
        {
          id: "msg-concurrent",
          reaction_type: "2",
          query: "Concurrent question",
          answer: "Concurrent answer",
          tool_name: "ChatAgent",
        },
      ],
    });

    await p;

    // reaction hydration writes to the argument d1, not to the live currentChatId d2
    expect(getChatState("d1").reactions["msg-concurrent"]).toBe(2);
    expect(getChatState("d2").reactions["msg-concurrent"]).toBeUndefined();

    // historyQuestion is also written to d1
    const hq = getChatState("d1").historyQuestion;
    expect(Array.isArray(hq)).toBe(true);
    expect(hq.length).toBe(2);
    expect(getChatState("d2").historyQuestion).toBeNull();

    // rendered data lands on d1 only; late response does not steal URL/scroll
    expect(getChatState("d1").renderedChat?.messages.length).toBe(2);
    expect(getChatState("d2").renderedChat).toBeNull();
    expect(currentChatId.value).toBe("d2");
    expect(updateUrlWithChatId).not.toHaveBeenCalled();
    expect(scrollToBottom).not.toHaveBeenCalled();
  });

  it("out-of-order A/B history responses populate only their states and never revert current ID/URL/scroll", async () => {
    let resolveA!: (v: any) => void;
    let resolveB!: (v: any) => void;
    const pendingA = new Promise<any>((resolve) => {
      resolveA = resolve;
    });
    const pendingB = new Promise<any>((resolve) => {
      resolveB = resolve;
    });

    mockGetAnswerCheck
      .mockReturnValueOnce(pendingA)
      .mockReturnValueOnce(pendingB);

    const { selectChat } = makeComposable();
    const pA = selectChat("d1");
    const pB = selectChat("d2");

    expect(currentChatId.value).toBe("d2");

    // B resolves first
    resolveB({
      code: 200,
      data: [
        {
          id: "msg-b",
          query: "B-q",
          answer: "B-a",
          tool_name: "ChatAgent",
        },
      ],
    });
    await pB;

    expect(currentChatId.value).toBe("d2");
    expect(getChatState("d2").renderedChat?.messages[0].content).toBe("B-q");
    expect(updateUrlWithChatId).toHaveBeenCalledTimes(1);
    expect(updateUrlWithChatId).toHaveBeenCalledWith("d2");
    expect(scrollToBottom).toHaveBeenCalledTimes(1);

    // A resolves later — data only, no foreground steal
    resolveA({
      code: 200,
      data: [
        {
          id: "msg-a",
          query: "A-q",
          answer: "A-a",
          tool_name: "ChatAgent",
        },
      ],
    });
    await pA;

    expect(currentChatId.value).toBe("d2");
    expect(getChatState("d1").renderedChat?.messages[0].content).toBe("A-q");
    expect(getChatState("d2").renderedChat?.messages[0].content).toBe("B-q");
    expect(updateUrlWithChatId).toHaveBeenCalledTimes(1);
    expect(updateUrlWithChatId).toHaveBeenCalledWith("d2");
    expect(scrollToBottom).toHaveBeenCalledTimes(1);
  });

  it("history AnalystAgent hydrates the existing task_id onto the message", async () => {
    mockGetAnswerCheck.mockResolvedValueOnce({
      code: 200,
      data: [
        {
          id: "1001",
          query: "run analysis",
          answer: "analysis started",
          tool_name: "AnalystAgent",
          task_id: "ei-task-abc",
          compute_resource: "analyst-agents-small",
        },
      ],
    } as any);

    const { selectChat } = makeComposable();
    await selectChat("d1");

    const assistant = getChatState("d1").renderedChat!.messages[1];
    expect(assistant.tool_name).toBe("AnalystAgent");
    expect(assistant.id).toBe("1001");
    expect(assistant.task_id).toBe("ei-task-abc");
  });
});
