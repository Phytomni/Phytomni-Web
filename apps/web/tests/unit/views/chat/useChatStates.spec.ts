import { describe, it, expect } from "vitest";
import { useChatStates } from "@/views/chat/composables/useChatStates";
import type { UploadFile } from "@/views/chat/types";

// 这是对刚刚抽取(行为未变)的平行对话状态的特征(characterization)测试,
// 是「多对话并行、UI 状态互不串台」运行时不变量的单元可测形式。

describe("useChatStates parallel chat state", () => {
  it("isolates per-dialogue state via proxies — switching currentChatId flips state without bleed", () => {
    const s = useChatStates();
    const fileA: UploadFile[] = [
      {
        name: "a.txt",
        size: 1,
        type: "text/plain",
        file: {} as File,
      },
    ];

    // 写入 A 的状态
    s.currentChatId.value = "A";
    s.messageInput.value = "hello-A";
    s.isSending.value = true;
    s.fileList.value = fileA;

    // 切到 B —— 所有代理应返回干净默认值(证明无串台)
    s.currentChatId.value = "B";
    expect(s.messageInput.value).toBe("");
    expect(s.isSending.value).toBe(false);
    expect(s.fileList.value).toEqual([]);

    // 写入 B 自己的内容
    s.messageInput.value = "hello-B";

    // 切回 A —— A 的状态必须原样保留
    s.currentChatId.value = "A";
    expect(s.messageInput.value).toBe("hello-A");
    expect(s.isSending.value).toBe(true);
    expect(s.fileList.value).toEqual(fileA);

    // B 不受 A 影响
    s.currentChatId.value = "B";
    expect(s.messageInput.value).toBe("hello-B");
  });

  it("getChatState lazy-creates a record with the correct defaults", () => {
    const s = useChatStates();
    const state = s.getChatState("fresh-id");

    expect(state).toEqual({
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
    });
    // 已写入到 chatStates 这个 map 中
    expect(s.chatStates.value["fresh-id"]).toBe(state);
  });

  it("empty currentChatId returns safe defaults and setters are no-ops", () => {
    const s = useChatStates();
    s.currentChatId.value = "";

    // getter 返回各自默认值
    expect(s.messageInput.value).toBe("");
    expect(s.isSending.value).toBe(false);
    expect(s.fileList.value).toEqual([]);
    expect(s.copyVisible.value).toBe(0);
    expect(s.copyTimeRef.value).toBeUndefined();
    expect(s.logData.value).toEqual({});
    expect(s.loadingLog.value).toEqual({});
    expect(s.refreshingMessages.value).toEqual({});
    expect(s.historyQuestion.value).toBeNull();
    expect(s.updatingLog.value).toEqual({});

    // setter 在无 currentChatId 时为 no-op:写入后读回仍是默认值
    s.messageInput.value = "ignored";
    s.isSending.value = true;
    s.copyVisible.value = 5;
    expect(s.messageInput.value).toBe("");
    expect(s.isSending.value).toBe(false);
    expect(s.copyVisible.value).toBe(0);

    // 无 currentChatId 时不应创建任何对话状态
    expect(Object.keys(s.chatStates.value)).toHaveLength(0);
  });
});
