import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import { useSendMessage } from "@/views/chat/composables/useSendMessage";

// getQueryAbortable (main send) + getAnswerCheck (network-error recovery) are APIs the
// composable imports directly, so they must be mocked.
vi.mock("@/api/chat", () => ({
  getQueryAbortable: vi.fn(),
  getAnswerCheck: vi.fn(),
}));

// element-plus's ElMessage/ElMessageBox are invoked on a failed pending write / the 403 dialog.
vi.mock("element-plus", () => ({
  ElMessage: { warning: vi.fn() },
  ElMessageBox: { alert: vi.fn() },
}));

// pending-chat utilities: localStorage write/clear (only new_-prefixed dialogues take this path).
vi.mock("@/utils/pending-chat", () => ({
  writePendingChat: vi.fn(),
  clearPendingChat: vi.fn(),
  isLocalStorageChat: vi.fn(() => false),
}));

// network-error detection: default is not a network error.
vi.mock("@/utils/network-error", () => ({
  isNetworkError: vi.fn(() => false),
}));

import { getQueryAbortable } from "@/api/chat";

const mockGetQueryAbortable = vi.mocked(getQueryAbortable);

type ChatStateRecord = {
  isSending: boolean;
  messageInput: string;
  fileList: any[];
  historyQuestion: any;
  reactions: Record<string, number>;
};

describe("useSendMessage", () => {
  // One mutable state per dialogueId; repeated getChatState(id) returns the same object
  let states: Map<string, ChatStateRecord>;
  let getChatState: (dialogueId: string) => ChatStateRecord;
  let currentChatId: ReturnType<typeof ref<string>>;
  let currentChat: ReturnType<typeof ref<any>>;
  let senderRef: ReturnType<typeof ref<any>>;
  let currentRequestId: ReturnType<typeof ref<string>>;
  let isAborted: ReturnType<typeof ref<boolean>>;
  let chatList: ReturnType<typeof ref<any>>;
  let timestamp: ReturnType<typeof ref<number>>;
  let getHistoryQuestionData: ReturnType<typeof vi.fn>;
  let updateUrlWithChatId: ReturnType<typeof vi.fn>;
  let selectChat: ReturnType<typeof vi.fn>;
  let getDialogueIdFromChatId: ReturnType<typeof vi.fn>;
  let getChatIdFromUrl: ReturnType<typeof vi.fn>;
  let scrollToBottom: ReturnType<typeof vi.fn>;

  function makeState(overrides: Partial<ChatStateRecord> = {}): ChatStateRecord {
    return {
      isSending: false,
      messageInput: "hi",
      fileList: [],
      historyQuestion: null,
      reactions: {},
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    states = new Map();
    states.set("A", makeState());
    states.set("B", makeState({ messageInput: "" }));
    getChatState = (dialogueId: string) => {
      if (!states.has(dialogueId)) {
        states.set(dialogueId, makeState());
      }
      return states.get(dialogueId)!;
    };
    currentChatId = ref("A");
    currentChat = ref({ messages: [] });
    senderRef = ref({ closeHeader: vi.fn() });
    currentRequestId = ref("");
    isAborted = ref(false);
    chatList = ref([
      { id: 1, dialogue_id: "A", title: "t", date: "", isFavorite: false },
    ]);
    timestamp = ref(0);
    getHistoryQuestionData = vi.fn().mockResolvedValue(undefined);
    updateUrlWithChatId = vi.fn();
    selectChat = vi.fn();
    getDialogueIdFromChatId = vi.fn(() => undefined);
    getChatIdFromUrl = vi.fn(() => null);
    scrollToBottom = vi.fn();
  });

  function makeComposable() {
    return useSendMessage({
      getChatState,
      currentChatId: currentChatId as any,
      currentChat,
      senderRef,
      currentRequestId: currentRequestId as any,
      isAborted: isAborted as any,
      t: (k: string) => k,
      userStore: () => ({}),
      getHistoryQuestionData,
      updateUrlWithChatId,
      chatList,
      timestamp: timestamp as any,
      selectChat,
      getDialogueIdFromChatId,
      getChatIdFromUrl,
      scrollToBottom,
    });
  }

  it("happy path: pushes user+assistant messages, clears input/files, resets isSending, syncs reaction", async () => {
    states.get("A")!.messageInput = "Hello world";
    mockGetQueryAbortable.mockResolvedValueOnce({
      data: {
        tool_name: "ChatAgents",
        answer: "I'm the assistant",
        id: "msg-1",
        reaction_type: "1",
        follow_up_questions: [],
      },
    } as any);

    const { sendMessage } = makeComposable();
    await sendMessage();

    // Pushed one user message + one assistant message
    const msgs = currentChat.value.messages;
    expect(msgs.length).toBe(2);
    expect(msgs[0].role).toBe("user");
    expect(msgs[0].content).toContain("Hello world");
    expect(msgs[1].role).toBe("assistant");
    expect(msgs[1].content).toBe("I'm the assistant");

    // Cleanup is done via the captured chatState
    const stateA = getChatState("A");
    expect(stateA.messageInput).toBe("");
    expect(stateA.isSending).toBe(false);
    expect(stateA.fileList).toEqual([]);

    // The reaction was synced
    expect(stateA.reactions["msg-1"]).toBe(1);

    // The request was called once
    expect(mockGetQueryAbortable).toHaveBeenCalledTimes(1);
  });

  it("🔒 capture invariant: switching currentChatId mid-send, cleanup still lands on the captured original dialogue A", async () => {
    states.get("A")!.messageInput = "Original dialogue message";

    // A is an existing dialogue (messages non-empty) => isNewChat=false, so finally
    // won't reset currentChatId back to A; that way, after switching to B, if cleanup
    // mis-reads currentChatId.value it would land on B, exposing a broken capture invariant.
    currentChat.value = {
      messages: [{ role: "user", content: "Previous message" }],
    };

    // A manually-controlled promise, simulating a pending request
    let resolveQuery!: (v: any) => void;
    const pending = new Promise((resolve) => {
      resolveQuery = resolve;
    });
    mockGetQueryAbortable.mockReturnValueOnce(pending as any);

    const { sendMessage } = makeComposable();

    // Don't await, let the request hang
    const sendPromise = sendMessage();

    // Wait for the synchronous phase + the microtasks before scrollToBottom to run
    await Promise.resolve();
    await Promise.resolve();

    // At this point the original dialogue A is mid-send
    expect(getChatState("A").isSending).toBe(true);

    // User switches to dialogue B
    currentChatId.value = "B";

    // The request completes
    resolveQuery({
      data: {
        tool_name: "ChatAgents",
        answer: "Late answer",
        id: "msg-late",
        reaction_type: "2",
        follow_up_questions: [],
      },
    });
    await sendPromise;

    // Cleanup lands on the captured A: isSending reset, fileList cleared
    expect(getChatState("A").isSending).toBe(false);
    expect(getChatState("A").fileList).toEqual([]);

    // B's isSending is never touched (always false, and never set to true)
    expect(getChatState("B").isSending).toBe(false);

    // reaction is synced to the captured A, not the current B
    expect(getChatState("A").reactions["msg-late"]).toBe(2);
    expect(getChatState("B").reactions["msg-late"]).toBeUndefined();
  });

  it("empty input guard: returns early when messageInput is empty, does not call getQueryAbortable", async () => {
    states.get("A")!.messageInput = "";

    const { sendMessage } = makeComposable();
    await sendMessage();

    expect(mockGetQueryAbortable).not.toHaveBeenCalled();
    expect(currentChat.value.messages.length).toBe(0);
    expect(getChatState("A").isSending).toBe(false);
  });
});
