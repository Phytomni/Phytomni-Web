import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import { ElMessage } from "element-plus";
import { useRefreshMessage } from "@/views/chat/composables/useRefreshMessage";

// Mock getQuery API (the only API refreshMessage calls)
vi.mock("@/api/chat", () => ({
  getQuery: vi.fn(),
}));

import { getQuery } from "@/api/chat";

const mockGetQuery = vi.mocked(getQuery);

type ChatStateRecord = {
  isSending: boolean;
  refreshingMessages: Record<string, boolean>;
  reactions: Record<string, number>;
  historyQuestion: any;
  fileList: any[];
};

describe("useRefreshMessage", () => {
  // Each dialogueId maps to one mutable state record; repeated getChatState(id) returns the same object
  let states: Map<string, ChatStateRecord>;
  let getChatState: (dialogueId: string) => any;
  let currentChatId: ReturnType<typeof ref<string>>;
  let currentChat: ReturnType<typeof ref<any>>;
  let scrollToBottom: ReturnType<typeof vi.fn>;
  let getHistoryQuestionData: ReturnType<typeof vi.fn>;
  let getDialogueIdFromChatId: ReturnType<typeof vi.fn>;
  let timestamp: ReturnType<typeof ref<number>>;
  // ElMessage.error spy (setup.ts's afterEach restoreAllMocks restores it, so rebuild it per case)
  let elMessageErrorSpy: ReturnType<typeof vi.spyOn>;

  function makeState(): ChatStateRecord {
    return {
      isSending: false,
      refreshingMessages: {},
      reactions: {},
      historyQuestion: null,
      fileList: [],
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
      return states.get(dialogueId);
    };
    currentChatId = ref("A");
    // Index 0 = user message, index 1 = assistant message
    currentChat = ref({
      messages: [
        { role: "user", content: "Original question" },
        {
          role: "assistant",
          content: "Old answer",
          id: "msg-1",
          tool_name: "ChatAgent",
        },
      ],
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
        answer: JSON.stringify({ content: "New answer", doc_list: [{ pm: "1" }] }),
        id: "msg-2",
        reaction_type: "1",
        status: "done",
      },
    } as any);

    const { refreshMessage } = makeComposable();
    await refreshMessage(1);

    // currentChat.value.messages[1] is replaced by the rebuilt assistant message
    const rebuilt = currentChat.value.messages[1];
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

  it("🔒 CAPTURE INVARIANT: switching dialogue during await, cleanup still lands on the initiating dialogue A, B is not touched", async () => {
    // Manually control when getQuery resolves
    let resolveQuery!: (value: any) => void;
    const pending = new Promise((resolve) => {
      resolveQuery = resolve;
    });
    mockGetQuery.mockReturnValueOnce(pending as any);

    const { refreshMessage } = makeComposable();

    // Don't await — let the refresh hang at await getQuery
    const p = refreshMessage(1);

    // At this point the refresh is in-flight on A: isSending=true, refreshKey truthy
    expect(getChatState("A").isSending).toBe(true);
    expect(getChatState("A").refreshingMessages["1_msg-1"]).toBe(true);

    // User switches to dialogue B
    currentChatId.value = "B";

    // Now resolve getQuery and wait for the whole thing to finish
    resolveQuery({
      data: { tool_name: "ChatAgent", answer: "Late answer", id: "msg-2" },
    });
    await p;

    // Cleanup lands on the captured dialogue A: isSending reset, refreshKey cleared
    expect(getChatState("A").isSending).toBe(false);
    expect(getChatState("A").refreshingMessages["1_msg-1"]).toBeUndefined();

    // B's chatState is never touched by refreshMessage throughout:
    // after refreshMessage captures A's chatState it never re-reads getChatState,
    // so the "B" key never appears in the Map (B is never read/written at the chatState layer).
    expect(states.has("B")).toBe(false);

    // finally still runs (fetching history)
    expect(getHistoryQuestionData).toHaveBeenCalledTimes(1);
  });

  it("Failure path: getQuery rejects → ElMessage.error called, isSending reset in finally", async () => {
    mockGetQuery.mockRejectedValueOnce(new Error("network down"));

    const { refreshMessage } = makeComposable();
    await refreshMessage(1);

    // The error message is triggered
    expect(elMessageErrorSpy).toHaveBeenCalledWith("Refresh failed, please try again");

    // isSending is reset to false in finally
    expect(getChatState("A").isSending).toBe(false);

    // The old refreshKey is cleaned up in finally
    expect(getChatState("A").refreshingMessages["1_msg-1"]).toBeUndefined();

    // The finally history fetch still runs
    expect(getHistoryQuestionData).toHaveBeenCalledTimes(1);
  });
});
