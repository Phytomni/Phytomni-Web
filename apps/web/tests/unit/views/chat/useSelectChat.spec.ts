import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { ref, type Ref } from "vue";
import { useSelectChat } from "@/views/chat/composables/useSelectChat";
import type {
  Chat,
  ChatMessage,
  ChatUIState,
  ChatView,
} from "@/views/chat/types";
import type { ApiEnvelope, ChatHistoryRecord } from "@/api/types";
import { buildChat, buildChatState } from "../../../helpers/chatBuilders";
import {
  buildApiEnvelope,
  buildChatHistoryRecord,
} from "../../../helpers/apiBuilders";
import { invalidInput } from "../../../helpers/invalidInput";
import { deferred, mustGet } from "../../../helpers/mockFactories";

// Mock getAnswerCheck API (the only API selectChat calls)
vi.mock("@/api/chat", () => ({
  getAnswerCheck: vi.fn(),
}));

import { getAnswerCheck } from "@/api/chat";

const mockGetAnswerCheck = vi.mocked(getAnswerCheck);

describe("useSelectChat", () => {
  // Each dialogueId maps to one mutable state record; repeated getChatState(id) returns the same object
  let states: Map<string, ChatUIState>;
  let getChatState: (dialogueId: string) => ChatUIState;
  let currentChatId: Ref<string>;
  let chatList: Ref<Chat[]>;
  let scrollToBottom: Mock<() => Promise<void>>;
  let updateUrlWithChatId: ReturnType<typeof vi.fn>;
  let timestamp: Ref<number>;

  beforeEach(() => {
    vi.clearAllMocks();
    states = new Map();
    getChatState = (dialogueId: string) => {
      if (!states.has(dialogueId)) {
        states.set(dialogueId, buildChatState());
      }
      return mustGet(states.get(dialogueId), `chat state ${dialogueId}`);
    };
    currentChatId = ref("");
    chatList = ref<Chat[]>([
      buildChat({ id: 1, dialogue_id: "d1", title: "t" }),
      buildChat({ id: 2, dialogue_id: "d2", title: "t2" }),
    ]);
    scrollToBottom = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    updateUrlWithChatId = vi.fn();
    timestamp = ref(0);
  });

  function historyResponse(
    records: ChatHistoryRecord[],
    overrides: Partial<ApiEnvelope<ChatHistoryRecord[]>> = {}
  ): ApiEnvelope<ChatHistoryRecord[]> {
    return buildApiEnvelope(records, overrides);
  }

  function stateFor(dialogueId: string): ChatUIState {
    return mustGet(states.get(dialogueId), `chat state ${dialogueId}`);
  }

  function renderedFor(dialogueId: string, label: string): ChatView {
    return mustGet(
      stateFor(dialogueId).renderedChat,
      `${label}: rendered chat`
    );
  }

  function messageAt(
    dialogueId: string,
    index: number,
    label: string
  ): ChatMessage {
    return mustGet(renderedFor(dialogueId, label).messages[index], label);
  }

  function historyAt(
    dialogueId: string,
    index: number,
    label: string
  ): ChatMessage {
    const historyQuestion = mustGet(
      stateFor(dialogueId).historyQuestion,
      `${label}: history question`
    );
    return mustGet(historyQuestion[index], label);
  }

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
      ...historyResponse([
        buildChatHistoryRecord({
          id: "msg-1",
          reaction_type: "1",
          query: "Hello",
          answer: "Hello, I'm the assistant",
          tool_name: "ChatAgent",
        }),
      ]),
    });

    const { selectChat } = makeComposable();
    await selectChat("d1");

    // currentChatId is written synchronously before the await
    expect(currentChatId.value).toBe("d1");

    // reaction hydration (string "1" → number 1)
    expect(stateFor("d1").reactions["msg-1"]).toBe(1);

    // messages rebuilt into this dialogue's renderedChat owner
    const rendered = renderedFor("d1", "ChatAgent history");
    const messages = rendered.messages;
    expect(messages).toHaveLength(2);

    const userMsg = mustGet(messages[0], "ChatAgent history user message");
    expect(userMsg.role).toBe("user");
    expect(userMsg.content).toBe("Hello");

    const assistantMsg = mustGet(
      messages[1],
      "ChatAgent history assistant message"
    );
    expect(assistantMsg.role).toBe("assistant");
    expect(assistantMsg.content).toBe("Hello, I'm the assistant");
    expect(assistantMsg.tool_name).toBe("ChatAgent");
    expect(assistantMsg.id).toBe("msg-1");

    // renderedChat merges in the original chat record's fields
    expect(rendered.dialogue_id).toBe("d1");
    expect(rendered.title).toBe("t");

    // historyQuestion is set (non-null, holding two condensed records)
    const hq = mustGet(stateFor("d1").historyQuestion, "ChatAgent history");
    expect(hq).toHaveLength(2);
    expect(historyAt("d1", 0, "ChatAgent history user record")).toEqual({
      role: "user",
      content: "Hello",
    });
    expect(historyAt("d1", 1, "ChatAgent history assistant record")).toEqual({
      role: "assistant",
      content: "Hello, I'm the assistant",
    });

    // URL updated
    expect(updateUrlWithChatId).toHaveBeenCalledWith("d1");

    // Scroll to bottom when there are messages
    expect(scrollToBottom).toHaveBeenCalled();
  });

  it("resets reaction state before loading: stale entries are cleared before hydration", async () => {
    // Seed a stale reaction (pointing to the same d1 record)
    const stale = getChatState("d1");
    stale.reactions = { "old-msg": 2 };

    mockGetAnswerCheck.mockResolvedValueOnce(
      historyResponse([
        buildChatHistoryRecord({
          id: "msg-1",
          reaction_type: "1",
          query: "Question",
          answer: "Answer",
          tool_name: "ChatAgent",
        }),
      ])
    );

    const { selectChat } = makeComposable();
    await selectChat("d1");

    const reactions = stateFor("d1").reactions;
    // The stale entry is cleared
    expect(reactions["old-msg"]).toBeUndefined();
    // The new entry is hydrated
    expect(reactions["msg-1"]).toBe(1);
  });

  it("ignores optional history source metadata and preserves legacy rendering", async () => {
    mockGetAnswerCheck.mockResolvedValueOnce(
      historyResponse([
        invalidInput<ChatHistoryRecord>({
          ...buildChatHistoryRecord({
            id: "msg-source",
            query: "Question",
            answer: "Answer",
            tool_name: "ChatAgent",
          }),
          source: "unexpected-diagnostic",
          fallback_reason: "private upstream error",
        }),
      ])
    );

    const { selectChat } = makeComposable();
    await selectChat("d1");

    const messages = renderedFor("d1", "source metadata").messages;
    expect(messages).toHaveLength(2);
    expect(mustGet(messages[0], "source metadata user message")).toMatchObject({
      role: "user",
      content: "Question",
    });
    const assistant = mustGet(messages[1], "source metadata assistant message");
    expect(assistant).toMatchObject({ role: "assistant", content: "Answer" });
    expect("source" in assistant).toBe(false);
    expect("fallback_reason" in assistant).toBe(false);
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
    expect(messageAt("d1", 0, "live rendered owner").a2uiRuntime).toBe(runtime);
    expect(updateUrlWithChatId).toHaveBeenCalledWith("d1");
    expect(scrollToBottom).toHaveBeenCalledTimes(1);
  });

  it("non-200 response: does not rebuild messages or reset historyQuestion, but still updates URL when still active", async () => {
    // Seed a non-empty historyQuestion to verify the non-200 branch does not touch it
    const st = getChatState("d1");
    st.historyQuestion = [{ role: "user", content: "keep me" }];

    mockGetAnswerCheck.mockResolvedValueOnce(
      historyResponse([], { code: 500, message: "history unavailable" })
    );

    const { selectChat } = makeComposable();
    await selectChat("d1");

    // The synchronous currentChatId write still happens
    expect(currentChatId.value).toBe("d1");
    // The non-200 branch skips the renderedChat assignment
    expect(stateFor("d1").renderedChat).toBeNull();
    // historyQuestion is not reset
    expect(stateFor("d1").historyQuestion).toEqual([
      { role: "user", content: "keep me" },
    ]);
    // The URL is updated while still active
    expect(updateUrlWithChatId).toHaveBeenCalledWith("d1");
  });

  it("concurrent-switch safety: after mid-fetch currentChatId switch, reaction and historyQuestion write back to the argument dialogueId, not the live currentChatId", async () => {
    // Manually control when getAnswerCheck resolves
    const pendingCheck = deferred<ApiEnvelope<ChatHistoryRecord[]>>();
    mockGetAnswerCheck.mockReturnValueOnce(pendingCheck.promise);

    const { selectChat } = makeComposable();

    // 1. Start selectChat("d1") but don't await — the fetch hangs
    const p = selectChat("d1");

    // 2. During the await, the user switches to d2
    currentChatId.value = "d2";
    getChatState("d2");

    // 3. Resolve the fetch with a ChatAgent-style reaction_type
    pendingCheck.resolve(
      historyResponse([
        buildChatHistoryRecord({
          id: "msg-concurrent",
          reaction_type: "2",
          query: "Concurrent question",
          answer: "Concurrent answer",
          tool_name: "ChatAgent",
        }),
      ])
    );

    await p;

    // reaction hydration writes to the argument d1, not to the live currentChatId d2
    expect(stateFor("d1").reactions["msg-concurrent"]).toBe(2);
    expect(stateFor("d2").reactions["msg-concurrent"]).toBeUndefined();

    // historyQuestion is also written to d1
    const hq = mustGet(stateFor("d1").historyQuestion, "concurrent history");
    expect(hq).toHaveLength(2);
    expect(stateFor("d2").historyQuestion).toBeNull();

    // rendered data lands on d1 only; late response does not steal URL/scroll
    expect(renderedFor("d1", "concurrent history").messages).toHaveLength(2);
    expect(stateFor("d2").renderedChat).toBeNull();
    expect(currentChatId.value).toBe("d2");
    expect(updateUrlWithChatId).not.toHaveBeenCalled();
    expect(scrollToBottom).not.toHaveBeenCalled();
  });

  it("out-of-order A/B history responses populate only their states and never revert current ID/URL/scroll", async () => {
    const pendingA = deferred<ApiEnvelope<ChatHistoryRecord[]>>();
    const pendingB = deferred<ApiEnvelope<ChatHistoryRecord[]>>();

    mockGetAnswerCheck
      .mockReturnValueOnce(pendingA.promise)
      .mockReturnValueOnce(pendingB.promise);

    const { selectChat } = makeComposable();
    const pA = selectChat("d1");
    const pB = selectChat("d2");

    expect(currentChatId.value).toBe("d2");

    // B resolves first
    pendingB.resolve(
      historyResponse([
        buildChatHistoryRecord({
          id: "msg-b",
          query: "B-q",
          answer: "B-a",
          tool_name: "ChatAgent",
        }),
      ])
    );
    await pB;

    expect(currentChatId.value).toBe("d2");
    expect(messageAt("d2", 0, "B history").content).toBe("B-q");
    expect(updateUrlWithChatId).toHaveBeenCalledTimes(1);
    expect(updateUrlWithChatId).toHaveBeenCalledWith("d2");
    expect(scrollToBottom).toHaveBeenCalledTimes(1);

    // A resolves later — data only, no foreground steal
    pendingA.resolve(
      historyResponse([
        buildChatHistoryRecord({
          id: "msg-a",
          query: "A-q",
          answer: "A-a",
          tool_name: "ChatAgent",
        }),
      ])
    );
    await pA;

    expect(currentChatId.value).toBe("d2");
    expect(messageAt("d1", 0, "A history").content).toBe("A-q");
    expect(messageAt("d2", 0, "B history").content).toBe("B-q");
    expect(updateUrlWithChatId).toHaveBeenCalledTimes(1);
    expect(updateUrlWithChatId).toHaveBeenCalledWith("d2");
    expect(scrollToBottom).toHaveBeenCalledTimes(1);
  });

  it("history AnalystAgent hydrates the existing task_id onto the message", async () => {
    mockGetAnswerCheck.mockResolvedValueOnce(
      historyResponse([
        buildChatHistoryRecord({
          id: "1001",
          query: "run analysis",
          answer: "analysis started",
          tool_name: "AnalystAgent",
          task_id: "ei-task-abc",
          compute_resource: "analyst-agents-small",
        }),
      ])
    );

    const { selectChat } = makeComposable();
    await selectChat("d1");

    const assistant = messageAt("d1", 1, "Analyst history");
    expect(assistant.tool_name).toBe("AnalystAgent");
    expect(assistant.id).toBe("1001");
    expect(assistant.task_id).toBe("ei-task-abc");
  });
});
