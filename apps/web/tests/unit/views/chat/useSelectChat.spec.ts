import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import { useSelectChat } from "@/views/chat/composables/useSelectChat";

// Mock getAnswerCheck API (the only API selectChat calls)
vi.mock("@/api/chat", () => ({
  getAnswerCheck: vi.fn(),
}));

import { getAnswerCheck } from "@/api/chat";

const mockGetAnswerCheck = vi.mocked(getAnswerCheck);

describe("useSelectChat", () => {
  // Each dialogueId maps to one mutable state record; repeated getChatState(id) returns the same object
  let states: Map<string, { reactions: Record<string, number>; historyQuestion: any }>;
  let getChatState: (dialogueId: string) => any;
  let currentChatId: ReturnType<typeof ref<string>>;
  let currentChat: ReturnType<typeof ref<any>>;
  let chatList: ReturnType<typeof ref<any>>;
  let scrollToBottom: ReturnType<typeof vi.fn>;
  let updateUrlWithChatId: ReturnType<typeof vi.fn>;
  let timestamp: ReturnType<typeof ref<number>>;

  beforeEach(() => {
    vi.clearAllMocks();
    states = new Map();
    getChatState = (dialogueId: string) => {
      if (!states.has(dialogueId)) {
        states.set(dialogueId, { reactions: {}, historyQuestion: null });
      }
      return states.get(dialogueId);
    };
    currentChatId = ref("");
    currentChat = ref(null);
    chatList = ref([
      { id: 1, dialogue_id: "d1", title: "t", date: "", isFavorite: false },
    ]);
    scrollToBottom = vi.fn();
    updateUrlWithChatId = vi.fn();
    timestamp = ref(0);
  });

  function makeComposable() {
    return useSelectChat({
      getChatState,
      currentChatId,
      currentChat,
      scrollToBottom,
      updateUrlWithChatId,
      chatList,
      timestamp,
    });
  }

  it("ChatAgent 历史记录:同步 currentChatId、水合 reaction、重建 messages、设置 historyQuestion、更新 URL", async () => {
    mockGetAnswerCheck.mockResolvedValueOnce({
      code: 200,
      data: [
        {
          id: "msg-1",
          reaction_type: "1",
          query: "你好",
          answer: "你好，我是助手",
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

    // messages rebuilt: one user + one assistant
    expect(currentChat.value).not.toBeNull();
    const messages = currentChat.value.messages;
    expect(Array.isArray(messages)).toBe(true);
    expect(messages.length).toBe(2);

    const userMsg = messages[0];
    expect(userMsg.role).toBe("user");
    expect(userMsg.content).toBe("你好");

    const assistantMsg = messages[1];
    expect(assistantMsg.role).toBe("assistant");
    expect(assistantMsg.content).toBe("你好，我是助手");
    expect(assistantMsg.tool_name).toBe("ChatAgent");
    expect(assistantMsg.id).toBe("msg-1");

    // currentChat merges in the original chat record's fields
    expect(currentChat.value.dialogue_id).toBe("d1");
    expect(currentChat.value.title).toBe("t");

    // historyQuestion is set (non-null, holding two condensed records)
    const hq = getChatState("d1").historyQuestion;
    expect(Array.isArray(hq)).toBe(true);
    expect(hq.length).toBe(2);
    expect(hq[0]).toEqual({ role: "user", content: "你好" });
    expect(hq[1]).toEqual({ role: "assistant", content: "你好，我是助手" });

    // URL updated
    expect(updateUrlWithChatId).toHaveBeenCalledWith("d1");

    // Scroll to bottom when there are messages
    expect(scrollToBottom).toHaveBeenCalled();
  });

  it("加载前重置 reaction 状态:陈旧条目在水合前被清空", async () => {
    // Seed a stale reaction (pointing to the same d1 record)
    const stale = getChatState("d1");
    stale.reactions = { "old-msg": 2 };

    mockGetAnswerCheck.mockResolvedValueOnce({
      code: 200,
      data: [
        {
          id: "msg-1",
          reaction_type: "1",
          query: "问题",
          answer: "回答",
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

  it("non-200 响应:不重建 messages、不重置 historyQuestion,但仍更新 URL", async () => {
    // Seed a non-empty historyQuestion to verify the non-200 branch does not touch it
    const st = getChatState("d1");
    st.historyQuestion = [{ role: "user", content: "保留我" }];

    mockGetAnswerCheck.mockResolvedValueOnce({ code: 500, data: [] } as any);

    const { selectChat } = makeComposable();
    await selectChat("d1");

    // The synchronous currentChatId write still happens
    expect(currentChatId.value).toBe("d1");
    // The non-200 branch skips the currentChat assignment
    expect(currentChat.value).toBeNull();
    // historyQuestion is not reset
    expect(getChatState("d1").historyQuestion).toEqual([
      { role: "user", content: "保留我" },
    ]);
    // The URL is always updated (outside the if block)
    expect(updateUrlWithChatId).toHaveBeenCalledWith("d1");
  });

  it("并发切换安全:mid-fetch 切换 currentChatId 后 reaction 和 historyQuestion 写回参数 dialogueId 而非 live currentChatId", async () => {
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
          query: "并发问题",
          answer: "并发回答",
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
  });
});
