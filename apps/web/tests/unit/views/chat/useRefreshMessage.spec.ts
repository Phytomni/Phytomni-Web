import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { computed, ref } from "vue";
import { ElMessage } from "element-plus";
import { useRefreshMessage } from "@/views/chat/composables/useRefreshMessage";
import type {
  ChatMessage,
  ChatUIState,
  ChatView,
  DialogueReconciliationResult,
} from "@/views/chat/types";
import type { ApiEnvelope, DecodedQueryData } from "@/api/types";
import {
  buildApiEnvelope,
  buildDecodedQueryData,
} from "../../../helpers/apiBuilders";
import {
  buildChatMessage,
  buildChatState,
} from "../../../helpers/chatBuilders";
import { deferred, mustGet } from "../../../helpers/mockFactories";

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
  let scrollToBottom: Mock<() => Promise<void>>;
  let getHistoryQuestionData: Mock<
    () => Promise<DialogueReconciliationResult | undefined>
  >;
  let getDialogueIdFromChatId: Mock<() => string | number | null | undefined>;
  let timestamp: ReturnType<typeof ref<number>>;
  // ElMessage.error spy (setup.ts's afterEach restoreAllMocks restores it, so rebuild it per case)
  let elMessageErrorSpy: ReturnType<typeof vi.spyOn>;

  function makeState(): ChatUIState {
    return buildChatState();
  }

  beforeEach(() => {
    vi.clearAllMocks();
    elMessageErrorSpy = vi
      .spyOn(ElMessage, "error")
      .mockImplementation(() => ({ close: vi.fn() }));
    states = new Map();
    getChatState = (dialogueId: string) => {
      if (!states.has(dialogueId)) {
        states.set(dialogueId, makeState());
      }
      return mustGet(states.get(dialogueId), `chat state ${dialogueId}`);
    };
    currentChatId = ref("A");
    // Index 0 = user message, index 1 = assistant message — owned by A's renderedChat
    const messagesA: ChatMessage[] = [
      buildChatMessage({ role: "user", content: "Original question" }),
      buildChatMessage({
        role: "assistant",
        content: "Old answer",
        id: "msg-1",
        tool_name: "ChatAgent",
      }),
    ];
    getChatState("A").renderedChat = { messages: messagesA };
    getChatState("B").renderedChat = {
      messages: [
        buildChatMessage({ role: "user", content: "B question" }),
        buildChatMessage({
          role: "assistant",
          content: "B answer",
          id: "msg-b",
        }),
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
    scrollToBottom = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    getHistoryQuestionData = vi
      .fn<() => Promise<DialogueReconciliationResult | undefined>>()
      .mockResolvedValue(undefined);
    getDialogueIdFromChatId = vi
      .fn<() => string | number | null | undefined>()
      .mockReturnValue(7);
    timestamp = ref(0);
  });

  function queryResponse(
    overrides: Partial<DecodedQueryData> = {}
  ): ApiEnvelope<DecodedQueryData> {
    return buildApiEnvelope(buildDecodedQueryData(overrides));
  }

  function stateFor(dialogueId: string): ChatUIState {
    return mustGet(states.get(dialogueId), `chat state ${dialogueId}`);
  }

  function messagesFor(dialogueId: string, label: string): ChatMessage[] {
    return mustGet(stateFor(dialogueId).renderedChat, `${label}: rendered chat`)
      .messages;
  }

  function messageAt(
    dialogueId: string,
    index: number,
    label: string
  ): ChatMessage {
    return mustGet(messagesFor(dialogueId, label)[index], label);
  }

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
    mockGetQuery.mockResolvedValueOnce(
      queryResponse({
        tool_name: "KnowledgeAgent",
        answer: JSON.stringify({
          content: "New answer",
          doc_list: [{ pm: "1" }],
        }),
        id: "msg-2",
        reaction_type: "1",
        status: "done",
      })
    );

    const { refreshMessage } = makeComposable();
    await refreshMessage(1);

    // A's captured messages[1] is replaced by the rebuilt assistant message
    const rebuilt = messageAt("A", 1, "KnowledgeAgent refresh");
    expect(rebuilt.role).toBe("assistant");
    expect(rebuilt.content).toBe("New answer");
    expect(rebuilt.doc_list).toEqual([{ pm: "1" }]);
    expect(rebuilt.tool_name).toBe("KnowledgeAgent");
    expect(rebuilt.id).toBe("msg-2");
    expect(rebuilt.instantMessage).toBe(true);

    // The reaction is hydrated into A's chatState (string "1" → number 1)
    expect(stateFor("A").reactions["msg-2"]).toBe(1);

    // isSending is reset to false in finally
    expect(stateFor("A").isSending).toBe(false);

    // The old refreshKey is cleaned up (1_msg-1)
    expect(stateFor("A").refreshingMessages["1_msg-1"]).toBeUndefined();

    // getHistoryQuestionData is called in finally
    expect(getHistoryQuestionData).toHaveBeenCalledTimes(1);
  });

  it("normalizes malformed follow-up JSON without discarding the refreshed answer", async () => {
    mockGetQuery.mockResolvedValueOnce(
      queryResponse({
        tool_name: "ChatAgent",
        answer: "Refreshed answer",
        id: "msg-2",
        follow_up_questions: "not-json",
      })
    );

    const { refreshMessage } = makeComposable();
    await refreshMessage(1);

    const rebuilt = messageAt("A", 1, "malformed follow-up refresh");
    expect(rebuilt.content).toBe("Refreshed answer");
    expect(rebuilt.followUpQuestions).toEqual([]);
    expect(elMessageErrorSpy).not.toHaveBeenCalled();
  });

  it("🔒 CAPTURE INVARIANT: switching dialogue during await, cleanup still lands on the initiating dialogue A, B is not touched", async () => {
    // Manually control when getQuery resolves
    const pending = deferred<ApiEnvelope<DecodedQueryData>>();
    mockGetQuery.mockReturnValueOnce(pending.promise);

    const { refreshMessage } = makeComposable();
    const messagesA = messagesFor("A", "captured A messages");
    const messagesB = messagesFor("B", "captured B messages");
    const bAnswerBefore = messageAt("B", 1, "B before refresh").content;

    // Don't await — let the refresh hang at await getQuery
    const p = refreshMessage(1);

    // At this point the refresh is in-flight on A: isSending=true, refreshKey truthy
    expect(stateFor("A").isSending).toBe(true);
    expect(stateFor("A").refreshingMessages["1_msg-1"]).toBe(true);

    // User switches to dialogue B
    currentChatId.value = "B";
    scrollToBottom.mockClear();

    // Now resolve getQuery and wait for the whole thing to finish
    pending.resolve(
      queryResponse({
        tool_name: "ChatAgent",
        answer: "Late answer",
        id: "msg-2",
      })
    );
    await p;

    // Cleanup lands on the captured dialogue A: isSending reset, refreshKey cleared
    expect(stateFor("A").isSending).toBe(false);
    expect(stateFor("A").refreshingMessages["1_msg-1"]).toBeUndefined();

    // A's captured array was updated; B's messages/DOM side effects untouched
    expect(messagesFor("A", "A after refresh")).toBe(messagesA);
    expect(messageAt("A", 1, "A after refresh").content).toBe("Late answer");
    expect(messageAt("A", 1, "A after refresh").id).toBe("msg-2");
    expect(messagesFor("B", "B after refresh")).toBe(messagesB);
    expect(messageAt("B", 1, "B after refresh").content).toBe(bAnswerBefore);
    expect(scrollToBottom).not.toHaveBeenCalled();
    expect(elMessageErrorSpy).not.toHaveBeenCalled();

    // finally still runs (fetching history)
    expect(getHistoryQuestionData).toHaveBeenCalledTimes(1);
  });

  it("A refresh pending→B active: failure toast is suppressed while B is foreground", async () => {
    const pending = deferred<ApiEnvelope<DecodedQueryData>>();
    mockGetQuery.mockReturnValueOnce(pending.promise);

    const { refreshMessage } = makeComposable();
    const p = refreshMessage(1);
    currentChatId.value = "B";
    scrollToBottom.mockClear();

    pending.reject(new Error("network down"));
    await p;

    expect(elMessageErrorSpy).not.toHaveBeenCalled();
    expect(scrollToBottom).not.toHaveBeenCalled();
    expect(stateFor("A").isSending).toBe(false);
    expect(stateFor("B").isSending).toBe(false);
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
    expect(stateFor("A").isSending).toBe(false);

    // The old refreshKey is cleaned up in finally
    expect(stateFor("A").refreshingMessages["1_msg-1"]).toBeUndefined();

    // The finally history fetch still runs
    expect(getHistoryQuestionData).toHaveBeenCalledTimes(1);
  });
});
