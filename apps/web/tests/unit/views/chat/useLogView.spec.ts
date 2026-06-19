import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";

// Mock element-plus
vi.mock("element-plus", () => ({
  ElMessage: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock API module
const mockGetAnalystAgentLog = vi.fn();
const mockUpdateAnalystAgentLog = vi.fn();
vi.mock("@/api/chat", () => ({
  getHistoryQuestionList: vi.fn(),
  getAnalystAgentLog: (...args: any[]) => mockGetAnalystAgentLog(...args),
  updateAnalystAgentLog: (...args: any[]) => mockUpdateAnalystAgentLog(...args),
}));

import { useLogView } from "@/views/chat/composables/useLogView";
import { ElMessage } from "element-plus";

describe("useLogView", () => {
  type ChatState = {
    logData: Record<string, any>;
    loadingLog: Record<string, boolean>;
    updatingLog: Record<string, boolean>;
  };

  let stateMap: Map<string, ChatState>;
  let isSending: ReturnType<typeof ref<boolean>>;
  let currentChatId: ReturnType<typeof ref<string>>;
  let currentChat: ReturnType<typeof ref<any>>;
  let scrollToBottom: ReturnType<typeof vi.fn>;
  let getChatState: (id: string) => ChatState;

  function makeState(): ChatState {
    return { logData: {}, loadingLog: {}, updatingLog: {} };
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
    currentChat = ref({ messages: [{ id: "m1", showLog: false }] });
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

  // Test 1: toggleLogView happy path
  it("toggleLogView happy path: flips showLog, fetches log, populates logData", async () => {
    const logPayload = "log content string";
    mockGetAnalystAgentLog.mockResolvedValueOnce({
      code: 200,
      data: logPayload,
    });

    const { toggleLogView } = makeComposable();
    await toggleLogView("m1");

    // showLog should have been flipped to true
    expect(currentChat.value.messages[0].showLog).toBe(true);

    // API was called
    expect(mockGetAnalystAgentLog).toHaveBeenCalledWith({ id: "m1" });

    // logData populated on state A
    expect(getChatState("A").logData["m1"]).toBe(logPayload);

    // loadingLog is false after completion
    expect(getChatState("A").loadingLog["m1"]).toBe(false);
  });

  // Test 2: toggleLogView gate — early return when isSending
  it("toggleLogView gate: returns early when isSending is true", async () => {
    isSending.value = true;

    const { toggleLogView } = makeComposable();
    await toggleLogView("m1");

    expect(mockGetAnalystAgentLog).not.toHaveBeenCalled();
    // showLog stays false
    expect(currentChat.value.messages[0].showLog).toBe(false);
  });

  // Test 3: CAPTURE INVARIANT
  // updateLog captures chatState at entry; mid-flight chat switch must not
  // redirect cleanup to the new chat.
  it("🔒 capture invariant: updatingLog cleanup lands on the originating chat after mid-flight switch", async () => {
    // Manually controlled promise for updateAnalystAgentLog
    let resolveUpdate!: (value: any) => void;
    const updatePromise = new Promise<any>((res) => {
      resolveUpdate = res;
    });
    mockUpdateAnalystAgentLog.mockReturnValueOnce(updatePromise);

    const { updateLog } = makeComposable();

    // Start but do NOT await — let it suspend at the await updateAnalystAgentLog
    const inflight = updateLog("m1");

    // At this point, updatingLog["m1"] should be true on chat A (set before the await)
    expect(getChatState("A").updatingLog["m1"]).toBe(true);

    // Simulate mid-flight chat switch to B
    currentChatId.value = "B";

    // Now resolve the pending updateAnalystAgentLog call
    resolveUpdate({ code: 200 });

    // Await the full completion
    await inflight;

    // Cleanup must land on A (the captured chatState), NOT B
    expect(getChatState("A").updatingLog["m1"]).toBe(false);

    // B must be completely untouched
    expect(getChatState("B").updatingLog["m1"]).toBeUndefined();
  });
});

/*
 * MUTATION VERIFICATION (offline, not run as a test case):
 *
 * To confirm the capture-invariant test above is not a false green, the
 * following mutation was applied to a TEMP COPY of useLogView.ts:
 *
 *   In updateLog's finally block, replace:
 *     chatState.updatingLog[messageId] = false;
 *   with:
 *     getChatState(currentChatId.value).updatingLog[messageId] = false;
 *
 * With that mutation the capture-invariant test (test 3) goes RED:
 *   - getChatState("A").updatingLog["m1"] remains true  (was never cleaned up)
 *   - getChatState("B").updatingLog["m1"] becomes false (wrong chat was written)
 *
 * This confirms the test exercises the actual invariant. The temp file was
 * deleted after verification; the tracked tree is clean.
 */
