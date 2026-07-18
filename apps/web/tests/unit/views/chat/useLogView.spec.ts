import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref, nextTick } from "vue";
import type { ChatMessage } from "@/views/chat/types";

vi.mock("element-plus", () => ({
  ElMessage: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const mockGetAnalystAgentLog = vi.fn();
const mockUpdateAnalystAgentLog = vi.fn();
vi.mock("@/api/chat", () => ({
  getHistoryQuestionList: vi.fn(),
  getAnalystAgentLog: (...args: any[]) => mockGetAnalystAgentLog(...args),
  updateAnalystAgentLog: (...args: any[]) => mockUpdateAnalystAgentLog(...args),
}));

import {
  useLogView,
  deriveAnalystLogRowId,
  deriveAnalystLogTaskId,
  analystLogActivityKey,
} from "@/views/chat/composables/useLogView";
import { ElMessage } from "element-plus";

describe("deriveAnalystLogRowId / deriveAnalystLogTaskId", () => {
  it("accepts only positive-decimal row ids", () => {
    expect(deriveAnalystLogRowId({ role: "assistant", content: "", id: "42" })).toBe(
      "42"
    );
    expect(deriveAnalystLogRowId({ role: "assistant", content: "", id: 7 as any })).toBe(
      "7"
    );
    expect(deriveAnalystLogRowId({ role: "assistant", content: "", id: "0" })).toBeUndefined();
    expect(deriveAnalystLogRowId({ role: "assistant", content: "", id: "-3" })).toBeUndefined();
    expect(deriveAnalystLogRowId({ role: "assistant", content: "", id: "12a" })).toBeUndefined();
    expect(deriveAnalystLogRowId({ role: "assistant", content: "" })).toBeUndefined();
  });

  it("accepts only non-null non-empty trimmed task ids and never falls back to row id", () => {
    expect(
      deriveAnalystLogTaskId({ role: "assistant", content: "", task_id: "task-1" })
    ).toBe("task-1");
    expect(
      deriveAnalystLogTaskId({ role: "assistant", content: "", task_id: "  " })
    ).toBeUndefined();
    expect(
      deriveAnalystLogTaskId({ role: "assistant", content: "", task_id: null as any })
    ).toBeUndefined();
    expect(
      deriveAnalystLogTaskId({ role: "assistant", content: "", id: "99" })
    ).toBeUndefined();
  });
});

describe("useLogView", () => {
  type ChatState = {
    logData: Record<string, any>;
    loadingLog: Record<string, boolean>;
    updatingLog: Record<string, boolean>;
    logErrorKinds: Record<string, "fetch" | "update" | undefined>;
    activityExpandedByMessage: Record<string, boolean>;
  };

  let stateMap: Map<string, ChatState>;
  let isSending: ReturnType<typeof ref<boolean>>;
  let currentChatId: ReturnType<typeof ref<string>>;
  let currentChat: ReturnType<typeof ref<any>>;
  let scrollToBottom: ReturnType<typeof vi.fn>;
  let getChatState: (id: string) => ChatState;

  function makeState(): ChatState {
    return {
      logData: {},
      loadingLog: {},
      updatingLog: {},
      logErrorKinds: {},
      activityExpandedByMessage: {},
    };
  }

  function msg(partial: Partial<ChatMessage> & { id?: string; task_id?: string }): ChatMessage {
    return {
      role: "assistant",
      content: "reply",
      tool_name: "AnalystAgent",
      ...partial,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    stateMap = new Map();
    stateMap.set("A", makeState());
    stateMap.set("B", makeState());

    getChatState = (id: string) => {
      if (!stateMap.has(id)) stateMap.set(id, makeState());
      return stateMap.get(id)!;
    };

    isSending = ref(false);
    currentChatId = ref("A");
    currentChat = ref({ messages: [] });
    scrollToBottom = vi.fn();
  });

  function makeComposable() {
    return useLogView({
      isSending: isSending as any,
      currentChat,
      currentChatId,
      getChatState,
      scrollToBottom,
    });
  }

  it("closed does not fetch; first open fetches once; repeat open uses cache", async () => {
    const message = msg({ id: "11" });
    currentChat.value = { messages: [message] };
    mockGetAnalystAgentLog.mockResolvedValue({ code: 200, data: "cached-log" });

    const { setLogExpanded } = makeComposable();

    expect(mockGetAnalystAgentLog).not.toHaveBeenCalled();

    await setLogExpanded(message, true);
    expect(mockGetAnalystAgentLog).toHaveBeenCalledTimes(1);
    expect(mockGetAnalystAgentLog).toHaveBeenCalledWith({ id: "11" });
    expect(getChatState("A").logData["11"]).toBe("cached-log");
    expect(getChatState("A").activityExpandedByMessage[analystLogActivityKey("11")]).toBe(
      true
    );

    await setLogExpanded(message, false);
    await setLogExpanded(message, true);
    expect(mockGetAnalystAgentLog).toHaveBeenCalledTimes(1);
  });

  it("code===200 with empty/falsy data is empty success (no fetch error) and caches", async () => {
    const message = msg({ id: "12" });
    currentChat.value = { messages: [message] };
    mockGetAnalystAgentLog.mockResolvedValue({ code: 200, data: "" });

    const { setLogExpanded } = makeComposable();
    await setLogExpanded(message, true);

    expect(getChatState("A").logData["12"]).toBe("");
    expect(getChatState("A").logErrorKinds["12"]).toBeUndefined();
    expect(mockGetAnalystAgentLog).toHaveBeenCalledTimes(1);

    await setLogExpanded(message, false);
    await setLogExpanded(message, true);
    expect(mockGetAnalystAgentLog).toHaveBeenCalledTimes(1);

    mockGetAnalystAgentLog.mockResolvedValueOnce({ code: 200, data: null });
    const nullMsg = msg({ id: "13" });
    currentChat.value = { messages: [nullMsg] };
    await setLogExpanded(nullMsg, true);
    expect(getChatState("A").logData["13"]).toBe("");
    expect(getChatState("A").logErrorKinds["13"]).toBeUndefined();

    mockGetAnalystAgentLog.mockResolvedValueOnce({ code: 500, data: null });
    const failMsg = msg({ id: "14" });
    currentChat.value = { messages: [failMsg] };
    await setLogExpanded(failMsg, true);
    expect(getChatState("A").logErrorKinds["14"]).toBe("fetch");
    expect(getChatState("A").logData["14"]).toBeUndefined();
  });

  it("positive-decimal rowId drives GET; real taskId drives PATCH only; no fallback", async () => {
    mockGetAnalystAgentLog.mockResolvedValue({ code: 200, data: "ok" });
    mockUpdateAnalystAgentLog.mockResolvedValue({ code: 200 });

    const { setLogExpanded, updateLog } = makeComposable();

    for (const bad of ["0", "-1", "x", undefined]) {
      const m = msg({ id: bad as any, task_id: "task-real" });
      await setLogExpanded(m, true);
      await updateLog(m);
    }
    expect(mockGetAnalystAgentLog).not.toHaveBeenCalled();
    expect(mockUpdateAnalystAgentLog).not.toHaveBeenCalled();

    const distinct = msg({ id: "88", task_id: "task-88" });
    currentChat.value = { messages: [distinct] };
    await setLogExpanded(distinct, true);
    expect(mockGetAnalystAgentLog).toHaveBeenCalledWith({ id: "88" });

    await updateLog(distinct);
    const form = mockUpdateAnalystAgentLog.mock.calls[0][0] as FormData;
    expect(form.get("task_id")).toBe("task-88");
    expect(form.get("task_id")).not.toBe("88");

    // refetch after update uses rowId
    expect(mockGetAnalystAgentLog.mock.calls.some((c) => c[0].id === "88")).toBe(true);

    const noTask = msg({ id: "99" });
    currentChat.value = { messages: [noTask] };
    await setLogExpanded(noTask, true);
    await updateLog(noTask);
    expect(mockUpdateAnalystAgentLog).toHaveBeenCalledTimes(1); // only the distinct case
  });

  it("stores fetch/update error kinds and retry clears only that row before the correct request", async () => {
    mockGetAnalystAgentLog.mockRejectedValueOnce(new Error("boom"));
    const message = msg({ id: "5", task_id: "task-5" });
    currentChat.value = { messages: [message] };

    const { setLogExpanded, retryLog, updateLog } = makeComposable();
    await setLogExpanded(message, true);
    expect(getChatState("A").logErrorKinds["5"]).toBe("fetch");

    mockGetAnalystAgentLog.mockResolvedValueOnce({ code: 200, data: "recovered" });
    await retryLog(message);
    expect(getChatState("A").logErrorKinds["5"]).toBeUndefined();
    expect(mockGetAnalystAgentLog).toHaveBeenLastCalledWith({ id: "5" });
    expect(getChatState("A").logData["5"]).toBe("recovered");

    mockUpdateAnalystAgentLog.mockRejectedValueOnce(new Error("patch-fail"));
    await updateLog(message);
    expect(getChatState("A").logErrorKinds["5"]).toBe("update");

    mockUpdateAnalystAgentLog.mockResolvedValueOnce({ code: 200 });
    mockGetAnalystAgentLog.mockResolvedValueOnce({ code: 200, data: "after-patch" });
    await retryLog(message);
    expect(getChatState("A").logErrorKinds["5"]).toBeUndefined();
    const lastPatch = mockUpdateAnalystAgentLog.mock.calls.at(-1)![0] as FormData;
    expect(lastPatch.get("task_id")).toBe("task-5");
    expect(mockGetAnalystAgentLog).toHaveBeenLastCalledWith({ id: "5" });
  });

  it("legacy showLog=true initializes one open map entry once; absent/false stays closed", async () => {
    mockGetAnalystAgentLog.mockResolvedValue({ code: 200, data: "legacy" });
    const legacy = msg({ id: "21", showLog: true });
    currentChat.value = { messages: [legacy] };

    makeComposable();
    await nextTick();
    await Promise.resolve();

    const key = analystLogActivityKey("21");
    expect(getChatState("A").activityExpandedByMessage[key]).toBe(true);
    expect(mockGetAnalystAgentLog).toHaveBeenCalledWith({ id: "21" });

    // User closes — key stays present as false; showLog must not reopen
    getChatState("A").activityExpandedByMessage[key] = false;
    legacy.showLog = true;
    currentChat.value = { messages: [{ ...legacy }] };
    await nextTick();
    await Promise.resolve();
    expect(getChatState("A").activityExpandedByMessage[key]).toBe(false);

    const closed = msg({ id: "22", showLog: false });
    currentChat.value = { messages: [closed] };
    await nextTick();
    expect(
      getChatState("A").activityExpandedByMessage[analystLogActivityKey("22")]
    ).toBeUndefined();
  });

  it("switching dialogue never exposes another dialogue's logs", async () => {
    mockGetAnalystAgentLog.mockResolvedValue({ code: 200, data: "A-log" });
    const message = msg({ id: "31" });
    currentChat.value = { messages: [message] };
    const { setLogExpanded } = makeComposable();
    await setLogExpanded(message, true);
    expect(getChatState("A").logData["31"]).toBe("A-log");

    currentChatId.value = "B";
    expect(getChatState("B").logData["31"]).toBeUndefined();
    expect(getChatState("B").activityExpandedByMessage).toEqual({});
  });

  it("🔒 capture invariant: updatingLog cleanup lands on the originating chat after mid-flight switch", async () => {
    let resolveUpdate!: (value: any) => void;
    const updatePromise = new Promise<any>((res) => {
      resolveUpdate = res;
    });
    mockUpdateAnalystAgentLog.mockReturnValueOnce(updatePromise);
    mockGetAnalystAgentLog.mockResolvedValue({ code: 200, data: "ok" });

    const message = msg({ id: "41", task_id: "task-41", showLog: true });
    currentChat.value = { messages: [message] };
    getChatState("A").activityExpandedByMessage[analystLogActivityKey("41")] = true;

    const { updateLog } = makeComposable();
    const inflight = updateLog(message);
    expect(getChatState("A").updatingLog["41"]).toBe(true);

    currentChatId.value = "B";
    resolveUpdate({ code: 200 });
    await inflight;

    expect(getChatState("A").updatingLog["41"]).toBe(false);
    expect(getChatState("B").updatingLog["41"]).toBeUndefined();
    expect(ElMessage.success).toHaveBeenCalled();
  });

  it("toggle gate: returns early when isSending is true", async () => {
    isSending.value = true;
    const message = msg({ id: "51" });
    const { setLogExpanded } = makeComposable();
    await setLogExpanded(message, true);
    expect(mockGetAnalystAgentLog).not.toHaveBeenCalled();
    expect(getChatState("A").activityExpandedByMessage).toEqual({});
  });
});
