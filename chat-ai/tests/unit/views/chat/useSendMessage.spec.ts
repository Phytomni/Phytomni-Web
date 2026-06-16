import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import { useSendMessage } from "@/views/chat/composables/useSendMessage";

// getQueryAbortable（主发送）+ getAnswerCheck（网络错误恢复）是 composable
// 内部直接 import 的接口，必须 mock。
vi.mock("@/api/chat", () => ({
  getQueryAbortable: vi.fn(),
  getAnswerCheck: vi.fn(),
}));

// element-plus 的 ElMessage/ElMessageBox 在 pending 写入失败 / 403 弹窗里被调用。
vi.mock("element-plus", () => ({
  ElMessage: { warning: vi.fn() },
  ElMessageBox: { alert: vi.fn() },
}));

// pending-chat 工具：localStorage 写入/清除（new_ 前缀对话才走这条路径）。
vi.mock("@/utils/pending-chat", () => ({
  writePendingChat: vi.fn(),
  clearPendingChat: vi.fn(),
  isLocalStorageChat: vi.fn(() => false),
}));

// network-error 判定：默认非网络错误。
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
  // 每个 dialogueId 一份可变状态，重复 getChatState(id) 返回同一对象
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

  it("happy path: 推送 user+assistant 消息、清空输入/文件、isSending 复位、同步 reaction", async () => {
    states.get("A")!.messageInput = "你好世界";
    mockGetQueryAbortable.mockResolvedValueOnce({
      data: {
        tool_name: "ChatAgents",
        answer: "我是助手",
        id: "msg-1",
        reaction_type: "1",
        follow_up_questions: [],
      },
    } as any);

    const { sendMessage } = makeComposable();
    await sendMessage();

    // 推送了一条 user 消息 + 一条 assistant 消息
    const msgs = currentChat.value.messages;
    expect(msgs.length).toBe(2);
    expect(msgs[0].role).toBe("user");
    expect(msgs[0].content).toContain("你好世界");
    expect(msgs[1].role).toBe("assistant");
    expect(msgs[1].content).toBe("我是助手");

    // 通过捕获的 chatState 完成清理
    const stateA = getChatState("A");
    expect(stateA.messageInput).toBe("");
    expect(stateA.isSending).toBe(false);
    expect(stateA.fileList).toEqual([]);

    // 同步了 reaction
    expect(stateA.reactions["msg-1"]).toBe(1);

    // 调用了一次请求
    expect(mockGetQueryAbortable).toHaveBeenCalledTimes(1);
  });

  it("🔒 capture invariant: 发送中切换 currentChatId，清理仍落在被捕获的原对话 A", async () => {
    states.get("A")!.messageInput = "原对话消息";

    // A 是已存在的对话(messages 非空) => isNewChat=false，finally 不会把
    // currentChatId 复位回 A；这样切到 B 后若清理误读 currentChatId.value
    // 就会落在 B 上，从而暴露 capture 不变量被破坏。
    currentChat.value = {
      messages: [{ role: "user", content: "之前的消息" }],
    };

    // 手动控制的 promise，模拟一个挂起的请求
    let resolveQuery!: (v: any) => void;
    const pending = new Promise((resolve) => {
      resolveQuery = resolve;
    });
    mockGetQueryAbortable.mockReturnValueOnce(pending as any);

    const { sendMessage } = makeComposable();

    // 不 await，让请求挂起
    const sendPromise = sendMessage();

    // 等待同步阶段 + scrollToBottom 之前的微任务跑完
    await Promise.resolve();
    await Promise.resolve();

    // 此刻原对话 A 正处于发送中
    expect(getChatState("A").isSending).toBe(true);

    // 用户切到对话 B
    currentChatId.value = "B";

    // 请求完成
    resolveQuery({
      data: {
        tool_name: "ChatAgents",
        answer: "迟到的回答",
        id: "msg-late",
        reaction_type: "2",
        follow_up_questions: [],
      },
    });
    await sendPromise;

    // 清理落在被捕获的 A：isSending 复位、fileList 清空
    expect(getChatState("A").isSending).toBe(false);
    expect(getChatState("A").fileList).toEqual([]);

    // B 的 isSending 从未被触碰（始终 false，且未被设为 true）
    expect(getChatState("B").isSending).toBe(false);

    // reaction 同步到捕获的 A 而非当前 B
    expect(getChatState("A").reactions["msg-late"]).toBe(2);
    expect(getChatState("B").reactions["msg-late"]).toBeUndefined();
  });

  it("empty input guard: messageInput 为空时提前返回，不调用 getQueryAbortable", async () => {
    states.get("A")!.messageInput = "";

    const { sendMessage } = makeComposable();
    await sendMessage();

    expect(mockGetQueryAbortable).not.toHaveBeenCalled();
    expect(currentChat.value.messages.length).toBe(0);
    expect(getChatState("A").isSending).toBe(false);
  });
});
