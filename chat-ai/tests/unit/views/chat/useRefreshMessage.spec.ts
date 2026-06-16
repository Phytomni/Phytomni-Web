import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import { ElMessage } from "element-plus";
import { useRefreshMessage } from "@/views/chat/composables/useRefreshMessage";

// Mock getQuery API（refreshMessage 唯一调用的接口）
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
  // 每个 dialogueId 对应一份可变状态记录，重复 getChatState(id) 返回同一对象
  let states: Map<string, ChatStateRecord>;
  let getChatState: (dialogueId: string) => any;
  let currentChatId: ReturnType<typeof ref<string>>;
  let currentChat: ReturnType<typeof ref<any>>;
  let scrollToBottom: ReturnType<typeof vi.fn>;
  let getHistoryQuestionData: ReturnType<typeof vi.fn>;
  let getDialogueIdFromChatId: ReturnType<typeof vi.fn>;
  let timestamp: ReturnType<typeof ref<number>>;
  // ElMessage.error 监听器（setup.ts 的 afterEach restoreAllMocks 会还原，故每个用例重建）
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
    // 索引 0 = user 消息, 索引 1 = assistant 消息
    currentChat = ref({
      messages: [
        { role: "user", content: "原始问题" },
        {
          role: "assistant",
          content: "旧回答",
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

  it("Happy path: KnowledgeAgent 重建助手消息、水合 reaction、清理刷新状态、复位 isSending、finally 拉取历史", async () => {
    // KnowledgeAgent 分支:JSON answer 解析出 content/doc_list,且会同步 reaction
    mockGetQuery.mockResolvedValueOnce({
      data: {
        tool_name: "KnowledgeAgent",
        answer: JSON.stringify({ content: "新回答", doc_list: [{ pm: "1" }] }),
        id: "msg-2",
        reaction_type: "1",
        status: "done",
      },
    } as any);

    const { refreshMessage } = makeComposable();
    await refreshMessage(1);

    // currentChat.value.messages[1] 被替换为重建后的助手消息
    const rebuilt = currentChat.value.messages[1];
    expect(rebuilt.role).toBe("assistant");
    expect(rebuilt.content).toBe("新回答");
    expect(rebuilt.doc_list).toEqual([{ pm: "1" }]);
    expect(rebuilt.tool_name).toBe("KnowledgeAgent");
    expect(rebuilt.id).toBe("msg-2");
    expect(rebuilt.instantMessage).toBe(true);

    // reaction 水合到 A 的 chatState（字符串 "1" → 数字 1）
    expect(getChatState("A").reactions["msg-2"]).toBe(1);

    // isSending 在 finally 复位为 false
    expect(getChatState("A").isSending).toBe(false);

    // 旧的 refreshKey 被清理（1_msg-1）
    expect(getChatState("A").refreshingMessages["1_msg-1"]).toBeUndefined();

    // getHistoryQuestionData 在 finally 被调用
    expect(getHistoryQuestionData).toHaveBeenCalledTimes(1);
  });

  it("🔒 CAPTURE INVARIANT: await 期间切换对话，清理仍落在发起对话 A、B 不被触碰", async () => {
    // 手动控制 getQuery 的 resolve 时机
    let resolveQuery!: (value: any) => void;
    const pending = new Promise((resolve) => {
      resolveQuery = resolve;
    });
    mockGetQuery.mockReturnValueOnce(pending as any);

    const { refreshMessage } = makeComposable();

    // 不 await —— 让刷新挂在 await getQuery 处
    const p = refreshMessage(1);

    // 此刻刷新在 A 上 in-flight：isSending=true，refreshKey 真值
    expect(getChatState("A").isSending).toBe(true);
    expect(getChatState("A").refreshingMessages["1_msg-1"]).toBe(true);

    // 用户切到对话 B
    currentChatId.value = "B";

    // 现在 resolve getQuery 并等待整体完成
    resolveQuery({
      data: { tool_name: "ChatAgent", answer: "迟到的回答", id: "msg-2" },
    });
    await p;

    // 清理落在被捕获的对话 A 上：isSending 复位、refreshKey 清空
    expect(getChatState("A").isSending).toBe(false);
    expect(getChatState("A").refreshingMessages["1_msg-1"]).toBeUndefined();

    // B 的 chatState 自始至终未被 refreshMessage 触碰：
    // refreshMessage 捕获了 A 的 chatState 后再未 re-read getChatState，
    // 因此 Map 里从未出现 "B" 键（B 完全没在 chatState 层被读/写）。
    expect(states.has("B")).toBe(false);

    // finally 仍然执行（拉取历史）
    expect(getHistoryQuestionData).toHaveBeenCalledTimes(1);
  });

  it("Failure path: getQuery 拒绝 → ElMessage.error 调用、isSending 在 finally 复位", async () => {
    mockGetQuery.mockRejectedValueOnce(new Error("network down"));

    const { refreshMessage } = makeComposable();
    await refreshMessage(1);

    // 错误提示被触发
    expect(elMessageErrorSpy).toHaveBeenCalledWith("刷新失败，请重试");

    // isSending 在 finally 复位为 false
    expect(getChatState("A").isSending).toBe(false);

    // 旧的 refreshKey 在 finally 被清理
    expect(getChatState("A").refreshingMessages["1_msg-1"]).toBeUndefined();

    // finally 的历史拉取仍执行
    expect(getHistoryQuestionData).toHaveBeenCalledTimes(1);
  });
});
