import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import { useSelectChat } from "@/views/chat/composables/useSelectChat";

// Mock getAnswerCheck API（selectChat 唯一调用的接口）
vi.mock("@/api/chat", () => ({
  getAnswerCheck: vi.fn(),
}));

import { getAnswerCheck } from "@/api/chat";

const mockGetAnswerCheck = vi.mocked(getAnswerCheck);

describe("useSelectChat", () => {
  // 每个 dialogueId 对应一份可变状态记录，重复 getChatState(id) 返回同一对象
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

    // currentChatId 在 await 之前同步写入
    expect(currentChatId.value).toBe("d1");

    // reaction 水合(字符串 "1" → 数字 1)
    expect(getChatState("d1").reactions["msg-1"]).toBe(1);

    // messages 重建:一条 user + 一条 assistant
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

    // currentChat 合并了原 chat 记录字段
    expect(currentChat.value.dialogue_id).toBe("d1");
    expect(currentChat.value.title).toBe("t");

    // historyQuestion 被设置(非 null,含两条精简记录)
    const hq = getChatState("d1").historyQuestion;
    expect(Array.isArray(hq)).toBe(true);
    expect(hq.length).toBe(2);
    expect(hq[0]).toEqual({ role: "user", content: "你好" });
    expect(hq[1]).toEqual({ role: "assistant", content: "你好，我是助手" });

    // URL 更新
    expect(updateUrlWithChatId).toHaveBeenCalledWith("d1");

    // 有消息时滚动到底部
    expect(scrollToBottom).toHaveBeenCalled();
  });

  it("加载前重置 reaction 状态:陈旧条目在水合前被清空", async () => {
    // 预置陈旧 reaction(指向同一 d1 记录)
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
    // 陈旧条目被清除
    expect(reactions["old-msg"]).toBeUndefined();
    // 新条目被水合
    expect(reactions["msg-1"]).toBe(1);
  });

  it("non-200 响应:不重建 messages、不重置 historyQuestion,但仍更新 URL", async () => {
    // 预置非空 historyQuestion 以验证 non-200 分支不触碰它
    const st = getChatState("d1");
    st.historyQuestion = [{ role: "user", content: "保留我" }];

    mockGetAnswerCheck.mockResolvedValueOnce({ code: 500, data: [] } as any);

    const { selectChat } = makeComposable();
    await selectChat("d1");

    // currentChatId 同步写入仍发生
    expect(currentChatId.value).toBe("d1");
    // non-200 分支跳过 currentChat 赋值
    expect(currentChat.value).toBeNull();
    // historyQuestion 未被重置
    expect(getChatState("d1").historyQuestion).toEqual([
      { role: "user", content: "保留我" },
    ]);
    // URL 始终更新(在 if 块之外)
    expect(updateUrlWithChatId).toHaveBeenCalledWith("d1");
  });
});
