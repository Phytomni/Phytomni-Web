import { describe, it, expect, afterEach } from "vitest";
import { useChatStates } from "@/views/chat/composables/useChatStates";
import type { UploadFile } from "@/views/chat/types";
import { clearPendingChat, isLocalStorageChat } from "@/utils/pending-chat";
import type { RekeyChatStateOutcome } from "@/views/chat/types";

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
      historyHydration: "new",
      historyErrorKind: null,
      copyVisible: 0,
      copyTimeRef: undefined,
      logData: {},
      loadingLog: {},
      refreshingMessages: {},
      reactions: {},
      updatingLog: {},
      logErrorKinds: {},
      sendStartedAt: null,
      activeAgentName: "",
      completing: false,
      mode: "expert",
      isStreaming: false,
      streamingMessageId: null,
      uploadTransfer: null,
      selectedAgent: "",
      renderedChat: null,
      activeRequestId: "",
      generationStopped: false,
      pendingTurnId: null,
      pendingTurnFingerprint: null,
      refreshTurnIds: {},
      activityExpandedByMessage: {},
      artifactOpen: false,
      activeArtifactMessageId: null,
      artifactTab: "content",
      autoOpenedArtifactMessageIds: [],
    });
    // Already written into the chatStates map
    expect(s.chatStates.value["fresh-id"]).toBe(state);
  });

  it("isolates logErrorKinds and log activity keys per dialogue", () => {
    const s = useChatStates();
    s.currentChatId.value = "A";
    const stateA = s.getChatState("A");
    stateA.logErrorKinds["12"] = "fetch";
    stateA.logData["12"] = "A-log";
    stateA.activityExpandedByMessage["log:12"] = true;

    s.currentChatId.value = "B";
    const stateB = s.getChatState("B");
    expect(stateB.logErrorKinds).toEqual({});
    expect(stateB.logData).toEqual({});
    expect(stateB.activityExpandedByMessage).toEqual({});

    s.currentChatId.value = "A";
    expect(s.getChatState("A").logErrorKinds["12"]).toBe("fetch");
    expect(s.getChatState("A").logData["12"]).toBe("A-log");
    expect(s.getChatState("A").activityExpandedByMessage["log:12"]).toBe(true);
  });

  it("starts each dialogue with independent history hydration state", () => {
    const s = useChatStates();
    const stateA = s.getChatState("A");
    stateA.historyHydration = "loading";
    stateA.historyErrorKind = "request";

    const stateB = s.getChatState("B");
    expect(stateB.historyHydration).toBe("new");
    expect(stateB.historyErrorKind).toBeNull();
    expect(stateA.historyHydration).toBe("loading");
    expect(stateA.historyErrorKind).toBe("request");
  });

  it("keeps typed history messages and structured log payloads scoped to one dialogue", () => {
    const s = useChatStates();
    const history = [
      { role: "user", content: "question A" },
      {
        role: "assistant",
        content: { final_answer: "answer A" },
        doc_list: [{ title: "Reference A" }],
      },
    ];

    s.currentChatId.value = "A";
    s.historyQuestion.value = history;
    s.logData.value = { "12": { status: "done", rows: 2 } };

    s.currentChatId.value = "B";
    expect(s.historyQuestion.value).toBeNull();
    expect(s.logData.value).toEqual({});

    s.currentChatId.value = "A";
    expect(s.historyQuestion.value).toEqual(history);
    expect(s.logData.value).toEqual({ "12": { status: "done", rows: 2 } });
  });

  it("isolates activityExpandedByMessage per dialogue (A→B→A restoration)", () => {
    const s = useChatStates();
    s.currentChatId.value = "A";
    const stateA = s.getChatState("A");
    stateA.activityExpandedByMessage["stream:req-a:activity-0"] = true;

    s.currentChatId.value = "B";
    const stateB = s.getChatState("B");
    expect(stateB.activityExpandedByMessage).toEqual({});
    stateB.activityExpandedByMessage["stream:req-b:activity-0"] = true;

    s.currentChatId.value = "A";
    expect(s.getChatState("A").activityExpandedByMessage).toEqual({
      "stream:req-a:activity-0": true,
    });
    expect(s.getChatState("B").activityExpandedByMessage).toEqual({
      "stream:req-b:activity-0": true,
    });
  });

  it("isolates uploadTransfer per dialogue via proxy", () => {
    const s = useChatStates();
    const snap = {
      loaded: 10,
      total: 100,
      percent: 10,
      etaSec: 5,
      indeterminate: false,
      phase: "upload" as const,
      requestId: "r-a",
    };

    s.currentChatId.value = "A";
    s.uploadTransfer.value = snap;

    s.currentChatId.value = "B";
    expect(s.uploadTransfer.value).toBeNull();

    s.currentChatId.value = "A";
    expect(s.uploadTransfer.value).toEqual(snap);
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

  it("isolates pending turn identities and preserves them through dialogue rekey", () => {
    const s = useChatStates();
    const stateA = s.getChatState("temp-a");
    stateA.pendingTurnId = "turn-a";
    stateA.pendingTurnFingerprint = "fingerprint-a";
    stateA.refreshTurnIds["message-a"] = "turn-refresh-a";

    const stateB = s.getChatState("dialogue-b");
    expect(stateB.pendingTurnId).toBeNull();
    expect(stateB.pendingTurnFingerprint).toBeNull();
    expect(stateB.refreshTurnIds).toEqual({});

    expect(s.rekeyChatState("temp-a", "dialogue-a")).toEqual({
      outcome: "moved",
    });
    expect(s.getChatState("dialogue-a")).toBe(stateA);
    expect(s.getChatState("dialogue-a").pendingTurnId).toBe("turn-a");
    expect(s.getChatState("dialogue-a").pendingTurnFingerprint).toBe(
      "fingerprint-a"
    );
    expect(s.getChatState("dialogue-a").refreshTurnIds).toEqual({
      "message-a": "turn-refresh-a",
    });
  });
});

describe("useChatStates mode", () => {
  it("reports Expert before a dialogue exists and defaults a new dialogue to Expert", () => {
    const s = useChatStates();

    expect(s.chatMode.value).toBe("expert");

    s.currentChatId.value = "c1";
    expect(s.chatMode.value).toBe("expert");

    s.chatMode.value = "instant";
    expect(s.getChatState("c1").mode).toBe("instant");
  });

  it("keeps mode independent and defaults every new dialogue to Expert", () => {
    const s = useChatStates();

    s.currentChatId.value = "a";
    s.chatMode.value = "instant";

    s.currentChatId.value = "b";
    expect(s.chatMode.value).toBe("expert");

    s.currentChatId.value = "a";
    expect(s.chatMode.value).toBe("instant");
  });

  it("clears only Expert selection when switching to Instant", () => {
    const s = useChatStates();
    s.currentChatId.value = "c1";
    s.chatMode.value = "expert";
    s.selectedAgent.value = "DataAgent";
    s.messageInput.value = "compare these genes";
    const file = {
      name: "genes.csv",
      size: 12,
      type: "text/csv",
      file: {} as File,
    };
    s.fileList.value = [file];

    s.chatMode.value = "instant";

    expect(s.selectedAgent.value).toBe("");
    expect(s.messageInput.value).toBe("compare these genes");
    expect(s.fileList.value).toEqual([file]);
  });

  it("keeps mode, selection, and draft independent across dialogues", () => {
    const s = useChatStates();

    s.currentChatId.value = "A";
    s.chatMode.value = "expert";
    s.selectedAgent.value = "KnowledgeAgent";
    s.messageInput.value = "question A";

    s.currentChatId.value = "B";
    s.chatMode.value = "instant";
    s.messageInput.value = "question B";

    s.currentChatId.value = "A";
    expect(s.chatMode.value).toBe("expert");
    expect(s.selectedAgent.value).toBe("KnowledgeAgent");
    expect(s.messageInput.value).toBe("question A");

    s.currentChatId.value = "B";
    expect(s.chatMode.value).toBe("instant");
    expect(s.selectedAgent.value).toBe("");
    expect(s.messageInput.value).toBe("question B");
  });
});

describe("useChatStates selectedAgent", () => {
  it("defaults selectedAgent to empty and proxies to the current conversation", () => {
    const s = useChatStates();
    s.currentChatId.value = "c1";
    expect(s.selectedAgent.value).toBe("");
    s.selectedAgent.value = "KnowledgeAgent";
    expect(s.getChatState("c1").selectedAgent).toBe("KnowledgeAgent");
  });

  it("isolates selectedAgent per dialogue — switching restores each chip without bleed", () => {
    const s = useChatStates();

    s.currentChatId.value = "A";
    s.selectedAgent.value = "KnowledgeAgent";
    s.messageInput.value = "@KnowledgeAgent,question A";

    s.currentChatId.value = "B";
    expect(s.selectedAgent.value).toBe("");
    expect(s.messageInput.value).toBe("");

    s.selectedAgent.value = "DataAgent";
    s.messageInput.value = "@DataAgent,question B";

    s.currentChatId.value = "A";
    expect(s.selectedAgent.value).toBe("KnowledgeAgent");
    expect(s.messageInput.value).toBe("@KnowledgeAgent,question A");

    s.currentChatId.value = "B";
    expect(s.selectedAgent.value).toBe("DataAgent");
    expect(s.messageInput.value).toBe("@DataAgent,question B");
  });

  it("empty currentChatId returns empty selectedAgent and setter is a no-op", () => {
    const s = useChatStates();
    s.currentChatId.value = "";
    expect(s.selectedAgent.value).toBe("");
    s.selectedAgent.value = "KnowledgeAgent";
    expect(s.selectedAgent.value).toBe("");
    expect(Object.keys(s.chatStates.value)).toHaveLength(0);
  });
});

describe("useChatStates renderedChat ownership", () => {
  it("A→B→A restores the exact renderedChat / messages / block object identities", () => {
    const s = useChatStates();
    const a2uiBlock = {
      type: "agent-surface",
      authority: "agent" as const,
      interactive: true,
      a2ui: {
        surface: {
          catalog_version: "v1.0",
          surface_id: "surf-a",
          widget: "confirm" as const,
          props: {
            title: "Continue?",
            confirm_label: "Yes",
            cancel_label: "No",
          },
        },
        state: { status: "ready" as const, round: 1 as const },
      },
    };
    const streamingPlaceholder = {
      role: "assistant",
      content: "",
      streaming: true,
      blocks: [a2uiBlock],
      id: "stream-a",
    };
    const messagesA = [{ role: "user", content: "q-A" }, streamingPlaceholder];
    const messagesB = [
      { role: "user", content: "q-B" },
      { role: "assistant", content: "a-B", id: "msg-b" },
    ];

    s.currentChatId.value = "A";
    s.currentChat.value = { dialogue_id: "A", messages: messagesA };
    // Capture identities after reactive ownership (Vue may proxy nested objects)
    const ownedA = s.getChatState("A").renderedChat;
    expect(ownedA).not.toBeNull();
    if (!ownedA) throw new Error("expected rendered chat for A");
    const ownedMessagesA = ownedA.messages;
    const ownedPlaceholder = ownedMessagesA[1];
    expect(ownedPlaceholder).toBeDefined();
    if (!ownedPlaceholder) throw new Error("expected streaming placeholder");
    const ownedBlock = ownedPlaceholder.blocks?.[0];
    expect(ownedBlock).toBeDefined();
    if (!ownedBlock) throw new Error("expected A2UI block");

    s.currentChatId.value = "B";
    s.currentChat.value = { dialogue_id: "B", messages: messagesB };
    const ownedB = s.getChatState("B").renderedChat;
    expect(ownedB).not.toBeNull();
    if (!ownedB) throw new Error("expected rendered chat for B");
    expect(s.currentChat.value).toBe(ownedB);
    expect(s.currentChat.value).not.toBe(ownedA);

    s.currentChatId.value = "A";
    const currentA = s.currentChat.value;
    expect(currentA).toBe(ownedA);
    if (!currentA) throw new Error("expected current rendered chat for A");
    expect(currentA.messages).toBe(ownedMessagesA);
    expect(currentA.messages[1]).toBe(ownedPlaceholder);
    const currentBlock = currentA.messages[1]?.blocks?.[0];
    expect(currentBlock).toBe(ownedBlock);
    expect(s.getChatState("B").renderedChat).toBe(ownedB);
  });

  it("temp→server rekey preserves the exact renderedChat and messages identity", () => {
    const s = useChatStates();
    const tempId = "new_400";
    const serverId = "srv-rendered";
    const state = s.getChatState(tempId);
    state.renderedChat = {
      messages: [
        { role: "user", content: "pending" },
        {
          role: "assistant",
          content: "",
          streaming: true,
          blocks: [{ type: "markdown", authority: "web" as const, text: "…" }],
        },
      ],
    };
    const ownedRendered = state.renderedChat;
    expect(ownedRendered).not.toBeNull();
    if (!ownedRendered) throw new Error("expected rendered chat for rekey");
    const ownedMessages = ownedRendered.messages;

    const result = s.rekeyChatState(tempId, serverId);

    expect(result).toEqual({ outcome: "moved" });
    expect(s.chatStates.value[serverId]).toBe(state);
    expect(s.chatStates.value[serverId].renderedChat).toBe(ownedRendered);
    const rekeyedRendered = s.chatStates.value[serverId].renderedChat;
    expect(rekeyedRendered).not.toBeNull();
    if (!rekeyedRendered) throw new Error("expected rekeyed rendered chat");
    expect(rekeyedRendered.messages).toBe(ownedMessages);
  });

  it("empty currentChatId yields null currentChat and setter is a no-op", () => {
    const s = useChatStates();
    s.currentChatId.value = "";
    expect(s.currentChat.value).toBeNull();
    s.currentChat.value = { messages: [] };
    expect(s.currentChat.value).toBeNull();
    expect(Object.keys(s.chatStates.value)).toHaveLength(0);
  });
});

describe("useChatStates rekeyChatState", () => {
  it("moves the complete state object atomically and preserves object identity", () => {
    const s = useChatStates();
    const tempId = "new_100";
    const serverId = "srv-abc";
    const state = s.getChatState(tempId);
    state.messageInput = "foreground draft";
    state.isSending = true;
    state.selectedAgent = "KnowledgeAgent";

    const result = s.rekeyChatState(tempId, serverId);

    expect(result).toEqual({ outcome: "moved" });
    expect(s.chatStates.value[serverId]).toBe(state);
    expect(s.chatStates.value[tempId]).toBeUndefined();
    expect(state.messageInput).toBe("foreground draft");
    expect(state.isSending).toBe(true);
  });

  it("background rekey preserves object identity while foreground dialogue stays put", () => {
    const s = useChatStates();
    const tempA = "new_200";
    const tempB = "new_201";
    const stateA = s.getChatState(tempA);
    stateA.messageInput = "background A";
    s.getChatState(tempB).messageInput = "foreground B";
    s.currentChatId.value = tempB;

    const result = s.rekeyChatState(tempA, "srv-a");

    expect(result).toEqual({ outcome: "moved" });
    expect(s.chatStates.value["srv-a"]).toBe(stateA);
    expect(s.chatStates.value[tempA]).toBeUndefined();
    expect(s.currentChatId.value).toBe(tempB);
    expect(s.getChatState(tempB).messageInput).toBe("foreground B");
  });

  it("returns same-id without mutating the map", () => {
    const s = useChatStates();
    s.getChatState("same-key").messageInput = "x";
    const before = { ...s.chatStates.value };

    expect(s.rekeyChatState("same-key", "same-key")).toEqual({
      outcome: "same-id",
    });
    expect(s.chatStates.value).toEqual(before);
  });

  it("returns source-absent when the from key does not exist", () => {
    const s = useChatStates();
    expect(s.rekeyChatState("missing", "srv-x")).toEqual({
      outcome: "source-absent",
    });
    expect(s.chatStates.value["srv-x"]).toBeUndefined();
  });

  it("target-collision mutates neither record", () => {
    const s = useChatStates();
    const source = s.getChatState("new_300");
    source.messageInput = "source";
    const target = s.getChatState("srv-existing");
    target.messageInput = "target";

    expect(s.rekeyChatState("new_300", "srv-existing")).toEqual({
      outcome: "target-collision",
    });
    expect(s.chatStates.value["new_300"]).toBe(source);
    expect(s.chatStates.value["srv-existing"]).toBe(target);
    expect(source.messageInput).toBe("source");
    expect(target.messageInput).toBe("target");
  });

  it("background A rekey while B is current leaves B and its pending scope untouched", () => {
    localStorage.setItem(
      "pending_chat_new_A",
      JSON.stringify({
        isPending: true,
        messages: [{ role: "user", content: "msg A" }],
      })
    );
    localStorage.setItem(
      "pending_chat_new_B",
      JSON.stringify({
        isPending: true,
        messages: [{ role: "user", content: "msg B" }],
      })
    );

    const s = useChatStates();
    const stateA = s.getChatState("new_A");
    stateA.messageInput = "A draft";
    s.currentChatId.value = "new_B";
    s.getChatState("new_B").messageInput = "B draft";

    s.rekeyChatState("new_A", "srv-a");
    localStorage.removeItem("pending_chat_new_A");

    expect(s.currentChatId.value).toBe("new_B");
    expect(s.chatStates.value["srv-a"]).toBe(stateA);
    expect(s.chatStates.value["new_A"]).toBeUndefined();
    expect(s.getChatState("new_B").messageInput).toBe("B draft");
    expect(localStorage.getItem("pending_chat_new_A")).toBeNull();
    expect(localStorage.getItem("pending_chat_new_B")).not.toBeNull();

    localStorage.removeItem("pending_chat_new_B");
  });
});

/** Mirrors ChatView.vue reconcileMatchedDialogue for behavioral contract tests. */
function reconcileMatchedDialogueHarness(opts: {
  rekeyChatState: (from: string, to: string) => RekeyChatStateOutcome;
  currentChatId: { value: string };
  updateUrlWithChatId: (id: string) => void;
  tempId: string;
  serverId: string;
  pendingKey?: string;
}) {
  const {
    rekeyChatState,
    currentChatId,
    updateUrlWithChatId,
    tempId,
    serverId,
    pendingKey,
  } = opts;
  const wasCurrent = currentChatId.value === tempId;
  const rekey = rekeyChatState(tempId, serverId);
  const benign =
    rekey.outcome === "moved" ||
    rekey.outcome === "same-id" ||
    rekey.outcome === "source-absent";
  const reconciled = rekey.outcome === "moved" || rekey.outcome === "same-id";

  if (benign) {
    if (pendingKey !== undefined) {
      localStorage.removeItem(pendingKey);
    } else if (isLocalStorageChat(tempId)) {
      clearPendingChat(tempId);
    }
  } else if (rekey.outcome === "target-collision") {
    return {
      status: "retained" as const,
      tempId,
      reason: "collision" as const,
    };
  }

  if (reconciled && wasCurrent && currentChatId.value === tempId) {
    currentChatId.value = serverId;
    updateUrlWithChatId(serverId);
  }

  if (reconciled) {
    return { status: "reconciled" as const, tempId, serverId, rekey };
  }

  return { status: "retained" as const, tempId, reason: "unmatched" as const };
}

describe("reconcileMatchedDialogue coordinator contract", () => {
  afterEach(() => {
    localStorage.removeItem("pending_chat_new_A");
    localStorage.removeItem("pending_chat_new_B");
  });

  it("background A reconciles while B is current: only A moves, only A pending removed, B and URL unchanged", () => {
    localStorage.setItem(
      "pending_chat_new_A",
      JSON.stringify({
        isPending: true,
        messages: [{ role: "user", content: "msg A" }],
      })
    );
    localStorage.setItem(
      "pending_chat_new_B",
      JSON.stringify({
        isPending: true,
        messages: [{ role: "user", content: "msg B" }],
      })
    );

    const s = useChatStates();
    const stateA = s.getChatState("new_A");
    stateA.messageInput = "A draft";
    const stateB = s.getChatState("new_B");
    stateB.messageInput = "B draft";
    s.currentChatId.value = "new_B";

    const urlUpdates: string[] = [];
    const result = reconcileMatchedDialogueHarness({
      rekeyChatState: s.rekeyChatState.bind(s),
      currentChatId: s.currentChatId,
      updateUrlWithChatId: (id) => urlUpdates.push(id),
      tempId: "new_A",
      serverId: "srv-a",
      pendingKey: "pending_chat_new_A",
    });

    expect(result.status).toBe("reconciled");
    expect(s.chatStates.value["srv-a"]).toBe(stateA);
    expect(s.chatStates.value["new_A"]).toBeUndefined();
    expect(s.chatStates.value["new_B"]).toBe(stateB);
    expect(s.currentChatId.value).toBe("new_B");
    expect(stateB.messageInput).toBe("B draft");
    expect(localStorage.getItem("pending_chat_new_A")).toBeNull();
    expect(localStorage.getItem("pending_chat_new_B")).not.toBeNull();
    expect(urlUpdates).toEqual([]);
  });
});
