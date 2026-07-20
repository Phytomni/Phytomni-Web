import { describe, it, expect, vi, beforeEach } from "vitest";
import { computed, ref } from "vue";
import { ElMessage } from "element-plus";
import { useRefreshMessage } from "@/views/chat/composables/useRefreshMessage";
import type { ChatUIState, ChatView } from "@/views/chat/types";

// Mock getQuery API (the only API refreshMessage calls)
vi.mock("@/api/chat", () => ({
  getQuery: vi.fn(),
}));

import { getQuery } from "@/api/chat";

const mockGetQuery = vi.mocked(getQuery);

describe("useRefreshMessage", () => {
  // Each dialogueId maps to one mutable state record; repeated getChatState(id) returns the same object
  let states: Map<string, ChatUIState>;
  let getChatState: (dialogueId: string) => ChatUIState;
  let currentChatId: ReturnType<typeof ref<string>>;
  let currentChat: ReturnType<typeof computed<ChatView | null>>;
  let scrollToBottom: ReturnType<typeof vi.fn>;
  let getHistoryQuestionData: ReturnType<typeof vi.fn>;
  let getDialogueIdFromChatId: ReturnType<typeof vi.fn>;
  let timestamp: ReturnType<typeof ref<number>>;
  // ElMessage.error spy (setup.ts's afterEach restoreAllMocks restores it, so rebuild it per case)
  let elMessageErrorSpy: ReturnType<typeof vi.spyOn>;

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
      sendStartedAt: null,
      activeAgentName: "",
      completing: false,
      mode: "instant",
      isStreaming: false,
      streamingMessageId: null,
      uploadTransfer: null,
      selectedAgent: "",
      renderedChat: null,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    elMessageErrorSpy = vi
      .spyOn(ElMessage, "error")
      .mockImplementation(() => undefined as any);
    states = new Map();
    getChatState = (dialogueId: string) => {
      if (!states.has(dialogueId)) {
        states.set(dialogueId, makeState());
      }
      return states.get(dialogueId)!;
    };
    currentChatId = ref("A");
    // Index 0 = user message, index 1 = assistant message — owned by A's renderedChat
    const messagesA = [
      { role: "user", content: "Original question" },
      {
        role: "assistant",
        content: "Old answer",
        id: "msg-1",
        tool_name: "ChatAgent",
      },
    ];
    getChatState("A").renderedChat = { messages: messagesA };
    getChatState("B").renderedChat = {
      messages: [
        { role: "user", content: "B question" },
        { role: "assistant", content: "B answer", id: "msg-b" },
      ],
    };
    currentChat = computed({
      get: () => {
        if (!currentChatId.value) return null;
        return getChatState(currentChatId.value).renderedChat;
      },
      set: (value: ChatView | null) => {
        if (!currentChatId.value) return;
        getChatState(currentChatId.value).renderedChat = value;
      },
    });
    scrollToBottom = vi.fn();
    getHistoryQuestionData = vi.fn().mockResolvedValue(undefined);
    getDialogueIdFromChatId = vi.fn().mockReturnValue(7);
    timestamp = ref(0);
  });

  function makeComposable() {
    return useRefreshMessage({
      currentChat,
      currentChatId,
      getChatState,
      scrollToBottom,
      getHistoryQuestionData,
      getDialogueIdFromChatId,
      timestamp,
    });
  }

  it("Happy path: KnowledgeAgent rebuilds the assistant message, hydrates reaction, clears refresh state, resets isSending, fetches history in finally", async () => {
    // KnowledgeAgent branch: the JSON answer parses out content/doc_list, and it also syncs the reaction
    mockGetQuery.mockResolvedValueOnce({
      data: {
        tool_name: "KnowledgeAgent",
        answer: JSON.stringify({
          content: "New answer",
          doc_list: [{ pm: "1" }],
        }),
        id: "msg-2",
        reaction_type: "1",
        status: "done",
      },
    } as any);

    const { refreshMessage } = makeComposable();
    await refreshMessage(1);

    // A's captured messages[1] is replaced by the rebuilt assistant message
    const rebuilt = getChatState("A").renderedChat!.messages[1];
    expect(rebuilt.role).toBe("assistant");
    expect(rebuilt.content).toBe("New answer");
    expect(rebuilt.doc_list).toEqual([{ pm: "1" }]);
    expect(rebuilt.tool_name).toBe("KnowledgeAgent");
    expect(rebuilt.id).toBe("msg-2");
    expect(rebuilt.instantMessage).toBe(true);

    // The reaction is hydrated into A's chatState (string "1" → number 1)
    expect(getChatState("A").reactions["msg-2"]).toBe(1);

    // isSending is reset to false in finally
    expect(getChatState("A").isSending).toBe(false);

    // The old refreshKey is cleaned up (1_msg-1)
    expect(getChatState("A").refreshingMessages["1_msg-1"]).toBeUndefined();

    // getHistoryQuestionData is called in finally
    expect(getHistoryQuestionData).toHaveBeenCalledTimes(1);
  });

  it("normalizes malformed follow-up JSON without discarding the refreshed answer", async () => {
    mockGetQuery.mockResolvedValueOnce({
      data: {
        tool_name: "ChatAgent",
        answer: "Refreshed answer",
        id: "msg-2",
        follow_up_questions: "not-json",
      },
    } as any);

    const { refreshMessage } = makeComposable();
    await refreshMessage(1);

    const rebuilt = getChatState("A").renderedChat!.messages[1];
    expect(rebuilt.content).toBe("Refreshed answer");
    expect(rebuilt.followUpQuestions).toEqual([]);
    expect(elMessageErrorSpy).not.toHaveBeenCalled();
  });

  it("🔒 CAPTURE INVARIANT: switching dialogue during await, cleanup still lands on the initiating dialogue A, B is not touched", async () => {
    // Manually control when getQuery resolves
    let resolveQuery!: (value: any) => void;
    const pending = new Promise((resolve) => {
      resolveQuery = resolve;
    });
    mockGetQuery.mockReturnValueOnce(pending as any);

    const { refreshMessage } = makeComposable();
    const messagesA = getChatState("A").renderedChat!.messages;
    const messagesB = getChatState("B").renderedChat!.messages;
    const bAnswerBefore = messagesB[1].content;

    // Don't await — let the refresh hang at await getQuery
    const p = refreshMessage(1);

    // At this point the refresh is in-flight on A: isSending=true, refreshKey truthy
    expect(getChatState("A").isSending).toBe(true);
    expect(getChatState("A").refreshingMessages["1_msg-1"]).toBe(true);

    // User switches to dialogue B
    currentChatId.value = "B";
    scrollToBottom.mockClear();

    // Now resolve getQuery and wait for the whole thing to finish
    resolveQuery({
      data: { tool_name: "ChatAgent", answer: "Late answer", id: "msg-2" },
    });
    await p;

    // Cleanup lands on the captured dialogue A: isSending reset, refreshKey cleared
    expect(getChatState("A").isSending).toBe(false);
    expect(getChatState("A").refreshingMessages["1_msg-1"]).toBeUndefined();

    // A's captured array was updated; B's messages/DOM side effects untouched
    expect(messagesA[1].content).toBe("Late answer");
    expect(messagesA[1].id).toBe("msg-2");
    expect(getChatState("B").renderedChat!.messages).toBe(messagesB);
    expect(messagesB[1].content).toBe(bAnswerBefore);
    expect(scrollToBottom).not.toHaveBeenCalled();
    expect(elMessageErrorSpy).not.toHaveBeenCalled();

    // finally still runs (fetching history)
    expect(getHistoryQuestionData).toHaveBeenCalledTimes(1);
  });

  it("A refresh pending→B active: failure toast is suppressed while B is foreground", async () => {
    let rejectQuery!: (error: Error) => void;
    const pending = new Promise((_resolve, reject) => {
      rejectQuery = reject;
    });
    mockGetQuery.mockReturnValueOnce(pending as any);

    const { refreshMessage } = makeComposable();
    const p = refreshMessage(1);
    currentChatId.value = "B";
    scrollToBottom.mockClear();

    rejectQuery(new Error("network down"));
    await p;

    expect(elMessageErrorSpy).not.toHaveBeenCalled();
    expect(scrollToBottom).not.toHaveBeenCalled();
    expect(getChatState("A").isSending).toBe(false);
    expect(getChatState("B").isSending).toBe(false);
  });

  it("Failure path: getQuery rejects → ElMessage.error called, isSending reset in finally", async () => {
    mockGetQuery.mockRejectedValueOnce(new Error("network down"));

    const { refreshMessage } = makeComposable();
    await refreshMessage(1);

    // The error message is triggered
    expect(elMessageErrorSpy).toHaveBeenCalledWith(
      "Refresh failed, please try again"
    );

    // isSending is reset to false in finally
    expect(getChatState("A").isSending).toBe(false);

    // The old refreshKey is cleaned up in finally
    expect(getChatState("A").refreshingMessages["1_msg-1"]).toBeUndefined();

    // The finally history fetch still runs
    expect(getHistoryQuestionData).toHaveBeenCalledTimes(1);
  });
});
