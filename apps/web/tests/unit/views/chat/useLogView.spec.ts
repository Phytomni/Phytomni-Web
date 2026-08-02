import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  computed,
  ref,
  nextTick,
  type Ref,
  type WritableComputedRef,
} from "vue";
import type { AnalystAgentLog, ApiEnvelope, MutationData } from "@/api/types";
import type { ChatMessage, ChatUIState, ChatView } from "@/views/chat/types";
import { buildApiEnvelope } from "../../../helpers/apiBuilders";
import {
  buildChatMessage,
  buildChatState,
} from "../../../helpers/chatBuilders";
import { deferred, mustGet } from "../../../helpers/mockFactories";
import { invalidInput } from "../../../helpers/invalidInput";

vi.mock("element-plus", () => ({
  ElMessage: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const mockGetAnalystAgentLog = vi.hoisted(() =>
  vi.fn<(data: { id: string }) => Promise<ApiEnvelope<AnalystAgentLog>>>()
);
const mockUpdateAnalystAgentLog = vi.hoisted(() =>
  vi.fn<
    (
      data: { task_id: string; compute_resource: string } | FormData
    ) => Promise<ApiEnvelope<MutationData>>
  >()
);
vi.mock("@/api/chat", () => ({
  getHistoryQuestionList: vi.fn(),
  getAnalystAgentLog: mockGetAnalystAgentLog,
  updateAnalystAgentLog: mockUpdateAnalystAgentLog,
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
    expect(
      deriveAnalystLogRowId({ role: "assistant", content: "", id: "42" })
    ).toBe("42");
    expect(
      deriveAnalystLogRowId(
        invalidInput<ChatMessage>({ role: "assistant", content: "", id: 7 })
      )
    ).toBe("7");
    expect(
      deriveAnalystLogRowId({ role: "assistant", content: "", id: "0" })
    ).toBeUndefined();
    expect(
      deriveAnalystLogRowId({ role: "assistant", content: "", id: "-3" })
    ).toBeUndefined();
    expect(
      deriveAnalystLogRowId({ role: "assistant", content: "", id: "12a" })
    ).toBeUndefined();
    expect(
      deriveAnalystLogRowId({ role: "assistant", content: "" })
    ).toBeUndefined();
  });

  it("accepts only non-null non-empty trimmed task ids and never falls back to row id", () => {
    expect(
      deriveAnalystLogTaskId({
        role: "assistant",
        content: "",
        task_id: "task-1",
      })
    ).toBe("task-1");
    expect(
      deriveAnalystLogTaskId({ role: "assistant", content: "", task_id: "  " })
    ).toBeUndefined();
    expect(
      deriveAnalystLogTaskId(
        invalidInput<ChatMessage>({
          role: "assistant",
          content: "",
          task_id: null,
        })
      )
    ).toBeUndefined();
    expect(
      deriveAnalystLogTaskId({ role: "assistant", content: "", id: "99" })
    ).toBeUndefined();
  });
});

describe("useLogView", () => {
  let stateMap: Map<string, ChatUIState>;
  let isSending: Ref<boolean>;
  let currentChatId: Ref<string>;
  let currentChat: Ref<ChatView | null>;
  let scrollToBottom: ReturnType<typeof vi.fn<() => Promise<void>>>;
  let getChatState: (id: string) => ChatUIState;

  function makeState(): ChatUIState {
    return buildChatState();
  }

  function msg(partial: Partial<ChatMessage> = {}): ChatMessage {
    return buildChatMessage({
      role: "assistant",
      content: "reply",
      tool_name: "AnalystAgent",
      ...partial,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    stateMap = new Map();
    stateMap.set("A", makeState());
    stateMap.set("B", makeState());

    getChatState = (id: string) => {
      if (!stateMap.has(id)) stateMap.set(id, makeState());
      return mustGet(stateMap.get(id), `chat state ${id}`);
    };

    isSending = ref(false);
    currentChatId = ref("A");
    currentChat = ref({ messages: [] });
    scrollToBottom = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  });

  function writableRef<T>(source: Ref<T>): WritableComputedRef<T> {
    return computed({
      get: () => source.value,
      set: (value: T) => {
        source.value = value;
      },
    });
  }

  function logResponse(text: string, code = 200): ApiEnvelope<AnalystAgentLog> {
    return buildApiEnvelope(
      {
        state: text === "" ? "PENDING" : "AVAILABLE",
        source: "LEGACY_TASK",
        text,
        revision: 0,
        truncated: false,
        can_request_legacy_refresh: true,
        error_code: null,
      },
      { code }
    );
  }

  function mutationResponse(code = 200): ApiEnvelope<MutationData> {
    return buildApiEnvelope<MutationData>(null, { code });
  }

  function invalidLogResponse(code: number): ApiEnvelope<AnalystAgentLog> {
    return invalidInput<ApiEnvelope<AnalystAgentLog>>(
      buildApiEnvelope(null, { code })
    );
  }

  function formDataCallAt(index: number, label: string): FormData {
    const [data] = mustGet(mockUpdateAnalystAgentLog.mock.calls[index], label);
    if (!(data instanceof FormData)) {
      throw new Error(`Expected FormData: ${label}`);
    }
    return data;
  }

  function makeComposable() {
    return useLogView({
      isSending: writableRef(isSending),
      currentChat,
      currentChatId,
      getChatState,
      scrollToBottom,
    });
  }

  it("closed does not fetch; first open fetches once; repeat open uses cache", async () => {
    const message = msg({ id: "11" });
    currentChat.value = { messages: [message] };
    mockGetAnalystAgentLog.mockResolvedValue(logResponse("cached-log"));

    const { setLogExpanded } = makeComposable();

    expect(mockGetAnalystAgentLog).not.toHaveBeenCalled();

    await setLogExpanded(message, true);
    expect(mockGetAnalystAgentLog).toHaveBeenCalledTimes(1);
    expect(mockGetAnalystAgentLog).toHaveBeenCalledWith({ id: "11" });
    expect(getChatState("A").logData["11"]?.text).toBe("cached-log");
    expect(
      getChatState("A").activityExpandedByMessage[analystLogActivityKey("11")]
    ).toBe(true);

    await setLogExpanded(message, false);
    await setLogExpanded(message, true);
    expect(mockGetAnalystAgentLog).toHaveBeenCalledTimes(1);
  });

  it("refreshes a material modern log only while its activity is expanded", async () => {
    const message = msg({ id: "71" });
    const state = getChatState("A");
    state.logData["71"] = {
      state: "AVAILABLE",
      source: "BOT_RUN",
      text: "cached",
      revision: 1,
      truncated: false,
      can_request_legacy_refresh: false,
      error_code: null,
    };
    mockGetAnalystAgentLog.mockResolvedValue(logResponse("fresh"));
    const { refreshModernLog } = makeComposable();
    await refreshModernLog(message);
    expect(mockGetAnalystAgentLog).not.toHaveBeenCalled();
    state.activityExpandedByMessage[analystLogActivityKey("71")] = true;
    await refreshModernLog(message);
    expect(mockGetAnalystAgentLog).toHaveBeenCalledWith({ id: "71" });
  });

  it("retains cached safe text when a degraded modern response is empty", async () => {
    const message = msg({ id: "72" });
    const state = getChatState("A");
    state.activityExpandedByMessage[analystLogActivityKey("72")] = true;
    state.logData["72"] = {
      state: "AVAILABLE",
      source: "BOT_RUN",
      text: "last safe",
      revision: 1,
      truncated: false,
      can_request_legacy_refresh: false,
      error_code: null,
    };
    mockGetAnalystAgentLog.mockResolvedValue(
      buildApiEnvelope({
        ...state.logData["72"],
        state: "DEGRADED",
        text: "",
        error_code: "log_refresh_unavailable",
      })
    );
    const { refreshModernLog } = makeComposable();
    await refreshModernLog(message);
    expect(state.logData["72"]?.state).toBe("DEGRADED");
    expect(state.logData["72"]?.text).toBe("last safe");
  });

  it("code===200 with empty DTO text is empty success (no fetch error) and caches", async () => {
    const message = msg({ id: "12" });
    currentChat.value = { messages: [message] };
    mockGetAnalystAgentLog.mockResolvedValue(logResponse(""));

    const { setLogExpanded } = makeComposable();
    await setLogExpanded(message, true);

    expect(getChatState("A").logData["12"]?.text).toBe("");
    expect(getChatState("A").logErrorKinds["12"]).toBeUndefined();
    expect(mockGetAnalystAgentLog).toHaveBeenCalledTimes(1);

    await setLogExpanded(message, false);
    await setLogExpanded(message, true);
    expect(mockGetAnalystAgentLog).toHaveBeenCalledTimes(1);

    mockGetAnalystAgentLog.mockResolvedValueOnce(invalidLogResponse(500));
    const failMsg = msg({ id: "14" });
    currentChat.value = { messages: [failMsg] };
    await setLogExpanded(failMsg, true);
    expect(getChatState("A").logErrorKinds["14"]).toBe("fetch");
    expect(getChatState("A").logData["14"]).toBeUndefined();
  });

  it("positive-decimal rowId drives GET; real taskId drives PATCH only; no fallback", async () => {
    mockGetAnalystAgentLog.mockResolvedValue(logResponse("ok"));
    mockUpdateAnalystAgentLog.mockResolvedValue(mutationResponse());

    const { setLogExpanded, updateLog } = makeComposable();

    for (const bad of ["0", "-1", "x", undefined]) {
      const m = invalidInput<ChatMessage>({
        ...msg({ task_id: "task-real" }),
        id: bad,
      });
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
    const form = formDataCallAt(0, "distinct analyst log update");
    expect(form.get("task_id")).toBe("task-88");
    expect(form.get("task_id")).not.toBe("88");

    // refetch after update uses rowId
    expect(
      mockGetAnalystAgentLog.mock.calls.some(([request]) => request.id === "88")
    ).toBe(true);

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

    mockGetAnalystAgentLog.mockResolvedValueOnce(logResponse("recovered"));
    await retryLog(message);
    expect(getChatState("A").logErrorKinds["5"]).toBeUndefined();
    expect(mockGetAnalystAgentLog).toHaveBeenLastCalledWith({ id: "5" });
    expect(getChatState("A").logData["5"]?.text).toBe("recovered");

    mockUpdateAnalystAgentLog.mockRejectedValueOnce(new Error("patch-fail"));
    await updateLog(message);
    expect(getChatState("A").logErrorKinds["5"]).toBe("update");

    mockUpdateAnalystAgentLog.mockResolvedValueOnce(mutationResponse());
    mockGetAnalystAgentLog.mockResolvedValueOnce(logResponse("after-patch"));
    await retryLog(message);
    expect(getChatState("A").logErrorKinds["5"]).toBeUndefined();
    const lastPatch = formDataCallAt(
      mockUpdateAnalystAgentLog.mock.calls.length - 1,
      "last analyst log update"
    );
    expect(lastPatch.get("task_id")).toBe("task-5");
    expect(mockGetAnalystAgentLog).toHaveBeenLastCalledWith({ id: "5" });
  });

  it("legacy showLog=true initializes one open map entry once; absent/false stays closed", async () => {
    mockGetAnalystAgentLog.mockResolvedValue(logResponse("legacy"));
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
    mockGetAnalystAgentLog.mockResolvedValue(logResponse("A-log"));
    const message = msg({ id: "31" });
    currentChat.value = { messages: [message] };
    const { setLogExpanded } = makeComposable();
    await setLogExpanded(message, true);
    expect(getChatState("A").logData["31"]?.text).toBe("A-log");

    currentChatId.value = "B";
    expect(getChatState("B").logData["31"]).toBeUndefined();
    expect(getChatState("B").activityExpandedByMessage).toEqual({});
  });

  it("🔒 capture invariant: updatingLog cleanup lands on the originating chat after mid-flight switch", async () => {
    const updatePromise = deferred<ApiEnvelope<MutationData>>();
    mockUpdateAnalystAgentLog.mockReturnValueOnce(updatePromise.promise);
    mockGetAnalystAgentLog.mockResolvedValue(logResponse("ok"));

    const message = msg({ id: "41", task_id: "task-41", showLog: true });
    currentChat.value = { messages: [message] };
    getChatState("A").activityExpandedByMessage[analystLogActivityKey("41")] =
      true;
    getChatState("A").logData["41"] = {
      state: "AVAILABLE",
      source: "LEGACY_TASK",
      text: "cached",
      revision: 1,
      truncated: false,
      can_request_legacy_refresh: true,
      error_code: null,
    };

    const { updateLog } = makeComposable();
    const inflight = updateLog(message);
    expect(getChatState("A").updatingLog["41"]).toBe(true);

    currentChatId.value = "B";
    updatePromise.resolve(mutationResponse());
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

  it("legacy initialization ignores absent log rows instead of throwing", async () => {
    currentChat.value = invalidInput<ChatView>({
      messages: [null, undefined, msg({ id: "61" })],
    });

    expect(() => makeComposable()).not.toThrow();
    await nextTick();

    expect(mockGetAnalystAgentLog).not.toHaveBeenCalled();
    expect(getChatState("A").activityExpandedByMessage).toEqual({});
  });
});
