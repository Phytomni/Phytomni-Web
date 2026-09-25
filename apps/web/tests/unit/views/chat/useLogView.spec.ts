import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref, nextTick, type Ref } from "vue";
import type { AnalystAgentLog, ApiEnvelope } from "@/api/types";
import type { ChatMessage, ChatUIState, ChatView } from "@/views/chat/types";
import { buildApiEnvelope } from "../../../helpers/apiBuilders";
import {
  buildChatMessage,
  buildChatState,
} from "../../../helpers/chatBuilders";
import { deferred, mustGet } from "../../../helpers/mockFactories";
import { invalidInput } from "../../../helpers/invalidInput";

const mockGetAnalystAgentLog = vi.hoisted(() =>
  vi.fn<(data: { id: string }) => Promise<ApiEnvelope<AnalystAgentLog>>>()
);
vi.mock("@/api/chat", () => ({
  getHistoryQuestionList: vi.fn(),
  getAnalystAgentLog: mockGetAnalystAgentLog,
}));

import {
  useLogView,
  deriveAnalystLogRowId,
  analystLogActivityKey,
} from "@/views/chat/composables/useLogView";

describe("deriveAnalystLogRowId", () => {
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
});

describe("useLogView", () => {
  let stateMap: Map<string, ChatUIState>;
  let currentChatId: Ref<string>;
  let currentChat: Ref<ChatView | null>;
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

    currentChatId = ref("A");
    currentChat = ref({ messages: [] });
  });

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

  function invalidLogResponse(code: number): ApiEnvelope<AnalystAgentLog> {
    return invalidInput<ApiEnvelope<AnalystAgentLog>>(
      buildApiEnvelope(null, { code })
    );
  }

  function makeComposable() {
    return useLogView({
      currentChat,
      currentChatId,
      getChatState,
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

  it("refetches a cached PENDING modern log when the disclosure opens again", async () => {
    const message = msg({ id: "73" });
    const state = getChatState("A");
    state.logData["73"] = {
      state: "PENDING",
      source: "BOT_RUN",
      text: "",
      revision: 0,
      truncated: false,
      can_request_legacy_refresh: false,
      error_code: null,
    };
    mockGetAnalystAgentLog.mockResolvedValue(
      buildApiEnvelope({
        state: "AVAILABLE",
        source: "BOT_RUN",
        text: "Get conda environment finish!",
        revision: 1,
        truncated: false,
        can_request_legacy_refresh: false,
        error_code: null,
      })
    );

    const { setLogExpanded } = makeComposable();
    await setLogExpanded(message, true);

    expect(mockGetAnalystAgentLog).toHaveBeenCalledWith({ id: "73" });
    expect(state.logData["73"]?.text).toBe("Get conda environment finish!");
    expect(state.logData["73"]?.state).toBe("AVAILABLE");
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

  it("positive-decimal rowId drives the only read-only log request", async () => {
    mockGetAnalystAgentLog.mockResolvedValue(logResponse("ok"));
    const logView = makeComposable();
    expect("updateLog" in logView).toBe(false);

    for (const bad of ["0", "-1", "x", undefined]) {
      const m = invalidInput<ChatMessage>({
        ...msg({ task_id: "task-real" }),
        id: bad,
      });
      await logView.setLogExpanded(m, true);
    }
    expect(mockGetAnalystAgentLog).not.toHaveBeenCalled();

    const distinct = msg({ id: "88", task_id: "task-88" });
    currentChat.value = { messages: [distinct] };
    await logView.setLogExpanded(distinct, true);
    expect(mockGetAnalystAgentLog).toHaveBeenCalledWith({ id: "88" });
  });

  it("stores fetch error kinds and retry clears only that row before the read request", async () => {
    mockGetAnalystAgentLog.mockRejectedValueOnce(new Error("boom"));
    const message = msg({ id: "5", task_id: "task-5" });
    currentChat.value = { messages: [message] };

    const { setLogExpanded, retryLog } = makeComposable();
    await setLogExpanded(message, true);
    expect(getChatState("A").logErrorKinds["5"]).toBe("fetch");

    mockGetAnalystAgentLog.mockResolvedValueOnce(logResponse("recovered"));
    await retryLog(message);
    expect(getChatState("A").logErrorKinds["5"]).toBeUndefined();
    expect(mockGetAnalystAgentLog).toHaveBeenLastCalledWith({ id: "5" });
    expect(getChatState("A").logData["5"]?.text).toBe("recovered");
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

  it("keeps a deferred Research Activity response scoped without scrolling the current transcript", async () => {
    const request = deferred<ApiEnvelope<AnalystAgentLog>>();
    mockGetAnalystAgentLog.mockReturnValueOnce(request.promise);
    const messageA = msg({
      id: "32",
      tool_name: "InSilicoResearchAgent",
    });
    currentChat.value = { messages: [messageA] };

    const { setLogExpanded } = makeComposable();
    const inflight = setLogExpanded(messageA, true);
    expect(mockGetAnalystAgentLog).toHaveBeenCalledOnce();
    expect(mockGetAnalystAgentLog).toHaveBeenCalledWith({ id: "32" });

    currentChatId.value = "B";
    const messageB = msg({
      id: "33",
      tool_name: "InSilicoResearchAgent",
    });
    currentChat.value = { messages: [messageB] };
    await setLogExpanded(messageB, false);

    expect(mockGetAnalystAgentLog).toHaveBeenCalledOnce();

    request.resolve(logResponse("A-research-log"));
    await inflight;
    await nextTick();

    expect(getChatState("A").logData["32"]?.text).toBe("A-research-log");
    expect(getChatState("B").logData["32"]).toBeUndefined();
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
