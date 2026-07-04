import { describe, it, expect } from "vitest";
import { useChatStates } from "@/views/chat/composables/useChatStates";
import type { UploadFile } from "@/views/chat/types";

// This is a characterization test of the just-extracted (behavior-unchanged) parallel
// chat state, the unit-testable form of the "multiple dialogues in parallel, UI state
// never bleeds across them" runtime invariant.

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

    // Write A's state
    s.currentChatId.value = "A";
    s.messageInput.value = "hello-A";
    s.isSending.value = true;
    s.fileList.value = fileA;

    // Switch to B — all proxies should return clean defaults (proving no bleed)
    s.currentChatId.value = "B";
    expect(s.messageInput.value).toBe("");
    expect(s.isSending.value).toBe(false);
    expect(s.fileList.value).toEqual([]);

    // Write B's own content
    s.messageInput.value = "hello-B";

    // Switch back to A — A's state must be preserved as-is
    s.currentChatId.value = "A";
    expect(s.messageInput.value).toBe("hello-A");
    expect(s.isSending.value).toBe(true);
    expect(s.fileList.value).toEqual(fileA);

    // B is unaffected by A
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
      mode: "instant",
      isStreaming: false,
      streamingMessageId: null,
    });
    // Already written into the chatStates map
    expect(s.chatStates.value["fresh-id"]).toBe(state);
  });

  it("empty currentChatId returns safe defaults and setters are no-ops", () => {
    const s = useChatStates();
    s.currentChatId.value = "";

    // getters return their respective defaults
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

    // setters are no-ops when there is no currentChatId: reading back after writing still yields defaults
    s.messageInput.value = "ignored";
    s.isSending.value = true;
    s.copyVisible.value = 5;
    expect(s.messageInput.value).toBe("");
    expect(s.isSending.value).toBe(false);
    expect(s.copyVisible.value).toBe(0);

    // No chat state should be created when there is no currentChatId
    expect(Object.keys(s.chatStates.value)).toHaveLength(0);
  });
});

describe("useChatStates mode", () => {
  it("defaults mode to instant and proxies chatMode to the current conversation", () => {
    const s = useChatStates();
    s.currentChatId.value = "c1";
    expect(s.chatMode.value).toBe("instant");
    s.chatMode.value = "expert";
    expect(s.getChatState("c1").mode).toBe("expert");
  });

  it("keeps mode independent per conversation", () => {
    const s = useChatStates();
    s.currentChatId.value = "a";
    s.chatMode.value = "expert";
    s.currentChatId.value = "b";
    expect(s.chatMode.value).toBe("instant");
  });
});
