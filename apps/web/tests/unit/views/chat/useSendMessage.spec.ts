import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";
import { ref, type Ref } from "vue";
import type {
  Chat,
  ChatComposerHandle,
  ChatMessage,
  ChatUIState,
  ChatView,
  DialogueReconciliationResult,
} from "@/views/chat/types";
import type { ResumableUploadItem } from "@/views/chat/upload/types";
import type { ApiEnvelope, DecodedQueryData } from "@/api/types";
import type {
  BotCapabilityByTool,
  BotResearchInputCapability,
} from "@/views/chat/composables/useBotCapabilities";
import { deferred, mustGet } from "../../../helpers/mockFactories";
import {
  buildChatMessage,
  buildChatState,
} from "../../../helpers/chatBuilders";
import { invalidInput } from "../../../helpers/invalidInput";

const SAFE_RESEARCH_PATH_LINES = [
  "/fixtures/rice-root/GSE146033_RAW/GSM4363196_9311RPM.txt.gz",
  "/fixtures/rice-root/GSE146033_RAW/GSM4363198_Nip_RPM.txt.gz",
  "/fixtures/rice-root/GSM4363200_9311/GSM4363200_9311_barcodes.tsv.gz",
  "/fixtures/rice-root/GSM4363200_9311/GSM4363200_9311_genes.tsv.gz",
  "/fixtures/rice-root/GSM4363200_9311/GSM4363200_9311_matrix.mtx.gz",
  "/fixtures/rice-root/GSM4363201_Nip/GSM4363201_Nip_barcodes.tsv.gz",
  "/fixtures/rice-root/GSM4363201_Nip/GSM4363201_Nip_genes.tsv.gz",
  "/fixtures/rice-root/GSM4363201_Nip/GSM4363201_Nip_matrix.mtx.gz",
  "/fixtures/rice-root/Orthologues/Orthologues_A_thaliana_pep/A_thaliana_pep__v__NIP_genome_pep.tsv",
  "/fixtures/rice-root/Orthologues/Orthologues_NIP_genome_pep/NIP_genome_pep__v__A_thaliana_pep.tsv",
  "/fixtures/rice-root/org.Osativa.eg.db.tar.gz",
] as const;

type StreamResult = {
  dialogueId?: string;
  messageId?: string;
  completed?: boolean;
  contextNotice?: {
    context_rebuilt?: boolean;
    context_degraded?: boolean;
  };
};
type StreamInput = {
  placeholder: ChatMessage;
  requestId: string;
  dialogueId: string;
  formData: FormData;
  onIdentity?: (identity: { dialogueId: string; messageId: string }) => void;
};

const streamHarness = vi.hoisted(() => ({
  capturedGetChatState: undefined as ((id: string) => ChatUIState) | undefined,
  streamMessage: vi.fn<(input: StreamInput) => Promise<StreamResult>>(),
}));

// getQueryAbortable (main send) + getAnswerCheck (network-error recovery) are APIs the
// composable imports directly, so they must be mocked.
vi.mock("@/api/chat", () => ({
  getQueryAbortable: vi.fn(),
  getAnswerCheck: vi.fn(),
}));

vi.mock("@/views/chat/composables/useStreamMessage", () => ({
  useStreamMessage: (opts: { getChatState: (id: string) => ChatUIState }) => {
    streamHarness.capturedGetChatState = opts.getChatState;
    return { streamMessage: streamHarness.streamMessage };
  },
}));

// element-plus's ElMessage/ElMessageBox are invoked on a failed pending write / the 403 dialog.
vi.mock("element-plus", () => ({
  ElMessage: { warning: vi.fn() },
  ElMessageBox: { alert: vi.fn() },
}));

// pending-chat utilities: localStorage write/clear (only new_-prefixed dialogues take this path).
vi.mock("@/utils/pending-chat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/pending-chat")>();
  return {
    ...actual,
    writePendingChat: vi.fn(),
    clearPendingChat: vi.fn(),
    isLocalStorageChat: vi.fn((id: string) => id.startsWith("new_")),
  };
});

// network-error detection: default is not a network error.
vi.mock("@/utils/network-error", () => ({
  isNetworkError: vi.fn(() => false),
}));

import { useSendMessage } from "@/views/chat/composables/useSendMessage";
import { getAnswerCheck, getQueryAbortable } from "@/api/chat";
import { clearPendingChat, writePendingChat } from "@/utils/pending-chat";
import { useChatStates } from "@/views/chat/composables/useChatStates";
import { ElMessage } from "element-plus";

const mockGetQueryAbortable = vi.mocked(getQueryAbortable);
const mockGetAnswerCheck = vi.mocked(getAnswerCheck);
const mockClearPendingChat = vi.mocked(clearPendingChat);
const mockWritePendingChat = vi.mocked(writePendingChat);

type ChatStateRecord = ChatUIState;
type HistoryQuestionLookup = (
  sendingDialogueId?: string,
  options?: { blockingDialogueId?: string }
) => Promise<DialogueReconciliationResult | undefined>;
type DialogueIdentityReconciler = (
  tempId: string,
  serverId: string
) => DialogueReconciliationResult;

describe("useSendMessage", () => {
  // One mutable state per dialogueId; repeated getChatState(id) returns the same object
  let states: Map<string, ChatStateRecord>;
  let getChatState: (dialogueId: string) => ChatStateRecord;
  let currentChatId: Ref<string>;
  let currentChat: Ref<ChatView | null>;
  let composerRef: Ref<ChatComposerHandle | null>;
  let chatList: Ref<Chat[]>;
  let timestamp: Ref<number>;
  let getHistoryQuestionData: Mock<HistoryQuestionLookup>;
  let reconcileDialogueIdentity: Mock<DialogueIdentityReconciler>;
  let selectChat: Mock<(dialogueId: string) => Promise<void>>;
  let scrollToBottom: Mock<() => Promise<void>>;

  function makeState(
    overrides: Partial<ChatStateRecord> = {}
  ): ChatStateRecord {
    return buildChatState({ messageInput: "hi", ...overrides });
  }

  function completedUpload(
    name = "sample.txt",
    assetId = "file_sample"
  ): ResumableUploadItem {
    return {
      localId: `upload-${assetId}`,
      file: null,
      assetId,
      name,
      size: 5,
      type: "text/plain",
      lastModified: 0,
      status: "completed",
      partSize: 5,
      partCount: 1,
      receivedParts: [1],
      loadedBytes: 5,
      speedBytesPerSecond: 0,
      etaSeconds: null,
      retryCount: 0,
      errorCode: null,
    };
  }

  function stateFor(dialogueId: string): ChatStateRecord {
    return mustGet(states.get(dialogueId), `chat state ${dialogueId}`);
  }

  function messagesFor(state: ChatStateRecord, label: string): ChatMessage[] {
    return mustGet(state.renderedChat, `${label}: rendered chat`).messages;
  }

  function lastMessageFor(state: ChatStateRecord, label: string): ChatMessage {
    return mustGet(messagesFor(state, label).at(-1), `${label}: last message`);
  }

  function queryCallAt(
    index: number,
    label: string
  ): Parameters<typeof getQueryAbortable> {
    return mustGet(mockGetQueryAbortable.mock.calls[index], label);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    streamHarness.capturedGetChatState = undefined;
    streamHarness.streamMessage.mockReset();
    streamHarness.streamMessage.mockResolvedValue({});
    vi.stubEnv("VITE_STREAM_ENABLED", "false");
    states = new Map();
    states.set("A", makeState());
    states.set("B", makeState({ messageInput: "" }));
    getChatState = (dialogueId: string) => {
      if (!states.has(dialogueId)) {
        states.set(dialogueId, makeState());
      }
      return stateFor(dialogueId);
    };
    currentChatId = ref("A");
    currentChat = ref<ChatView | null>({ messages: [] });
    composerRef = ref({
      closeHeader: vi.fn(),
      openHeader: vi.fn(),
      popoverVisible: false,
    });
    chatList = ref([
      { id: 1, dialogue_id: "A", title: "t", date: "", isFavorite: false },
      { id: 2, dialogue_id: "B", title: "t2", date: "", isFavorite: false },
    ]);
    timestamp = ref(0);
    getHistoryQuestionData = vi
      .fn<HistoryQuestionLookup>()
      .mockResolvedValue(undefined);
    reconcileDialogueIdentity = vi
      .fn<DialogueIdentityReconciler>()
      .mockImplementation((tempId, serverId) => ({
        status: "reconciled",
        tempId,
        serverId,
        rekey: { outcome: tempId === serverId ? "same-id" : "moved" },
      }));
    selectChat = vi.fn<(dialogueId: string) => Promise<void>>();
    selectChat.mockResolvedValue(undefined);
    scrollToBottom = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function researchInputCapability(
    overrides: Partial<BotResearchInputCapability> = {}
  ): BotResearchInputCapability {
    return {
      enabled: true,
      protocol: "research_input_resolution_v1",
      max_user_query_chars: 131072,
      max_attachments_per_request: 64,
      max_research_dataset_paths: 64,
      max_research_input_references: 128,
      ...overrides,
    };
  }

  function makeComposable(
    options: {
      researchInput?: BotResearchInputCapability;
      streamTools?: readonly (keyof BotCapabilityByTool)[];
    } = {}
  ) {
    const researchInput = options.researchInput ?? researchInputCapability();
    const streamTools =
      options.streamTools ??
      (import.meta.env.VITE_STREAM_ENABLED === "true" ? ["ChatAgent"] : []);
    const botCapabilitiesByTool = Object.fromEntries(
      streamTools.map((tool) => [
        tool,
        {
          tool,
          slug: tool,
          execution: tool === "BriefGeneAgent" ? "agent_run" : "chat",
          stream: true,
          a2ui: false,
          resolver: false,
          attachments: false,
          attachmentChannels: [],
          artifacts: false,
          enabled: true,
        },
      ])
    ) as BotCapabilityByTool;
    const composableOptions = {
      getChatState,
      currentChatId,
      currentChat,
      composerRef,
      t: (k: string) => k,
      userStore: () => ({
        FedLogOut: vi.fn<() => Promise<unknown>>().mockResolvedValue(undefined),
      }),
      getHistoryQuestionData,
      reconcileDialogueIdentity,
      chatList,
      timestamp,
      selectChat,
      scrollToBottom,
      researchInputCapability: ref(researchInput),
      botCapabilitiesByTool: ref(botCapabilitiesByTool),
    };
    return useSendMessage(composableOptions);
  }

  it("rejects an over-limit forced Research draft before any mutation", async () => {
    const draft = "🧬".repeat(131073);
    const state = stateFor("A");
    state.messageInput = draft;
    state.mode = "expert";
    state.selectedAgent = "InSilicoResearchAgent";
    const originalRenderedChat = state.renderedChat;

    await makeComposable().sendMessage();

    expect(mockGetQueryAbortable).not.toHaveBeenCalled();
    expect(streamHarness.streamMessage).not.toHaveBeenCalled();
    expect(state.messageInput).toBe(draft);
    expect(state.renderedChat).toBe(originalRenderedChat);
    expect(currentChat.value?.messages).toEqual([]);
    expect(state.isSending).toBe(false);
    expect(state.activeRequestId).toBe("");
    expect(state.pendingTurnId).toBeNull();
    expect(state.pendingTurnFingerprint).toBeNull();
    expect(ElMessage.warning).toHaveBeenCalledWith(
      "agents.research.questionTooLong"
    );
  });

  it("sends an exact-limit forced Research draft without changing its raw text", async () => {
    const draft = `\n${"🧬".repeat(131070)}\n`;
    const state = stateFor("A");
    state.messageInput = draft;
    state.mode = "expert";
    state.selectedAgent = "InSilicoResearchAgent";
    mockGetQueryAbortable.mockResolvedValueOnce(
      invalidInput<ApiEnvelope<DecodedQueryData>>({
        data: {
          tool_name: "InSilicoResearchAgent",
          answer: "",
          status: "RUNNING",
          id: "131072",
          bot_run_id: "run-research-exact-limit",
        },
      })
    );

    await makeComposable().sendMessage();

    const formData = queryCallAt(
      0,
      "exact-limit Research query"
    )[0] as FormData;
    expect(formData.get("query")).toBe(draft);
    expect(ElMessage.warning).not.toHaveBeenCalled();
  });

  it("projects bounded metadata-free history without mutating the hydrated Research ledger", async () => {
    const expectedTransportPrefix = "🧬" + "a".repeat(32766) + "🌾";
    const persistedResearchQuery =
      expectedTransportPrefix + "🚫" + "z".repeat(98303);
    const hydratedHistory: ChatMessage[] = Array.from(
      { length: 22 },
      (_, index) => ({
        role: index === 2 ? "system" : index % 2 === 0 ? "user" : "assistant",
        content:
          index === 1 ? persistedResearchQuery : `persisted-message-${index}`,
        id: `persisted-row-${index}`,
        attachments: [
          {
            asset_id: `file-history-${index}`,
            name: `history-${index}.txt`,
            size: index + 1,
            type: "text/plain",
          },
        ],
      })
    );
    const state = stateFor("A");
    state.messageInput = "Run Research with the exact current query.";
    state.mode = "expert";
    state.selectedAgent = "InSilicoResearchAgent";
    state.historyQuestion = hydratedHistory;
    const pending = deferred<ApiEnvelope<DecodedQueryData>>();
    mockGetQueryAbortable.mockReturnValueOnce(pending.promise);

    const sendPromise = makeComposable().sendMessage();
    await vi.waitFor(() => {
      expect(mockGetQueryAbortable).toHaveBeenCalledTimes(1);
    });

    const formData = queryCallAt(
      0,
      "bounded Research history query"
    )[0] as FormData;
    const wireHistory = JSON.parse(String(formData.get("history"))) as Array<{
      role: string;
      content: string;
    }>;
    expect(formData.get("query")).toBe(
      "Run Research with the exact current query."
    );
    expect(wireHistory).toHaveLength(20);
    expect(wireHistory[0]?.role).toBe("assistant");
    expect(wireHistory[0]?.content).toBe(expectedTransportPrefix);
    expect(Array.from(wireHistory[0]?.content ?? "")).toHaveLength(32768);
    expect(wireHistory[1]).toEqual({
      role: "assistant",
      content: "persisted-message-3",
    });
    expect(wireHistory.some((message) => message.role === "system")).toBe(
      false
    );
    expect(wireHistory.at(-1)).toEqual({
      role: "assistant",
      content: "persisted-message-21",
    });
    expect(
      wireHistory.every(
        (message) => Object.keys(message).sort().join(",") === "content,role"
      )
    ).toBe(true);
    expect(state.historyQuestion).toBe(hydratedHistory);
    expect(hydratedHistory[1]?.content).toBe(persistedResearchQuery);
    expect(hydratedHistory[2]?.role).toBe("system");
    expect(Array.from(String(hydratedHistory[1]?.content))).toHaveLength(
      131072
    );

    pending.resolve(
      invalidInput<ApiEnvelope<DecodedQueryData>>({
        data: {
          tool_name: "InSilicoResearchAgent",
          answer: "",
          status: "RUNNING",
          id: "9001",
          bot_run_id: "run-bounded-history",
        },
      })
    );
    await sendPromise;
  });

  it("does not apply a disabled Research capability to autonomous Expert routing", async () => {
    const state = stateFor("A");
    state.messageInput = "route autonomously";
    state.mode = "expert";
    state.selectedAgent = "";
    mockGetQueryAbortable.mockResolvedValueOnce(
      invalidInput<ApiEnvelope<DecodedQueryData>>({
        data: {
          tool_name: "InSilicoResearchAgent",
          answer: "",
          status: "RUNNING",
          id: "autonomous-research",
          bot_run_id: "run-autonomous-research",
        },
      })
    );

    await makeComposable({
      researchInput: researchInputCapability({
        enabled: false,
        max_user_query_chars: 0,
        max_attachments_per_request: 0,
        max_research_dataset_paths: 0,
        max_research_input_references: 0,
      }),
    }).sendMessage();

    expect(mockGetQueryAbortable).toHaveBeenCalledTimes(1);
    expect(ElMessage.warning).not.toHaveBeenCalled();
    const formData = queryCallAt(0, "autonomous Expert query")[0] as FormData;
    expect(formData.get("tool")).toBe("");
    expect(formData.get("query")).toBe("route autonomously");
  });

  it("does not apply the negotiated Research limit to another forced Expert agent", async () => {
    const state = stateFor("A");
    state.messageInput = "longer than the test Research limit";
    state.mode = "expert";
    state.selectedAgent = "DataAgent";
    mockGetQueryAbortable.mockResolvedValueOnce(
      invalidInput<ApiEnvelope<DecodedQueryData>>({
        data: {
          tool_name: "DataAgent",
          answer: "accepted",
          status: "SUCCEEDED",
          id: "data-agent-limit-scope",
        },
      })
    );

    await makeComposable({
      researchInput: researchInputCapability({ max_user_query_chars: 2 }),
    }).sendMessage();

    expect(mockGetQueryAbortable).toHaveBeenCalledTimes(1);
  });

  it("happy path: pushes user+assistant messages, clears input/files, resets isSending, syncs reaction", async () => {
    stateFor("A").messageInput = "Hello world";
    mockGetQueryAbortable.mockResolvedValueOnce(
      invalidInput<ApiEnvelope<DecodedQueryData>>({
        data: {
          tool_name: "ChatAgents",
          answer: "I'm the assistant",
          id: "msg-1",
          bot_run_id: "run-msg-1",
          report_revision: 1,
          request_id: "web-request-msg-1",
          reaction_type: "1",
          follow_up_questions: [],
        },
      })
    );

    const { sendMessage } = makeComposable();
    await sendMessage();

    // Pushed one user message + one assistant message
    const msgs = messagesFor(getChatState("A"), "happy path");
    expect(msgs.length).toBe(2);
    expect(msgs[0].role).toBe("user");
    expect(msgs[0].content).toContain("Hello world");
    expect(msgs[1].role).toBe("assistant");
    expect(msgs[1].content).toBe("I'm the assistant");
    expect(msgs[1].botProjection).toMatchObject({
      runId: "run-msg-1",
      reportRevision: 1,
      requestId: "web-request-msg-1",
    });

    // Cleanup is done via the captured chatState
    const stateA = getChatState("A");
    expect(stateA.messageInput).toBe("");
    expect(stateA.isSending).toBe(false);
    expect(stateA.fileList).toEqual([]);
    expect(stateA.activeRequestId).toBe("");

    // The reaction was synced
    expect(stateA.reactions["msg-1"]).toBe(1);

    // The request was called once with A's parent row id
    expect(mockGetQueryAbortable).toHaveBeenCalledTimes(1);
    const [formDataArg, requestIdArg] = queryCallAt(0, "happy path query call");
    const formData = formDataArg as FormData;
    expect(formData.get("id")).toBe("1");
    const requestId = requestIdArg as string;
    expect(requestId.startsWith("chat-request-")).toBe(true);
    expect(formData.get("client_turn_id")).toMatch(
      /^turn-[A-Za-z0-9-]{16,64}$/
    );
    expect(stateA.pendingTurnId).toBeNull();
    expect(stateA.pendingTurnFingerprint).toBeNull();
  });

  it("keeps only bounded archive delivery and links for a blocking v1 response", async () => {
    const delivery = {
      schema_version: 1,
      required: true,
      status: "ready",
      revision: 1,
      name: "network-results.zip",
      size_bytes: 1024,
      error_code: null,
      retryable: false,
    } as const;
    mockGetQueryAbortable.mockResolvedValueOnce(
      invalidInput<ApiEnvelope<DecodedQueryData>>({
        data: {
          id: "42",
          dialogue_id: "A",
          bot_run_id: "run-network",
          tool_name: "GeneNetworkAgent",
          status: "SUCCEEDED",
          answer: "Network report",
          result_archive_v1: true,
          delivery,
          artifacts: [
            { id: "archive-1", name: "network-results.zip", kind: "archive" },
          ],
          upload_path: "/obs/private/upload",
          download_path: "/obs/private/download",
          image_paths: ["/obs/private/result.png"],
          server_file_path: "/srv/private/result.txt",
        },
      })
    );

    await makeComposable().sendMessage();

    const assistant = lastMessageFor(stateFor("A"), "archive response");
    expect(assistant.delivery).toEqual(delivery);
    expect(assistant.artifacts).toEqual([
      { id: "archive-1", name: "network-results.zip", kind: "archive" },
    ]);
    expect(assistant.botProjection?.artifacts).toEqual([]);
    expect(assistant).not.toHaveProperty("upload_path");
    expect(assistant).not.toHaveProperty("download_path");
    expect(assistant).not.toHaveProperty("server_file_path");
    expect(JSON.stringify(assistant)).not.toContain("/obs/private");
    expect(JSON.stringify(assistant)).not.toContain("/srv/private");
  });

  it("keeps a blocking answer with authorized artifacts when context is degraded", async () => {
    stateFor("A").messageInput = "Build report";
    mockGetQueryAbortable.mockResolvedValueOnce(
      invalidInput<ApiEnvelope<DecodedQueryData>>({
        data: {
          tool_name: "ChatAgent",
          answer: "The report is ready.",
          id: "msg-artifact",
          context_rebuilt: true,
          context_degraded: true,
          artifacts: [
            {
              id: "artifact-1",
              name: "report.pdf",
              kind: "report",
            },
          ],
        },
      })
    );

    const { sendMessage } = makeComposable();
    await sendMessage();

    const assistant = lastMessageFor(stateFor("A"), "artifact response");
    expect(assistant.content).toBe("The report is ready.");
    expect(assistant.artifacts).toEqual([
      {
        id: "artifact-1",
        name: "report.pdf",
        kind: "report",
      },
    ]);
    expect(assistant.download_path).toBeUndefined();
    expect(assistant.contextNotice).toEqual({
      rebuilt: true,
      degraded: true,
    });
    expect(ElMessage.warning).toHaveBeenCalledWith("chat.contextDegraded");
  });

  it("keeps the Expert route reason on the assistant message", async () => {
    stateFor("A").messageInput = "hello";
    mockGetQueryAbortable.mockResolvedValueOnce(
      invalidInput<ApiEnvelope<DecodedQueryData>>({
        data: {
          tool_name: "ChatAgent",
          answer: "plain chat",
          id: "msg-fallback",
          route_reason_code: "CHAT_FALLBACK",
        },
      })
    );

    await makeComposable().sendMessage();

    const assistant = lastMessageFor(stateFor("A"), "plain chat");
    expect(assistant.route_reason_code).toBe("CHAT_FALLBACK");
  });

  it("reuses a client turn id across a same-draft network retry while request keys change", async () => {
    const { isNetworkError } = await import("@/utils/network-error");
    vi.mocked(isNetworkError).mockReturnValueOnce(true);
    vi.useFakeTimers();
    mockGetQueryAbortable.mockRejectedValueOnce(new Error("network"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(vi.fn());
    const { sendMessage } = makeComposable();

    let firstTurnId: FormDataEntryValue | null = null;
    let firstRequestId: string | undefined;
    try {
      const firstSend = sendMessage();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(1000);
      await firstSend;
      const firstCall = queryCallAt(0, "first uncertain attempt");
      firstTurnId = (firstCall[0] as FormData).get("client_turn_id");
      firstRequestId = firstCall[1];
      expect(stateFor("A").pendingTurnId).toBe(firstTurnId);
    } finally {
      vi.useRealTimers();
    }

    stateFor("A").messageInput = "hi";
    mockGetQueryAbortable.mockResolvedValueOnce(
      invalidInput<ApiEnvelope<DecodedQueryData>>({
        data: { tool_name: "ChatAgent", answer: "accepted", id: "msg-retry" },
      })
    );
    await sendMessage();

    const secondCall = queryCallAt(1, "second accepted attempt");
    expect((secondCall[0] as FormData).get("client_turn_id")).toBe(firstTurnId);
    expect(secondCall[1]).not.toBe(firstRequestId);
    expect(stateFor("A").pendingTurnId).toBeNull();
    consoleError.mockRestore();
  });

  it("uses a new client turn id when the retry draft is edited", async () => {
    mockGetQueryAbortable.mockRejectedValueOnce(new Error("first failure"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(vi.fn());
    const { sendMessage } = makeComposable();
    await sendMessage();

    const firstTurnId = (queryCallAt(0, "first draft")[0] as FormData).get(
      "client_turn_id"
    );
    stateFor("A").messageInput = "edited";
    mockGetQueryAbortable.mockRejectedValueOnce(new Error("second failure"));
    await sendMessage();

    const secondTurnId = (queryCallAt(1, "edited draft")[0] as FormData).get(
      "client_turn_id"
    );
    expect(secondTurnId).toMatch(/^turn-/);
    expect(secondTurnId).not.toBe(firstTurnId);
    consoleError.mockRestore();
  });

  it("uses distinct client turn ids for consecutive accepted sends", async () => {
    mockGetQueryAbortable
      .mockResolvedValueOnce(
        invalidInput<ApiEnvelope<DecodedQueryData>>({
          data: { tool_name: "ChatAgent", answer: "first", id: "msg-first" },
        })
      )
      .mockResolvedValueOnce(
        invalidInput<ApiEnvelope<DecodedQueryData>>({
          data: { tool_name: "ChatAgent", answer: "second", id: "msg-second" },
        })
      );
    const { sendMessage } = makeComposable();

    await sendMessage();
    stateFor("A").messageInput = "next intentional turn";
    await sendMessage();

    const firstTurnId = (
      queryCallAt(0, "first accepted send")[0] as FormData
    ).get("client_turn_id");
    const secondTurnId = (
      queryCallAt(1, "second accepted send")[0] as FormData
    ).get("client_turn_id");
    expect(firstTurnId).toMatch(/^turn-/);
    expect(secondTurnId).toMatch(/^turn-/);
    expect(secondTurnId).not.toBe(firstTurnId);
  });

  it("clears only definite 4xx turn identity and preserves uncertain 5xx identity", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(vi.fn());
    const { sendMessage } = makeComposable();
    mockGetQueryAbortable.mockRejectedValueOnce({
      response: { status: 422, data: { pre_dispatch: true } },
    });

    await sendMessage();
    expect(stateFor("A").pendingTurnId).toBeNull();

    stateFor("A").messageInput = "server uncertainty";
    mockGetQueryAbortable.mockRejectedValueOnce({ response: { status: 503 } });
    await sendMessage();

    expect(stateFor("A").pendingTurnId).toMatch(/^turn-/);
    consoleError.mockRestore();
  });

  it("reuses a client turn id when an unchanged retry stays on stream", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(vi.fn());
    streamHarness.streamMessage.mockRejectedValueOnce(
      new Error("stream failure")
    );
    const { sendMessage } = makeComposable({ streamTools: ["ChatAgent"] });
    await sendMessage();
    const firstCall = mustGet(
      streamHarness.streamMessage.mock.calls[0],
      "first stream attempt"
    )[0];
    const firstTurnId = firstCall.clientTurnId;
    const firstRequestId = firstCall.requestId;

    stateFor("A").messageInput = "hi";
    streamHarness.streamMessage.mockResolvedValueOnce({
      messageId: "22",
      completed: true,
    });
    await sendMessage();

    const streamCall = mustGet(
      streamHarness.streamMessage.mock.calls[1],
      "stream retry"
    )[0];
    expect(streamCall.clientTurnId).toBe(firstTurnId);
    expect(streamCall.formData.get("client_turn_id")).toBe(firstTurnId);
    expect(streamCall.requestId).not.toBe(firstRequestId);
    expect(stateFor("A").pendingTurnId).toBeNull();
    consoleError.mockRestore();
  });

  it("keeps client turn identities isolated between dialogues", async () => {
    const pendingA = deferred<ApiEnvelope<DecodedQueryData>>();
    const pendingB = deferred<ApiEnvelope<DecodedQueryData>>();
    mockGetQueryAbortable
      .mockReturnValueOnce(pendingA.promise)
      .mockReturnValueOnce(pendingB.promise);
    const { sendMessage } = makeComposable();

    const sentA = sendMessage();
    await Promise.resolve();
    currentChatId.value = "B";
    currentChat.value = { messages: [] };
    stateFor("B").messageInput = "question B";
    const sentB = sendMessage();
    await Promise.resolve();

    const turnA = (queryCallAt(0, "dialogue A")[0] as FormData).get(
      "client_turn_id"
    );
    const turnB = (queryCallAt(1, "dialogue B")[0] as FormData).get(
      "client_turn_id"
    );
    expect(turnA).toMatch(/^turn-/);
    expect(turnB).toMatch(/^turn-/);
    expect(turnB).not.toBe(turnA);
    expect(stateFor("A").pendingTurnId).toBe(turnA);
    expect(stateFor("B").pendingTurnId).toBe(turnB);

    pendingA.resolve(
      invalidInput<ApiEnvelope<DecodedQueryData>>({
        data: { tool_name: "ChatAgent", answer: "A", id: "msg-a" },
      })
    );
    pendingB.resolve(
      invalidInput<ApiEnvelope<DecodedQueryData>>({
        data: { tool_name: "ChatAgent", answer: "B", id: "msg-b" },
      })
    );
    await Promise.all([sentA, sentB]);
  });

  it("commits each successful turn so the next request carries current multi-turn history", async () => {
    const state = stateFor("A");
    state.messageInput = "Follow up one";
    state.historyQuestion = [
      { role: "user", content: "Original question" },
      { role: "assistant", content: "Original answer" },
    ];
    mockGetQueryAbortable
      .mockResolvedValueOnce(
        invalidInput<ApiEnvelope<DecodedQueryData>>({
          data: {
            tool_name: "ChatAgent",
            answer: "First follow-up answer",
            id: "history-1",
            follow_up_questions: [],
          },
        })
      )
      .mockResolvedValueOnce(
        invalidInput<ApiEnvelope<DecodedQueryData>>({
          data: {
            tool_name: "ChatAgent",
            answer: "Second follow-up answer",
            id: "history-2",
            follow_up_questions: [],
          },
        })
      );

    const { sendMessage } = makeComposable();
    await sendMessage();

    expect(state.historyQuestion).toEqual([
      { role: "user", content: "Original question" },
      { role: "assistant", content: "Original answer" },
      { role: "user", content: "Follow up one" },
      { role: "assistant", content: "First follow-up answer" },
    ]);
    const [firstForm] = queryCallAt(0, "first multi-turn query call");
    const firstTurnId = (firstForm as FormData).get("client_turn_id");
    expect(firstTurnId).toMatch(/^turn-[A-Za-z0-9-]{16,64}$/);

    state.messageInput = "Follow up two";
    await sendMessage();

    const [secondFormArg] = queryCallAt(1, "second multi-turn query call");
    expect((secondFormArg as FormData).get("client_turn_id")).not.toBe(
      firstTurnId
    );
    expect(
      JSON.parse(String((secondFormArg as FormData).get("history")))
    ).toEqual([
      { role: "user", content: "Original question" },
      { role: "assistant", content: "Original answer" },
      { role: "user", content: "Follow up one" },
      { role: "assistant", content: "First follow-up answer" },
    ]);
  });

  it("keeps hydrated and newly committed user queries byte-exact across a third request", async () => {
    const hydratedResearchQuery =
      '\n  Reproduce the rice root atlas.\n\ndata: {\n  "/fixtures/rice-root/\u7a3b/matrix.mtx.gz": "counts"\n}\n  ';
    const secondTurnQuery = "\n  Compare the two cultivars.\n  ";
    const thirdTurnQuery = "\n  Summarize the comparison.\n  ";
    const state = stateFor("A");
    state.messageInput = secondTurnQuery;
    state.historyQuestion = [
      { role: "user", content: " \n\t " },
      { role: "assistant", content: " \n\t " },
      { role: "user", content: hydratedResearchQuery, attachments: [] },
      { role: "assistant", content: "  Persisted Research answer  " },
    ];
    mockGetQueryAbortable
      .mockResolvedValueOnce(
        invalidInput<ApiEnvelope<DecodedQueryData>>({
          data: {
            tool_name: "ChatAgent",
            answer: "  Second-turn answer  ",
            id: "raw-history-2",
          },
        })
      )
      .mockResolvedValueOnce(
        invalidInput<ApiEnvelope<DecodedQueryData>>({
          data: {
            tool_name: "ChatAgent",
            answer: "  Third-turn answer  ",
            id: "raw-history-3",
          },
        })
      );

    const { sendMessage } = makeComposable();
    await sendMessage();

    expect(state.historyQuestion).toEqual([
      { role: "user", content: hydratedResearchQuery },
      { role: "assistant", content: "Persisted Research answer" },
      { role: "user", content: secondTurnQuery },
      { role: "assistant", content: "Second-turn answer" },
    ]);

    state.messageInput = thirdTurnQuery;
    await sendMessage();

    const [thirdFormArg] = queryCallAt(1, "third conversation turn");
    const thirdTurnHistory = JSON.parse(
      String((thirdFormArg as FormData).get("history"))
    ) as ChatMessage[];
    expect(thirdTurnHistory[0]?.content).toBe(hydratedResearchQuery);
    expect(thirdTurnHistory[2]?.content).toBe(secondTurnQuery);
    expect(state.historyQuestion).toEqual([
      { role: "user", content: hydratedResearchQuery },
      { role: "assistant", content: "Persisted Research answer" },
      { role: "user", content: secondTurnQuery },
      { role: "assistant", content: "Second-turn answer" },
      { role: "user", content: thirdTurnQuery },
      { role: "assistant", content: "Third-turn answer" },
    ]);
  });

  it("keeps the answer while exposing only a bounded degraded context notice", async () => {
    stateFor("A").messageInput = "context-safe answer";
    mockGetQueryAbortable.mockResolvedValueOnce(
      invalidInput<ApiEnvelope<DecodedQueryData>>({
        data: {
          tool_name: "ChatAgent",
          answer: "The answer remains visible.",
          id: "context-safe-1",
          context_rebuilt: false,
          context_degraded: true,
          context_version: "private-v1",
          context_summary: "private summary",
          follow_up_questions: [],
        },
      })
    );

    await makeComposable().sendMessage();

    const assistant = lastMessageFor(
      stateFor("A"),
      "degraded context blocking answer"
    );
    expect(assistant.content).toBe("The answer remains visible.");
    expect(assistant.contextNotice).toEqual({ rebuilt: false, degraded: true });
    expect("context_version" in assistant).toBe(false);
    expect("context_summary" in assistant).toBe(false);
  });

  it("ignores malformed context notice fields without dropping the answer", async () => {
    stateFor("A").messageInput = "malformed context answer";
    mockGetQueryAbortable.mockResolvedValueOnce(
      invalidInput<ApiEnvelope<DecodedQueryData>>({
        data: {
          tool_name: "ChatAgent",
          answer: "Still visible despite malformed context metadata.",
          id: "context-malformed-1",
          context_degraded: "true",
          follow_up_questions: [],
        },
      })
    );

    await makeComposable().sendMessage();

    const assistant = lastMessageFor(
      stateFor("A"),
      "malformed context blocking answer"
    );
    expect(assistant.content).toBe(
      "Still visible despite malformed context metadata."
    );
    expect(assistant.contextNotice).toBeUndefined();
  });

  it("keeps an optimistically listed pending chat selectable while its first response is in flight", async () => {
    const tempId = "new_pending_sidebar";
    currentChatId.value = tempId;
    currentChat.value = { messages: [] };
    states.set(tempId, makeState({ messageInput: "Pending discovery" }));
    chatList.value = [];
    const pending = deferred<ApiEnvelope<DecodedQueryData>>();
    mockGetQueryAbortable.mockReturnValueOnce(pending.promise);

    const { sendMessage } = makeComposable();
    const sendPromise = sendMessage();
    await Promise.resolve();
    await Promise.resolve();

    expect(chatList.value).toEqual([
      expect.objectContaining({
        id: 0,
        dialogue_id: tempId,
        title: "Pending discovery",
        isPending: true,
      }),
    ]);

    currentChatId.value = "B";
    currentChat.value = { messages: [] };
    expect(chatList.value.some((chat) => chat.dialogue_id === tempId)).toBe(
      true
    );

    pending.resolve(
      invalidInput<ApiEnvelope<DecodedQueryData>>({
        data: {
          tool_name: "ChatAgent",
          answer: "Done",
          dialogue_id: "server-pending-sidebar",
          id: "901",
          follow_up_questions: [],
        },
      })
    );
    await sendPromise;
  });

  it("normalizes malformed follow-up JSON without discarding the blocking answer", async () => {
    stateFor("A").messageInput = "Keep the answer";
    mockGetQueryAbortable.mockResolvedValueOnce(
      invalidInput<ApiEnvelope<DecodedQueryData>>({
        data: {
          tool_name: "ChatAgent",
          answer: "The answer is still usable",
          id: "msg-follow-up",
          follow_up_questions: "not-json",
        },
      })
    );

    const { sendMessage } = makeComposable();
    await sendMessage();

    const messages = messagesFor(getChatState("A"), "malformed follow-up");
    const lastMessage = mustGet(
      messages.at(-1),
      "malformed follow-up answer message"
    );
    expect(lastMessage.content).toBe("The answer is still usable");
    expect(lastMessage.followUpQuestions).toEqual([]);
  });

  it("reuses one logical turn ID after a timeout and clears it after durable acceptance", async () => {
    const state = stateFor("A");
    state.messageInput = "retry this turn";
    mockGetQueryAbortable.mockRejectedValueOnce({ response: { status: 504 } });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(vi.fn());

    try {
      const { sendMessage } = makeComposable();
      await sendMessage();
    } finally {
      errorSpy.mockRestore();
    }

    const firstTurnId = mustGet(state.pendingTurnId, "pending retry turn ID");
    expect(firstTurnId).toMatch(/^turn-[A-Za-z0-9-]{16,64}$/);
    const [, firstRequestId] = queryCallAt(0, "initial uncertain query call");

    state.messageInput = "retry this turn";
    mockGetQueryAbortable.mockResolvedValueOnce(
      invalidInput<ApiEnvelope<DecodedQueryData>>({
        data: {
          tool_name: "ChatAgent",
          answer: "accepted after retry",
          id: "retry-accepted",
          follow_up_questions: [],
        },
      })
    );
    await makeComposable().sendMessage();

    const [retryForm] = queryCallAt(1, "retry query call");
    const [, retryRequestId] = queryCallAt(1, "retry request identity");
    expect((retryForm as FormData).get("client_turn_id")).toBe(firstTurnId);
    expect(retryRequestId).not.toBe(firstRequestId);
    expect(state.pendingTurnId).toBeNull();
    expect(state.pendingTurnFingerprint).toBeNull();
  });

  it("reuses one logical turn ID after a network error", async () => {
    const { isNetworkError } = await import("@/utils/network-error");
    vi.mocked(isNetworkError).mockReturnValue(true);
    vi.useFakeTimers();

    const state = stateFor("A");
    state.renderedChat = {
      messages: [
        buildChatMessage({
          role: "assistant",
          id: "prior-message",
          content: "Earlier answer",
        }),
      ],
    };
    currentChat.value = state.renderedChat;
    state.messageInput = "retry after network error";
    mockGetAnswerCheck.mockResolvedValueOnce({ code: 200, data: [] });
    mockGetQueryAbortable.mockRejectedValueOnce(new Error("Network Error"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(vi.fn());

    try {
      const firstSend = makeComposable().sendMessage();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(1000);
      await firstSend;

      const firstTurnId = mustGet(state.pendingTurnId, "network retry turn ID");
      const [, firstRequestId] = queryCallAt(0, "network query call");

      state.messageInput = "retry after network error";
      mockGetQueryAbortable.mockResolvedValueOnce(
        invalidInput<ApiEnvelope<DecodedQueryData>>({
          data: {
            tool_name: "ChatAgent",
            answer: "accepted after network retry",
            id: "network-retry-accepted",
            follow_up_questions: [],
          },
        })
      );
      const retrySend = makeComposable().sendMessage();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(300);
      await retrySend;

      const [retryForm] = queryCallAt(1, "network retry query call");
      const [, retryRequestId] = queryCallAt(1, "network retry request key");
      expect((retryForm as FormData).get("client_turn_id")).toBe(firstTurnId);
      expect(retryRequestId).not.toBe(firstRequestId);
      expect(state.pendingTurnId).toBeNull();
      expect(state.pendingTurnFingerprint).toBeNull();
    } finally {
      errorSpy.mockRestore();
      vi.mocked(isNetworkError).mockReturnValue(false);
      vi.useRealTimers();
    }
  });

  it("reuses a pending turn ID after a temporary dialogue is rekeyed", async () => {
    const tempId = "new_rekey_retry";
    const serverId = "server-rekey-retry";
    const state = makeState({ messageInput: "rekey-safe retry" });
    states.set(tempId, state);
    currentChatId.value = tempId;
    currentChat.value = { messages: [] };
    mockGetQueryAbortable.mockRejectedValueOnce({ response: { status: 504 } });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(vi.fn());

    try {
      await makeComposable().sendMessage();
      const firstTurnId = mustGet(
        state.pendingTurnId,
        "temporary dialogue pending turn ID"
      );

      states.delete(tempId);
      states.set(serverId, state);
      currentChatId.value = serverId;
      currentChat.value = state.renderedChat;
      chatList.value = [
        {
          id: 99,
          dialogue_id: serverId,
          title: "",
          date: "",
          isFavorite: false,
        },
      ];
      state.messageInput = "rekey-safe retry";
      mockGetQueryAbortable.mockResolvedValueOnce(
        invalidInput<ApiEnvelope<DecodedQueryData>>({
          data: {
            tool_name: "ChatAgent",
            answer: "accepted after rekey",
            id: "rekey-accepted",
            follow_up_questions: [],
          },
        })
      );

      await makeComposable().sendMessage();

      const [retryForm] = queryCallAt(1, "rekey retry query call");
      expect((retryForm as FormData).get("id")).toBe("99");
      expect((retryForm as FormData).get("client_turn_id")).toBe(firstTurnId);
      expect(state.pendingTurnId).toBeNull();
      expect(state.pendingTurnFingerprint).toBeNull();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("reuses the logical turn ID when a blocking retry switches to streaming", async () => {
    const state = stateFor("A");
    state.messageInput = "switch transport after timeout";
    mockGetQueryAbortable.mockRejectedValueOnce({ response: { status: 504 } });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(vi.fn());

    try {
      await makeComposable().sendMessage();
      const firstTurnId = mustGet(
        state.pendingTurnId,
        "transport retry turn ID"
      );

      vi.stubEnv("VITE_STREAM_ENABLED", "true");
      state.messageInput = "switch transport after timeout";
      streamHarness.streamMessage.mockResolvedValueOnce({});
      await makeComposable().sendMessage();

      const streamCall = mustGet(
        streamHarness.streamMessage.mock.calls.at(-1),
        "stream retry call"
      );
      expect((streamCall[0].formData as FormData).get("client_turn_id")).toBe(
        firstTurnId
      );
      expect(mockGetQueryAbortable).toHaveBeenCalledTimes(1);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("clears the logical turn ID when streaming reports a definite 4xx", async () => {
    vi.stubEnv("VITE_STREAM_ENABLED", "true");
    const state = stateFor("A");
    state.messageInput = "stream validation failure";
    streamHarness.streamMessage.mockResolvedValueOnce({
      preDispatch4xx: true,
    });

    await makeComposable().sendMessage();

    expect(state.pendingTurnId).toBeNull();
    expect(state.pendingTurnFingerprint).toBeNull();
  });

  it("creates a new logical turn ID when the retry draft changes", async () => {
    const state = stateFor("A");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(vi.fn());
    try {
      state.messageInput = "original draft";
      mockGetQueryAbortable.mockRejectedValueOnce({
        response: { status: 504 },
      });
      await makeComposable().sendMessage();
      const firstTurnId = mustGet(
        state.pendingTurnId,
        "first pending draft turn ID"
      );

      state.messageInput = "edited draft";
      mockGetQueryAbortable.mockRejectedValueOnce({
        response: { status: 504 },
      });
      await makeComposable().sendMessage();

      expect(state.pendingTurnId).not.toBe(firstTurnId);
      expect(state.pendingTurnId).toMatch(/^turn-[A-Za-z0-9-]{16,64}$/);
      const [editedForm] = queryCallAt(1, "edited retry query call");
      expect((editedForm as FormData).get("client_turn_id")).toBe(
        state.pendingTurnId
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("clears the logical turn ID for a definite pre-dispatch 4xx", async () => {
    const state = stateFor("A");
    state.messageInput = "rejected before dispatch";
    mockGetQueryAbortable.mockRejectedValueOnce({
      response: { status: 422, data: { pre_dispatch: true } },
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(vi.fn());

    try {
      await makeComposable().sendMessage();
    } finally {
      errorSpy.mockRestore();
    }

    expect(state.pendingTurnId).toBeNull();
    expect(state.pendingTurnFingerprint).toBeNull();
  });

  it("clears the pending local draft when stream reports pre-dispatch 4xx", async () => {
    currentChatId.value = "new_limit";
    states.set(
      "new_limit",
      makeState({ messageInput: "这个文章讲了什么内容?" })
    );
    streamHarness.streamMessage.mockResolvedValueOnce({
      preDispatch4xx: true,
    });
    await makeComposable({ streamTools: ["ChatAgent"] }).sendMessage();
    expect(mockClearPendingChat).toHaveBeenCalledWith("new_limit");
    expect(stateFor("new_limit").pendingTurnId).toBeNull();
  });

  it("two existing dialogues start in the same millisecond with unique keys and distinct parent row ids", async () => {
    stateFor("A").messageInput = "from-A";
    stateFor("B").messageInput = "from-B";

    const pendingA = deferred<ApiEnvelope<DecodedQueryData>>();
    const pendingB = deferred<ApiEnvelope<DecodedQueryData>>();

    mockGetQueryAbortable
      .mockReturnValueOnce(pendingA.promise)
      .mockReturnValueOnce(pendingB.promise);

    const { sendMessage } = makeComposable();
    const sendA = sendMessage();
    await Promise.resolve();
    await Promise.resolve();

    currentChatId.value = "B";
    currentChat.value = { messages: [] };
    const sendB = sendMessage();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockGetQueryAbortable).toHaveBeenCalledTimes(2);
    const [formA, keyA] = queryCallAt(0, "dialogue A query call");
    const [formB, keyB] = queryCallAt(1, "dialogue B query call");
    expect((formA as FormData).get("id")).toBe("1");
    expect((formB as FormData).get("id")).toBe("2");
    expect((formA as FormData).get("client_turn_id")).not.toBe(
      (formB as FormData).get("client_turn_id")
    );
    expect(keyA).not.toBe(keyB);
    expect(String(keyA).startsWith("chat-request-")).toBe(true);
    expect(String(keyB).startsWith("chat-request-")).toBe(true);
    expect(getChatState("A").isSending).toBe(true);
    expect(getChatState("B").isSending).toBe(true);

    pendingA.resolve(
      invalidInput<ApiEnvelope<DecodedQueryData>>({
        data: {
          tool_name: "ChatAgent",
          answer: "answer-A",
          id: "ma",
          follow_up_questions: [],
        },
      })
    );
    await sendA;
    expect(getChatState("A").isSending).toBe(false);
    expect(getChatState("B").isSending).toBe(true);

    pendingB.resolve(
      invalidInput<ApiEnvelope<DecodedQueryData>>({
        data: {
          tool_name: "ChatAgent",
          answer: "answer-B",
          id: "mb",
          follow_up_questions: [],
        },
      })
    );
    await sendB;
    expect(getChatState("B").isSending).toBe(false);
    expect(
      lastMessageFor(getChatState("A"), "dialogue A response").content
    ).toBe("answer-A");
    expect(
      lastMessageFor(getChatState("B"), "dialogue B response").content
    ).toBe("answer-B");
  });

  it("A→B switch during pre-request await still uses A's parent row/message/file/mode snapshot", async () => {
    stateFor("A").messageInput = "payload-A";
    stateFor("A").mode = "expert";
    stateFor("A").historyQuestion = [
      { role: "user", content: "captured-history-A" },
    ];
    stateFor("A").fileList = [completedUpload("a.txt", "file_a")];

    let resolveScroll: (() => void) | undefined;
    scrollToBottom.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveScroll = resolve;
        })
    );

    mockGetQueryAbortable.mockResolvedValueOnce(
      invalidInput<ApiEnvelope<DecodedQueryData>>({
        data: {
          tool_name: "ChatAgent",
          answer: "ok",
          id: "m1",
          bot_run_id: "run-captured-mode",
          follow_up_questions: [],
        },
      })
    );

    const { sendMessage } = makeComposable();
    const sendPromise = sendMessage();
    await Promise.resolve();

    // Switch to B before FormData is built
    currentChatId.value = "B";
    currentChat.value = { messages: [] };
    stateFor("B").messageInput = "should-not-send";
    stateFor("B").mode = "instant";
    stateFor("B").fileList = [];

    const resolveScrollNow = mustGet(resolveScroll, "scroll completion");
    resolveScrollNow();
    await sendPromise;

    const [formDataArg] = queryCallAt(0, "captured mode query call");
    const formData = formDataArg as FormData;
    expect(formData.get("id")).toBe("1");
    expect(formData.get("mode")).toBe("expert");
    expect(formData.get("tool")).toBe("");
    expect(formData.get("query")).toContain("payload-A");
    expect(formData.get("history")).toBe(
      JSON.stringify([{ role: "user", content: "captured-history-A" }])
    );
    expect(formData.get("attachments")).toBe(
      JSON.stringify([{ asset_id: "file_a" }])
    );
    expect(getChatState("B").renderedChat?.messages ?? []).toHaveLength(0);
  });

  it("sends completed asset references without a Chat upload progress callback", async () => {
    stateFor("A").messageInput = "Upload this";
    stateFor("A").fileList = [completedUpload()];

    let capturedRequestId = "";
    const pending = deferred<ApiEnvelope<DecodedQueryData>>();
    mockGetQueryAbortable.mockImplementationOnce((_data, requestId, opts) => {
      capturedRequestId = requestId || "";
      expect(opts).toBeUndefined();
      return pending.promise;
    });

    const { sendMessage } = makeComposable();
    const sendPromise = sendMessage();

    await Promise.resolve();
    await Promise.resolve();

    expect(capturedRequestId.startsWith("chat-request-")).toBe(true);
    expect(getChatState("A").uploadTransfer).toBeNull();
    expect(getChatState("A").activeRequestId).toBe(capturedRequestId);

    pending.resolve(
      invalidInput<ApiEnvelope<DecodedQueryData>>({
        data: {
          tool_name: "ChatAgent",
          answer: "Uploaded",
          id: "msg-upload",
          follow_up_questions: [],
        },
      })
    );
    await sendPromise;

    expect(getChatState("A").uploadTransfer).toBeNull();
    expect(getChatState("A").activeRequestId).toBe("");
  });

  it("keeps plain user text and literal attachment markers out of the wire query", async () => {
    stateFor("A").messageInput =
      "Keep this literal [Attachment: user-note.txt (1 KB)]";
    stateFor("A").fileList = [completedUpload("reads.fastq", "file_reads")];
    mockGetQueryAbortable.mockResolvedValueOnce(
      invalidInput<ApiEnvelope<DecodedQueryData>>({
        data: { tool_name: "ChatAgent", answer: "ok", id: "plain-1" },
      })
    );

    await makeComposable().sendMessage();

    const formData = queryCallAt(
      0,
      "plain text attachment query"
    )[0] as FormData;
    expect(formData.get("query")).toBe(
      "Keep this literal [Attachment: user-note.txt (1 KB)]"
    );
    expect(formData.get("attachments")).toBe(
      JSON.stringify([{ asset_id: "file_reads" }])
    );
    expect(formData.getAll("files")).toEqual([]);
    expect(
      messagesFor(stateFor("A"), "plain text attachment message")[0]
    ).toMatchObject({
      content: "Keep this literal [Attachment: user-note.txt (1 KB)]",
      attachments: [
        {
          asset_id: "file_reads",
          name: "reads.fastq",
        },
      ],
    });
  });

  it("preserves authored query text and never emits a separate dataset description", async () => {
    stateFor("A").messageInput = "  Analyze the uploaded data\n";
    stateFor("A").fileList = [
      completedUpload("context.pdf", "file_context"),
      completedUpload("counts.csv", "file_counts"),
    ];
    mockGetQueryAbortable.mockResolvedValueOnce(
      invalidInput<ApiEnvelope<DecodedQueryData>>({
        data: { tool_name: "ChatAgent", answer: "ok", id: "dataset-1" },
      })
    );

    await makeComposable().sendMessage();

    const formData = queryCallAt(0, "dataset description query")[0] as FormData;
    expect(formData.get("query")).toBe("  Analyze the uploaded data\n");
    expect(formData.has("dataset_description")).toBe(false);
    expect(formData.get("attachments")).toBe(
      JSON.stringify([
        { asset_id: "file_context" },
        { asset_id: "file_counts" },
      ])
    );
  });

  it.each([
    {
      name: "short query with PDF and dataset assets",
      query: "Compare the synthetic paper and matrix inputs.",
      uploads: [
        ["synthetic-paper.pdf", "file_pdf_fixture_19"],
        ["synthetic-counts.mtx.gz", "file_dataset_fixture_19"],
      ],
      attachments: [
        { asset_id: "file_pdf_fixture_19" },
        { asset_id: "file_dataset_fixture_19" },
      ],
      hasPaths: false,
    },
    {
      name: "query with PDF asset and pasted data block",
      query: [
        "Reproduce the synthetic analysis using the attached paper.",
        "",
        "data:",
        ...SAFE_RESEARCH_PATH_LINES,
      ].join("\n"),
      uploads: [["synthetic-paper.pdf", "file_pdf_fixture_19"]],
      attachments: [{ asset_id: "file_pdf_fixture_19" }],
      hasPaths: true,
    },
    {
      name: "query with pasted paper text and pasted data block",
      query: [
        "Synthetic paper excerpt:",
        "The fixture compares two rice-root sample groups.",
        "",
        "data:",
        ...SAFE_RESEARCH_PATH_LINES,
      ].join("\n"),
      uploads: [],
      attachments: [],
      hasPaths: true,
    },
  ] as const)(
    "sends $name as raw query plus opaque references",
    async (form) => {
      const state = stateFor("A");
      state.messageInput = form.query;
      state.mode = "expert";
      state.selectedAgent = "InSilicoResearchAgent";
      state.fileList = form.uploads.map(([name, assetId]) =>
        completedUpload(name, assetId)
      );
      mockGetQueryAbortable.mockResolvedValueOnce(
        invalidInput<ApiEnvelope<DecodedQueryData>>({
          data: {
            id: "research-form-19",
            tool_name: "InSilicoResearchAgent",
            answer: "",
            status: "RUNNING",
            bot_run_id: "run-research-form-19",
            follow_up_questions: [],
          },
        })
      );

      await makeComposable().sendMessage();

      const formData = queryCallAt(0, form.name)[0] as FormData;
      expect(formData.get("query")).toBe(form.query);
      expect(formData.get("attachments")).toBe(
        JSON.stringify(form.attachments)
      );
      expect([...formData.keys()].sort()).toEqual(
        ["attachments", "client_turn_id", "id", "mode", "query", "tool"].sort()
      );
      expect(formData.has("data_list")).toBe(false);
      expect(formData.has("obs_file_list")).toBe(false);
      expect(formData.has("dataset_description")).toBe(false);
      if (form.hasPaths) {
        expect(String(formData.get("query")).split("\n").slice(-11)).toEqual(
          SAFE_RESEARCH_PATH_LINES
        );
      }
    }
  );

  it("omits a dataset description for document-only submissions", async () => {
    stateFor("A").messageInput = "Summarize the paper";
    stateFor("A").fileList = [completedUpload("paper.pdf", "file_paper")];
    mockGetQueryAbortable.mockResolvedValueOnce(
      invalidInput<ApiEnvelope<DecodedQueryData>>({
        data: { tool_name: "ChatAgent", answer: "ok", id: "document-1" },
      })
    );

    await makeComposable().sendMessage();

    const formData = queryCallAt(0, "document-only query")[0] as FormData;
    expect(formData.has("dataset_description")).toBe(false);
    expect(formData.get("query")).toBe("Summarize the paper");
  });

  it("does not send while an upload is incomplete", async () => {
    stateFor("A").messageInput = "Wait for this upload";
    stateFor("A").fileList = [
      {
        ...completedUpload("queued.fastq", "file_queued"),
        status: "uploading",
      },
    ];

    await makeComposable().sendMessage();

    expect(mockGetQueryAbortable).not.toHaveBeenCalled();
    expect(stateFor("A").messageInput).toBe("Wait for this upload");
  });

  it("stopping a send does not resurrect or mutate the completed upload queue", async () => {
    stateFor("A").messageInput = "Stop after upload";
    stateFor("A").fileList = [completedUpload("stop.fastq", "file_stop")];
    const pending = deferred<ApiEnvelope<DecodedQueryData>>();
    mockGetQueryAbortable.mockReturnValueOnce(pending.promise);

    const sendPromise = makeComposable().sendMessage();
    await Promise.resolve();
    await Promise.resolve();
    stateFor("A").generationStopped = true;
    pending.resolve(
      invalidInput<ApiEnvelope<DecodedQueryData>>({
        data: { tool_name: "ChatAgent", answer: "late", id: "stop-late" },
      })
    );
    await sendPromise;

    const formData = queryCallAt(0, "stopped send query")[0] as FormData;
    expect(formData.getAll("files")).toEqual([]);
    expect(formData.get("attachments")).toBe(
      JSON.stringify([{ asset_id: "file_stop" }])
    );
    expect(stateFor("A").fileList).toEqual([]);
    expect(
      messagesFor(stateFor("A"), "stopped send messages").some(
        (message) => message.id === "stop-late"
      )
    ).toBe(false);
  });

  it("resets a prior generationStopped before sending a later message", async () => {
    stateFor("A").messageInput = "Try again";
    stateFor("A").generationStopped = true;
    mockGetQueryAbortable.mockRejectedValueOnce(new Error("server failed"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(vi.fn());

    const { sendMessage } = makeComposable();
    try {
      await sendMessage();
    } finally {
      consoleError.mockRestore();
    }

    expect(getChatState("A").generationStopped).toBe(false);
    expect(messagesFor(getChatState("A"), "generation reset")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          content: "chat.sendFailed",
        }),
      ])
    );
  });

  it("does not treat an explicit failure envelope with data as success", async () => {
    stateFor("A").messageInput = "Do not accept this response";
    mockGetQueryAbortable.mockResolvedValueOnce(
      invalidInput<ApiEnvelope<DecodedQueryData>>({
        code: 500,
        data: {
          tool_name: "ChatAgent",
          answer: "This must not enter the chat history",
          id: "masked-error-data",
          follow_up_questions: [],
        },
      })
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(vi.fn());

    try {
      const { sendMessage } = makeComposable();
      await sendMessage();
    } finally {
      consoleError.mockRestore();
    }

    const assistants = messagesFor(
      getChatState("A"),
      "explicit failure envelope"
    ).filter((message) => message.role === "assistant");
    const failedAssistant = mustGet(
      assistants.at(-1),
      "explicit failure envelope assistant"
    );
    expect(failedAssistant.content).toBe("chat.sendFailed");
    expect(failedAssistant.content).not.toContain(
      "This must not enter the chat history"
    );
    expect(getChatState("A").isSending).toBe(false);
  });

  it("surfaces only the safe Web request id on a gateway failure", async () => {
    stateFor("A").messageInput = "Trace this failure";
    mockGetQueryAbortable.mockRejectedValueOnce({
      response: {
        status: 502,
        data: {
          request_id: "web-request-502",
          bot_request_id: "bot-private-request",
        },
      },
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(vi.fn());

    try {
      const { sendMessage } = makeComposable();
      await sendMessage();
    } finally {
      consoleError.mockRestore();
    }

    const failedAssistant = lastMessageFor(
      stateFor("A"),
      "gateway request correlation"
    );
    expect(failedAssistant.content).toContain("chat.sendFailed");
    expect(failedAssistant.content).toContain(
      "chat.requestId: web-request-502"
    );
    expect(failedAssistant.content).not.toContain("bot-private-request");
  });

  it("surfaces the gateway 4xx message and request id", async () => {
    stateFor("A").messageInput = "Reproduce the paper";
    mockGetQueryAbortable.mockRejectedValueOnce({
      response: {
        status: 400,
        data: {
          code: 400,
          message: "Research input resolution failed.",
          pre_dispatch: true,
          request_id: "web-request-422",
        },
      },
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(vi.fn());
    try {
      const { sendMessage } = makeComposable();
      await sendMessage();
    } finally {
      consoleError.mockRestore();
    }
    const failedAssistant = lastMessageFor(
      stateFor("A"),
      "pre-dispatch 4xx message"
    );
    expect(failedAssistant.content).toContain(
      "Research input resolution failed."
    );
    expect(failedAssistant.content).toContain(
      "chat.requestId: web-request-422"
    );
    expect(failedAssistant.content).not.toBe("chat.sendFailed");
  });

  it("keeps sendFailed when the 4xx message is unsafe", async () => {
    stateFor("A").messageInput = "Reproduce the paper";
    mockGetQueryAbortable.mockRejectedValueOnce({
      response: {
        status: 400,
        data: {
          message: `x${"a".repeat(600)}`,
          request_id: "web-request-long",
          pre_dispatch: true,
        },
      },
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(vi.fn());
    try {
      const { sendMessage } = makeComposable();
      await sendMessage();
    } finally {
      consoleError.mockRestore();
    }
    expect(lastMessageFor(stateFor("A"), "overlong 4xx").content).toContain(
      "chat.sendFailed"
    );
  });

  it("🔒 capture invariant: switching currentChatId mid-send, cleanup still lands on the captured original dialogue A", async () => {
    stateFor("A").messageInput = "Original dialogue message";

    // A is an existing dialogue (messages non-empty) => isNewChat=false, so finally
    // won't reset currentChatId back to A; that way, after switching to B, if cleanup
    // mis-reads currentChatId.value it would land on B, exposing a broken capture invariant.
    currentChat.value = {
      messages: [{ role: "user", content: "Previous message" }],
    };

    // A manually-controlled promise, simulating a pending request
    const pending = deferred<ApiEnvelope<DecodedQueryData>>();
    mockGetQueryAbortable.mockReturnValueOnce(pending.promise);

    const { sendMessage } = makeComposable();

    // Don't await, let the request hang
    const sendPromise = sendMessage();

    // Wait for the synchronous phase + the microtasks before scrollToBottom to run
    await Promise.resolve();
    await Promise.resolve();

    // At this point the original dialogue A is mid-send
    expect(getChatState("A").isSending).toBe(true);

    // User switches to dialogue B
    currentChatId.value = "B";
    currentChat.value = { messages: [] };

    // The request completes
    pending.resolve(
      invalidInput<ApiEnvelope<DecodedQueryData>>({
        data: {
          tool_name: "ChatAgents",
          answer: "Late answer",
          id: "msg-late",
          reaction_type: "2",
          follow_up_questions: [],
        },
      })
    );
    await sendPromise;

    // Cleanup lands on the captured A: isSending reset, fileList cleared
    expect(getChatState("A").isSending).toBe(false);
    expect(getChatState("A").fileList).toEqual([]);

    // B's isSending is never touched (always false, and never set to true)
    expect(getChatState("B").isSending).toBe(false);

    // reaction is synced to the captured A, not the current B
    expect(getChatState("A").reactions["msg-late"]).toBe(2);
    expect(getChatState("B").reactions["msg-late"]).toBeUndefined();

    // Foreground-only: closeHeader / scroll while on B must not run for A's completion
    const composer = mustGet(composerRef.value, "chat composer");
    expect(composer.closeHeader).not.toHaveBeenCalled();
  });

  it("background A success does not scroll or toast while B is focused", async () => {
    stateFor("A").messageInput = "bg-A";
    const pending = deferred<ApiEnvelope<DecodedQueryData>>();
    mockGetQueryAbortable.mockReturnValueOnce(pending.promise);

    const { sendMessage } = makeComposable();
    const sendPromise = sendMessage();
    await Promise.resolve();
    await Promise.resolve();

    scrollToBottom.mockClear();
    currentChatId.value = "B";
    currentChat.value = { messages: [] };

    pending.resolve(
      invalidInput<ApiEnvelope<DecodedQueryData>>({
        data: {
          tool_name: "ChatAgent",
          answer: "done",
          id: "x",
          follow_up_questions: [],
        },
      })
    );
    await sendPromise;

    expect(scrollToBottom).not.toHaveBeenCalled();
    expect(ElMessage.warning).not.toHaveBeenCalled();
    expect(selectChat).not.toHaveBeenCalled();
  });

  it("stale cleanup cannot clear a newer same-dialogue activeRequestId", async () => {
    stateFor("A").messageInput = "first";
    const pending = deferred<ApiEnvelope<DecodedQueryData>>();
    mockGetQueryAbortable.mockReturnValueOnce(pending.promise);

    const { sendMessage } = makeComposable();
    const first = sendMessage();
    await Promise.resolve();
    await Promise.resolve();
    const firstKey = getChatState("A").activeRequestId;
    expect(firstKey.startsWith("chat-request-")).toBe(true);

    // Defense in depth: even if an impossible caller swaps the key, the stale
    // response/finally must not reconcile or clear that newer lifecycle.
    getChatState("A").isSending = false;
    getChatState("A").messageInput = "second";
    getChatState("A").activeRequestId = "chat-request-newer";
    getHistoryQuestionData.mockClear();

    pending.resolve(
      invalidInput<ApiEnvelope<DecodedQueryData>>({
        data: {
          tool_name: "ChatAgent",
          answer: "old",
          id: "old",
          dialogue_id: "stale-dialogue-id",
          follow_up_questions: [],
        },
      })
    );
    await first;

    expect(getChatState("A").activeRequestId).toBe("chat-request-newer");
    expect(getHistoryQuestionData).not.toHaveBeenCalled();
  });

  it("empty input guard: returns early when messageInput is empty, does not call getQueryAbortable", async () => {
    stateFor("A").messageInput = "";

    const { sendMessage } = makeComposable();
    await sendMessage();

    expect(mockGetQueryAbortable).not.toHaveBeenCalled();
    expect(mustGet(currentChat.value, "current chat").messages.length).toBe(0);
    expect(getChatState("A").isSending).toBe(false);
  });

  it("hard no-send when existing dialogue parent mapping is missing", async () => {
    currentChatId.value = "missing-dlg";
    states.set("missing-dlg", makeState({ messageInput: "nope" }));
    currentChat.value = { messages: [] };

    const { sendMessage } = makeComposable();
    await sendMessage();

    expect(mockGetQueryAbortable).not.toHaveBeenCalled();
    const msgs = messagesFor(getChatState("missing-dlg"), "missing parent");
    const failedMessage = mustGet(
      msgs.at(-1),
      "missing-parent failure message"
    );
    expect(failedMessage).toMatchObject({
      role: "assistant",
      content: "chat.sendFailed",
    });
    expect(failedMessage).not.toHaveProperty("id");
    expect(getChatState("missing-dlg").isSending).toBe(false);
  });

  it("blocking new chat passes exact dialogue_id to getHistoryQuestionData, never chatList[0]", async () => {
    const tempId = "new_999";
    currentChatId.value = tempId;
    currentChat.value = { messages: [] };
    states.set(tempId, makeState({ messageInput: "First message" }));

    mockGetQueryAbortable.mockResolvedValueOnce(
      invalidInput<ApiEnvelope<DecodedQueryData>>({
        data: {
          tool_name: "ChatAgent",
          answer: "ok",
          dialogue_id: "server-exact-id",
          id: "msg-1",
          follow_up_questions: [],
        },
      })
    );

    getHistoryQuestionData.mockResolvedValueOnce({
      status: "reconciled",
      tempId,
      serverId: "server-exact-id",
      rekey: { outcome: "moved" },
    });

    const { sendMessage } = makeComposable();
    await sendMessage();

    expect(getHistoryQuestionData).toHaveBeenCalledWith(tempId, {
      blockingDialogueId: "server-exact-id",
    });
    expect(stateFor(tempId).historyHydration).toBe("ready");
    expect(mockClearPendingChat).not.toHaveBeenCalled();
    expect(currentChatId.value).toBe(tempId);
    const [formDataArg] = queryCallAt(0, "new-chat query call");
    const formData = formDataArg as FormData;
    expect(formData.get("id")).toBe("0");
  });

  it("success without dialogue_id does not bind a pending chat to chatList[0] by title", async () => {
    currentChatId.value = "new_888";
    currentChat.value = { messages: [] };
    states.set("new_888", makeState({ messageInput: "hello" }));
    chatList.value = [
      {
        id: 99,
        dialogue_id: "wrong-first",
        title: "hello",
        date: "",
        isFavorite: false,
      },
    ];

    mockGetQueryAbortable.mockResolvedValueOnce(
      invalidInput<ApiEnvelope<DecodedQueryData>>({
        data: {
          tool_name: "ChatAgent",
          answer: "ok",
          id: "m1",
          follow_up_questions: [],
        },
      })
    );
    getHistoryQuestionData.mockResolvedValueOnce({
      status: "retained",
      tempId: "new_888",
      reason: "no-match",
    });

    const { sendMessage } = makeComposable();
    await sendMessage();

    expect(mockClearPendingChat).not.toHaveBeenCalled();
    expect(currentChatId.value).toBe("new_888");
    expect(mockWritePendingChat).toHaveBeenCalled();
    const lastWrite = mockWritePendingChat.mock.calls.at(-1);
    expect(lastWrite?.[0]).toBe("new_888");
    expect(lastWrite?.[1]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "user", content: "hello" }),
        expect.objectContaining({ role: "assistant", content: "ok" }),
      ])
    );
  });

  it.each([409, 500])(
    "HTTP %i retains a new pending chat even when old history has the same title",
    async (status) => {
      const tempId = `new_http_${status}`;
      currentChatId.value = tempId;
      currentChat.value = { messages: [] };
      states.set(tempId, makeState({ messageInput: "repeated question" }));
      chatList.value = [
        {
          id: 70,
          dialogue_id: "old-same-title",
          title: "repeated question",
          date: "",
          isFavorite: false,
        },
      ];
      mockGetQueryAbortable.mockRejectedValueOnce({
        response: { status, data: { request_id: `web-${status}` } },
      });
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(vi.fn());

      try {
        const { sendMessage } = makeComposable();
        await sendMessage();
      } finally {
        consoleError.mockRestore();
      }

      expect(getHistoryQuestionData).toHaveBeenCalledWith(tempId, undefined);
      expect(mockClearPendingChat).not.toHaveBeenCalled();
      expect(currentChatId.value).toBe(tempId);
      expect(chatList.value.map((chat) => chat.dialogue_id)).toContain(tempId);
      expect(lastMessageFor(stateFor(tempId), `HTTP ${status}`)).toMatchObject({
        role: "assistant",
        content: expect.stringContaining("chat.sendFailed"),
      });
    }
  );

  it("abort retains the temporary chat without adding a failure assistant", async () => {
    const tempId = "new_aborted";
    currentChatId.value = tempId;
    currentChat.value = { messages: [] };
    states.set(tempId, makeState({ messageInput: "cancel me" }));
    mockGetQueryAbortable.mockRejectedValueOnce({ code: "ERR_CANCELED" });
    const consoleError = vi.spyOn(console, "error").mockImplementation(vi.fn());

    try {
      const { sendMessage } = makeComposable();
      await sendMessage();
    } finally {
      consoleError.mockRestore();
    }

    expect(getHistoryQuestionData).toHaveBeenCalledWith(tempId, undefined);
    expect(mockClearPendingChat).not.toHaveBeenCalled();
    expect(currentChatId.value).toBe(tempId);
    expect(
      messagesFor(stateFor(tempId), "aborted pending").filter(
        (message) => message.role === "assistant"
      )
    ).toEqual([]);
  });

  it("late finally cleanup uses captured state object and cannot resurrect the old temp key", async () => {
    const chatStatesApi = useChatStates();
    const tempId = "new_777";
    const serverId = "srv-late";
    chatStatesApi.currentChatId.value = tempId;
    currentChatId = chatStatesApi.currentChatId;
    const state = chatStatesApi.getChatState(tempId);
    state.mode = "instant";
    state.messageInput = "late send";
    currentChat.value = { messages: [] };

    getChatState = (dialogueId: string) =>
      chatStatesApi.getChatState(dialogueId);

    mockGetQueryAbortable.mockResolvedValueOnce(
      invalidInput<ApiEnvelope<DecodedQueryData>>({
        data: {
          tool_name: "ChatAgent",
          answer: "done",
          dialogue_id: serverId,
          id: "m-late",
          follow_up_questions: [],
        },
      })
    );

    getHistoryQuestionData.mockImplementation(async (sendingId, opts) => {
      const sendingIdValue = mustGet(sendingId, "reconciliation dialogue id");
      const blockingDialogueId = mustGet(
        opts?.blockingDialogueId,
        "reconciliation server dialogue id"
      );
      if (opts?.blockingDialogueId) {
        chatStatesApi.rekeyChatState(sendingIdValue, opts.blockingDialogueId);
      }
      return {
        status: "reconciled",
        tempId: sendingIdValue,
        serverId: blockingDialogueId,
        rekey: { outcome: "moved" },
      };
    });

    const { sendMessage } = makeComposable();
    await sendMessage();

    expect(chatStatesApi.chatStates.value[tempId]).toBeUndefined();
    expect(chatStatesApi.chatStates.value[serverId]).toBe(state);
    expect(state.isSending).toBe(false);
    expect(Object.keys(chatStatesApi.chatStates.value)).not.toContain(tempId);
  });

  it("upload progress writes to captured state without getChatState(tempId) after rekey", async () => {
    const chatStatesApi = useChatStates();
    const tempId = "new_666";
    const serverId = "srv-upload";
    chatStatesApi.currentChatId.value = tempId;
    currentChatId = chatStatesApi.currentChatId;
    const state = chatStatesApi.getChatState(tempId);
    state.messageInput = "upload";
    state.fileList = [completedUpload("f.txt", "file_f")];
    currentChat.value = { messages: [] };
    getChatState = (id: string) => chatStatesApi.getChatState(id);

    const pending = deferred<ApiEnvelope<DecodedQueryData>>();
    mockGetQueryAbortable.mockImplementationOnce((_d, _r, opts) => {
      expect(opts).toBeUndefined();
      chatStatesApi.rekeyChatState(tempId, serverId);
      return pending.promise;
    });

    const { sendMessage } = makeComposable();
    const sendPromise = sendMessage();
    await Promise.resolve();
    await Promise.resolve();

    expect(state.uploadTransfer).toBeNull();
    expect(chatStatesApi.chatStates.value[tempId]).toBeUndefined();

    pending.resolve(
      invalidInput<ApiEnvelope<DecodedQueryData>>({
        data: {
          tool_name: "ChatAgent",
          answer: "ok",
          dialogue_id: serverId,
          id: "u1",
          follow_up_questions: [],
        },
      })
    );
    getHistoryQuestionData.mockResolvedValueOnce({
      status: "reconciled",
      tempId,
      serverId,
      rekey: { outcome: "same-id" },
    });
    await sendPromise;

    expect(state.uploadTransfer).toBeNull();
    expect(chatStatesApi.chatStates.value[tempId]).toBeUndefined();
  });

  it("stream path binds getChatState to captured state so post-rekey temp lookup cannot resurrect", async () => {
    vi.stubEnv("VITE_STREAM_ENABLED", "true");
    const chatStatesApi = useChatStates();
    const tempId = "new_stream";
    const serverId = "srv-stream";
    chatStatesApi.currentChatId.value = tempId;
    currentChatId = chatStatesApi.currentChatId;
    const state = chatStatesApi.getChatState(tempId);
    state.messageInput = "stream msg";
    state.activeAgentName = "ChatAgent";
    state.mode = "instant";
    currentChat.value = { messages: [] };
    getChatState = (id: string) => chatStatesApi.getChatState(id);

    streamHarness.streamMessage.mockImplementationOnce(async () => {
      chatStatesApi.rekeyChatState(tempId, serverId);
      const getCapturedChatState = mustGet(
        streamHarness.capturedGetChatState,
        "captured stream chat-state accessor"
      );
      const viaWrapper = getCapturedChatState(tempId);
      expect(viaWrapper).toBe(state);
      expect(chatStatesApi.chatStates.value[tempId]).toBeUndefined();
      return {};
    });

    const { sendMessage } = makeComposable();
    await sendMessage();

    expect(streamHarness.capturedGetChatState).toBeDefined();
    expect(streamHarness.streamMessage).toHaveBeenCalledTimes(1);
    expect(chatStatesApi.chatStates.value[tempId]).toBeUndefined();
    expect(state.isSending).toBe(false);
  });

  it("passes the stream response dialogue id to exact history reconciliation", async () => {
    vi.stubEnv("VITE_STREAM_ENABLED", "true");
    const tempId = "new_stream_headers";
    const state = makeState({ messageInput: "stream with canonical identity" });
    states.set(tempId, state);
    currentChatId.value = tempId;
    currentChat.value = { messages: [] };
    streamHarness.streamMessage.mockResolvedValueOnce({
      dialogueId: "canonical-stream-dialogue",
      messageId: "77",
    });

    const { sendMessage } = makeComposable();
    await sendMessage();

    expect(getHistoryQuestionData).toHaveBeenCalledWith(tempId, {
      blockingDialogueId: "canonical-stream-dialogue",
    });
  });

  it("rekeys stream identity before an independent failing sidebar refresh", async () => {
    vi.stubEnv("VITE_STREAM_ENABLED", "true");
    const chatStatesApi = useChatStates();
    const tempId = "new_stream_identity";
    const serverId = "canonical-stream-dialogue";
    chatStatesApi.currentChatId.value = tempId;
    currentChatId = chatStatesApi.currentChatId;
    const state = chatStatesApi.getChatState(tempId);
    state.messageInput = "stream identity rekey";
    state.mode = "instant";
    currentChat.value = { messages: [] };
    getChatState = (dialogueId: string) =>
      chatStatesApi.getChatState(dialogueId);
    window.history.replaceState({}, "", "/chat");

    const sidebarRefresh = deferred<DialogueReconciliationResult | undefined>();
    getHistoryQuestionData.mockReturnValueOnce(sidebarRefresh.promise);
    reconcileDialogueIdentity.mockImplementationOnce((fromId, toId) => {
      const rekey = chatStatesApi.rekeyChatState(fromId, toId);
      if (currentChatId.value === fromId) {
        currentChatId.value = toId;
        const url = new URL(window.location.href);
        url.searchParams.set("dialogue_id", toId);
        window.history.pushState({}, "", url.toString());
      }
      return {
        status: "reconciled",
        tempId: fromId,
        serverId: toId,
        rekey,
      };
    });

    streamHarness.streamMessage.mockImplementationOnce(async (input) => {
      input.onIdentity?.({
        dialogueId: serverId,
        messageId: "42",
      });

      expect(currentChatId.value).toBe(serverId);
      expect(
        new URL(window.location.href).searchParams.get("dialogue_id")
      ).toBe(serverId);
      expect(chatStatesApi.chatStates.value[tempId]).toBeUndefined();
      expect(chatStatesApi.chatStates.value[serverId]).toBe(state);
      expect(
        chatStatesApi.chatStates.value[serverId]?.renderedChat?.messages.at(-1)
      ).toBe(input.placeholder);
      expect(
        mustGet(
          streamHarness.capturedGetChatState,
          "stream chat-state accessor"
        )(serverId)
      ).toBe(state);
      expect(getHistoryQuestionData).not.toHaveBeenCalled();
      return {
        dialogueId: serverId,
        messageId: "42",
        completed: true,
      };
    });

    await expect(makeComposable().sendMessage()).resolves.toBeUndefined();

    expect(reconcileDialogueIdentity).toHaveBeenCalledWith(tempId, serverId);
    expect(getHistoryQuestionData).toHaveBeenCalledTimes(1);
    expect(getHistoryQuestionData.mock.calls).toEqual([[]]);

    sidebarRefresh.reject(new Error("sidebar unavailable"));
    await Promise.resolve();
    await Promise.resolve();
  });

  it("stamps streaming placeholder streamPresentationKey with the request id (not message.id)", async () => {
    vi.stubEnv("VITE_STREAM_ENABLED", "true");
    stateFor("A").messageInput = "stream stamp";
    stateFor("A").activeAgentName = "ChatAgent";
    stateFor("A").mode = "instant";

    let capturedPlaceholder: ChatMessage | undefined;
    let capturedRequestId = "";
    streamHarness.streamMessage.mockImplementationOnce(
      async (input: StreamInput) => {
        capturedPlaceholder = input.placeholder;
        capturedRequestId = input.requestId;
        // Simulate stream finally clearing dialogue streaming fields.
        const st = getChatState("A");
        st.streamingMessageId = null;
        st.isStreaming = false;
        input.placeholder.streaming = false;
        return {};
      }
    );

    const { sendMessage } = makeComposable();
    await sendMessage();

    expect(capturedRequestId).toMatch(/^chat-request-/);
    const placeholder = mustGet(capturedPlaceholder, "stream placeholder");
    expect(placeholder.streamPresentationKey).toBe(capturedRequestId);
    expect(placeholder.id).toBeUndefined();
    // Survives stream cleanup on the placeholder object.
    expect(placeholder.streamPresentationKey).toBe(capturedRequestId);
    // Not written into FormData / reactions / artifact identity surfaces.
    expect(streamHarness.streamMessage).toHaveBeenCalledTimes(1);
    const streamCall = mustGet(
      streamHarness.streamMessage.mock.calls[0],
      "stream message call"
    );
    const call = streamCall[0];
    const fd = call.formData as FormData;
    expect(fd.get("streamPresentationKey")).toBeNull();
    expect(fd.has("stream_presentation_key")).toBe(false);
    expect(fd.get("client_turn_id")).toMatch(/^turn-[A-Za-z0-9-]{16,64}$/);
    const assistant = mustGet(
      messagesFor(getChatState("A"), "stream response").find(
        (m: ChatMessage) => m.role === "assistant"
      ),
      "stream assistant message"
    );
    expect(assistant.streamPresentationKey).toBe(capturedRequestId);
    expect(assistant.id).toBeUndefined();
  });

  it.each(["KnowledgeAgent", "BriefGeneAgent"] as const)(
    "keeps the captured %s identity on its streaming placeholder",
    async (toolName) => {
      vi.stubEnv("VITE_STREAM_ENABLED", "true");
      const state = stateFor("A");
      state.messageInput = `stream ${toolName}`;
      state.mode = "expert";
      state.selectedAgent = toolName;

      let capturedPlaceholder: ChatMessage | undefined;
      streamHarness.streamMessage.mockImplementationOnce(
        async ({ placeholder }) => {
          capturedPlaceholder = placeholder;
          placeholder.streaming = false;
          return {};
        }
      );

      await makeComposable({ streamTools: [toolName] }).sendMessage();

      expect(capturedPlaceholder).toMatchObject({
        role: "assistant",
        streaming: false,
        tool_name: toolName,
      });
    }
  );

  it("isolates concurrent Knowledge and BriefGene stream identities by dialogue", async () => {
    const pendingA = deferred<StreamResult>();
    const pendingB = deferred<StreamResult>();
    const placeholders = new Map<string, ChatMessage>();
    streamHarness.streamMessage.mockImplementation(
      async ({ dialogueId, placeholder }) => {
        placeholders.set(dialogueId, placeholder);
        return dialogueId === "A" ? pendingA.promise : pendingB.promise;
      }
    );
    vi.stubEnv("VITE_STREAM_ENABLED", "true");

    const stateA = stateFor("A");
    stateA.mode = "expert";
    stateA.selectedAgent = "KnowledgeAgent";
    stateA.messageInput = "knowledge stream";
    const composable = makeComposable({
      streamTools: ["KnowledgeAgent", "BriefGeneAgent"],
    });
    const sentA = composable.sendMessage();
    await vi.waitFor(() => expect(placeholders.has("A")).toBe(true));

    currentChatId.value = "B";
    const stateB = stateFor("B");
    stateB.mode = "expert";
    stateB.selectedAgent = "BriefGeneAgent";
    stateB.messageInput = "brief gene stream";
    const sentB = composable.sendMessage();
    await vi.waitFor(() => expect(placeholders.has("B")).toBe(true));

    expect(placeholders.get("A")?.tool_name).toBe("KnowledgeAgent");
    expect(placeholders.get("B")?.tool_name).toBe("BriefGeneAgent");
    expect(stateA.activeAgentName).toBe("KnowledgeAgent");
    expect(stateB.activeAgentName).toBe("BriefGeneAgent");

    pendingA.resolve({});
    pendingB.resolve({});
    await Promise.all([sentA, sentB]);
  });

  it("keeps a streamed answer when context staging degrades", async () => {
    vi.stubEnv("VITE_STREAM_ENABLED", "true");
    const state = stateFor("A");
    state.messageInput = "stream with context";
    state.activeAgentName = "ChatAgent";
    state.mode = "instant";
    streamHarness.streamMessage.mockImplementationOnce(
      async ({ placeholder }) => {
        placeholder.content = "Streamed answer survives.";
        placeholder.status = "SUCCEEDED";
        placeholder.streaming = false;
        return {
          completed: true,
          messageId: "stream-message-1",
          contextNotice: { context_degraded: true },
        };
      }
    );

    const { sendMessage } = makeComposable();
    await sendMessage();

    const assistant = lastMessageFor(state, "degraded stream response");
    expect(assistant.content).toBe("Streamed answer survives.");
    expect(ElMessage.warning).toHaveBeenCalledWith("chat.contextDegraded");
  });

  it("Stop then late 200 does not append a second assistant row; peer dialogue stays sending", async () => {
    stateFor("A").messageInput = "from-A";
    stateFor("B").messageInput = "from-B";

    const pendingA = deferred<ApiEnvelope<DecodedQueryData>>();
    const pendingB = deferred<ApiEnvelope<DecodedQueryData>>();
    mockGetQueryAbortable
      .mockReturnValueOnce(pendingA.promise)
      .mockReturnValueOnce(pendingB.promise);

    const { sendMessage } = makeComposable();
    const sendA = sendMessage();
    await Promise.resolve();
    await Promise.resolve();
    const keyA = getChatState("A").activeRequestId;

    currentChatId.value = "B";
    currentChat.value = { messages: [] };
    const sendB = sendMessage();
    await Promise.resolve();
    await Promise.resolve();
    const keyB = getChatState("B").activeRequestId;
    expect(keyA).not.toBe(keyB);
    expect(getChatState("B").isSending).toBe(true);

    // Mirror abortDialogueRequest on A only: ID-less local stopped row, while
    // isSending + activeRequestId remain owned until A's finally settles.
    const stateA = getChatState("A");
    stateA.generationStopped = true;
    messagesFor(stateA, "stopped dialogue").push({
      role: "assistant",
      content: "chat.generationStopped",
      instantMessage: true,
    });
    const stopped = lastMessageFor(stateA, "stopped dialogue");
    expect(stopped).not.toHaveProperty("id");
    expect(stateA.isSending).toBe(true);

    expect(getChatState("B").isSending).toBe(true);
    expect(getChatState("B").activeRequestId).toBe(keyB);

    pendingA.resolve(
      invalidInput<ApiEnvelope<DecodedQueryData>>({
        data: {
          tool_name: "ChatAgent",
          answer: "late-answer-must-not-land",
          id: "late-a",
          follow_up_questions: [],
        },
      })
    );
    await sendA;

    const msgsA = messagesFor(getChatState("A"), "stopped dialogue result");
    expect(msgsA.filter((m) => m.role === "assistant")).toHaveLength(1);
    expect(
      lastMessageFor(getChatState("A"), "stopped dialogue result").content
    ).toBe("chat.generationStopped");
    expect(msgsA.some((m) => m.content === "late-answer-must-not-land")).toBe(
      false
    );

    expect(getChatState("B").isSending).toBe(true);
    expect(getChatState("B").activeRequestId).toBe(keyB);

    pendingB.resolve(
      invalidInput<ApiEnvelope<DecodedQueryData>>({
        data: {
          tool_name: "ChatAgent",
          answer: "answer-B",
          id: "mb",
          follow_up_questions: [],
        },
      })
    );
    await sendB;
    expect(getChatState("B").isSending).toBe(false);
    expect(
      lastMessageFor(getChatState("B"), "peer dialogue result").content
    ).toBe("answer-B");
  });

  it("new chat Stop then immediate resend waits for reconciliation and preserves the draft", async () => {
    const tempId = "new_stop_serial";
    currentChatId.value = tempId;
    currentChat.value = { messages: [] };
    const state = makeState({ messageInput: "first" });
    states.set(tempId, state);
    chatList.value = [];

    const pendingFirst = deferred<ApiEnvelope<DecodedQueryData>>();
    mockGetQueryAbortable.mockReturnValueOnce(pendingFirst.promise);

    const { sendMessage } = makeComposable();
    const first = sendMessage();
    await Promise.resolve();
    await Promise.resolve();
    const firstKey = state.activeRequestId;
    const [firstFormArg] = queryCallAt(0, "new-chat stop query call");
    expect((firstFormArg as FormData).get("id")).toBe("0");

    // Mirror a successful Stop. The request remains the lifecycle owner until
    // its authoritative dialogue identity has been reconciled.
    state.generationStopped = true;
    messagesFor(state, "new chat stop").push({
      role: "assistant",
      content: "chat.generationStopped",
      instantMessage: true,
    });
    state.messageInput = "second draft";

    await sendMessage();

    expect(mockGetQueryAbortable).toHaveBeenCalledTimes(1);
    expect(state.activeRequestId).toBe(firstKey);
    expect(state.isSending).toBe(true);
    expect(state.messageInput).toBe("second draft");

    pendingFirst.resolve(
      invalidInput<ApiEnvelope<DecodedQueryData>>({
        data: {
          tool_name: "ChatAgent",
          answer: "stale-answer-1",
          id: "11",
          dialogue_id: "server-stop-dialogue",
          follow_up_questions: [],
        },
      })
    );
    await first;

    expect(getHistoryQuestionData).toHaveBeenCalledWith(tempId, {
      blockingDialogueId: "server-stop-dialogue",
    });
    expect(state.activeRequestId).toBe("");
    expect(state.isSending).toBe(false);
    expect(state.messageInput).toBe("second draft");
    expect(
      messagesFor(state, "new chat stop result").some(
        (m) => m.content === "stale-answer-1"
      )
    ).toBe(false);

    // Mirror the coordinator's successful temp -> server rekey/history list.
    states.delete(tempId);
    states.set("server-stop-dialogue", state);
    currentChatId.value = "server-stop-dialogue";
    currentChat.value = state.renderedChat;
    chatList.value = [
      {
        id: 11,
        dialogue_id: "server-stop-dialogue",
        title: "first",
        date: "",
        isFavorite: false,
      },
    ];
    mockGetQueryAbortable.mockResolvedValueOnce(
      invalidInput<ApiEnvelope<DecodedQueryData>>({
        data: {
          tool_name: "ChatAgent",
          answer: "answer-2",
          id: "m2",
          follow_up_questions: [],
        },
      })
    );

    await sendMessage();

    expect(mockGetQueryAbortable).toHaveBeenCalledTimes(2);
    const [resendFormArg] = queryCallAt(1, "new-chat resend query call");
    expect((resendFormArg as FormData).get("id")).toBe("11");
    expect(lastMessageFor(state, "resend result").content).toBe("answer-2");
  });

  it("background session-expired does not open ElMessageBox", async () => {
    const { ElMessageBox } = await import("element-plus");
    stateFor("A").messageInput = "auth-fail";
    const pending = deferred<ApiEnvelope<DecodedQueryData>>();
    mockGetQueryAbortable.mockReturnValueOnce(pending.promise);
    const consoleError = vi.spyOn(console, "error").mockImplementation(vi.fn());

    const { sendMessage } = makeComposable();
    const sendPromise = sendMessage();
    await Promise.resolve();
    await Promise.resolve();

    currentChatId.value = "B";
    currentChat.value = { messages: [] };
    pending.reject({
      response: { data: { detail: { code: 403 } } },
    });
    try {
      await sendPromise;
    } finally {
      consoleError.mockRestore();
    }

    expect(ElMessageBox.alert).not.toHaveBeenCalled();
  });

  it("background network-error recovery does not refresh history for a new chat", async () => {
    const { isNetworkError } = await import("@/utils/network-error");
    vi.mocked(isNetworkError).mockReturnValue(true);
    vi.useFakeTimers();

    const tempId = "new_bg_net";
    currentChatId.value = tempId;
    currentChat.value = { messages: [] };
    states.set(tempId, makeState({ messageInput: "offline" }));

    mockGetQueryAbortable.mockRejectedValueOnce(new Error("Network Error"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(vi.fn());

    const { sendMessage } = makeComposable();
    const sendPromise = sendMessage();
    await Promise.resolve();
    await Promise.resolve();

    currentChatId.value = "B";
    currentChat.value = { messages: [] };
    getHistoryQuestionData.mockClear();

    try {
      const settled = sendPromise;
      await vi.advanceTimersByTimeAsync(1000);
      await settled;
    } finally {
      consoleError.mockRestore();
      vi.mocked(isNetworkError).mockReturnValue(false);
      vi.useRealTimers();
    }

    // Recovery used a single-arg refresh; finally always uses (id, opts).
    const recoveryCalls = getHistoryQuestionData.mock.calls.filter(
      (c) => c.length === 1 && c[0] === tempId
    );
    expect(recoveryCalls).toHaveLength(0);
    expect(getHistoryQuestionData).toHaveBeenCalledWith(tempId, undefined);
  });

  it("does not guess a new-chat identity from history after a foreground network error", async () => {
    const { isNetworkError } = await import("@/utils/network-error");
    vi.mocked(isNetworkError).mockReturnValue(true);
    vi.useFakeTimers();

    const tempId = "new_fg_net";
    currentChatId.value = tempId;
    currentChat.value = { messages: [] };
    states.set(tempId, makeState({ messageInput: "repeated question" }));
    chatList.value = [
      {
        id: 44,
        dialogue_id: "old-same-title",
        title: "repeated question",
        date: "",
        isFavorite: false,
      },
    ];
    mockGetQueryAbortable.mockRejectedValueOnce(new Error("Network Error"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(vi.fn());

    const { sendMessage } = makeComposable();
    const sendPromise = sendMessage();
    await Promise.resolve();
    await Promise.resolve();

    try {
      await vi.advanceTimersByTimeAsync(1000);
      await sendPromise;
    } finally {
      consoleError.mockRestore();
      vi.mocked(isNetworkError).mockReturnValue(false);
      vi.useRealTimers();
    }

    expect(mockGetAnswerCheck).not.toHaveBeenCalled();
    expect(getHistoryQuestionData.mock.calls).toEqual([[tempId, undefined]]);
    expect(currentChatId.value).toBe(tempId);
    expect(
      lastMessageFor(stateFor(tempId), "network uncertainty")
    ).toMatchObject({
      role: "assistant",
      content: "chat.sendFailed",
    });
  });

  it("Expert renders the canonical resolved tool and projection while preserving the captured mode", async () => {
    stateFor("A").messageInput = "research please";
    stateFor("A").mode = "expert";
    stateFor("A").activeAgentName = "ChatAgent";
    mockGetQueryAbortable.mockResolvedValueOnce(
      invalidInput<ApiEnvelope<DecodedQueryData>>({
        data: {
          tool_name: "InSilicoResearchAgent",
          answer: "Task created: child-1",
          status: "RUNNING",
          task_id: "child-1",
          bot_run_id: "run-expert-1",
          report_revision: 3,
          request_id: "web-request-1",
          follow_up_questions: [],
        },
      })
    );

    const { sendMessage } = makeComposable();
    await sendMessage();

    const [formDataArg] = queryCallAt(0, "expert query call");
    const formData = formDataArg as FormData;
    expect(formData.get("mode")).toBe("expert");
    expect(formData.get("tool")).toBe("");
    const assistant = lastMessageFor(getChatState("A"), "expert response");
    expect(assistant).toMatchObject({
      tool_name: "InSilicoResearchAgent",
      task_id: "child-1",
      botProjection: {
        runId: "run-expert-1",
        agent: "InSilicoResearchAgent",
        status: "RUNNING",
        reportRevision: 3,
        requestId: "web-request-1",
      },
    });
    expect(stateFor("A").historyQuestion).toBeNull();
  });

  it("keeps an accepted Research row and run identity on the captured dialogue", async () => {
    const pending = deferred<ApiEnvelope<DecodedQueryData>>();
    const stateA = stateFor("A");
    const peerBefore = stateFor("B").renderedChat;
    stateA.messageInput = "resolve these Research inputs";
    stateA.mode = "expert";
    stateA.selectedAgent = "InSilicoResearchAgent";
    mockGetQueryAbortable.mockReturnValueOnce(pending.promise);

    const sent = makeComposable().sendMessage();
    await Promise.resolve();
    currentChatId.value = "B";
    currentChat.value = { messages: [] };
    pending.resolve(
      invalidInput<ApiEnvelope<DecodedQueryData>>({
        data: {
          id: "501",
          dialogue_id: "A",
          tool_name: "InSilicoResearchAgent",
          answer: "",
          status: "RUNNING",
          bot_run_id: "run-research-owned",
          follow_up_questions: [],
        },
      })
    );
    await sent;

    expect(lastMessageFor(stateA, "owned Research response")).toMatchObject({
      id: "501",
      tool_name: "InSilicoResearchAgent",
      status: "RUNNING",
      botProjection: {
        runId: "run-research-owned",
        agent: "InSilicoResearchAgent",
        status: "RUNNING",
      },
    });
    expect(stateFor("B").renderedChat).toBe(peerBefore);
  });

  it.each([
    "GeneNetworkAgent",
    "DigitalDesignAgent",
    "InSilicoResearchAgent",
  ] as const)(
    "%s keeps an accepted empty background response free of refusal copy",
    async (toolName) => {
      stateFor("A").messageInput = "start background work";
      stateFor("A").mode = "expert";
      stateFor("A").selectedAgent = toolName;
      mockGetQueryAbortable.mockResolvedValueOnce(
        invalidInput<ApiEnvelope<DecodedQueryData>>({
          data: {
            tool_name: toolName,
            answer: "",
            status: "RUNNING",
            id: "501",
            bot_run_id: `run-${toolName}`,
            follow_up_questions: [],
          },
        })
      );

      await makeComposable().sendMessage();

      expect(lastMessageFor(stateFor("A"), toolName)).toMatchObject({
        role: "assistant",
        tool_name: toolName,
        status: "RUNNING",
        content: "",
      });
    }
  );

  it.each(["RUNNING", "SUBMITTING"] as const)(
    "keeps Expert Auto selecting wait from an empty-tool %s durable row",
    async (status) => {
      const state = stateFor("A");
      state.messageInput = "choose an agent";
      state.mode = "expert";
      state.selectedAgent = "";
      mockGetQueryAbortable.mockResolvedValueOnce(
        invalidInput<ApiEnvelope<DecodedQueryData>>({
          data: {
            tool_name: "",
            answer: "",
            status,
            id: "5",
            bot_run_id: "web-pending-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
            dialogue_id: "A",
            follow_up_questions: [],
          },
        })
      );

      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(vi.fn());
      try {
        await makeComposable().sendMessage();
      } finally {
        consoleError.mockRestore();
      }

      const assistant = lastMessageFor(state, "Expert Auto selecting wait");
      expect(assistant).toMatchObject({
        role: "assistant",
        tool_name: "",
        status,
        id: "5",
        content: "",
      });
      expect(assistant.content).not.toBe("chat.sendFailed");
      expect(state.pendingTurnId).toBeNull();
    }
  );

  it("Expert rejects a non-terminal response without bot run identity", async () => {
    stateFor("A").messageInput = "research without identity";
    stateFor("A").mode = "expert";
    mockGetQueryAbortable.mockResolvedValueOnce(
      invalidInput<ApiEnvelope<DecodedQueryData>>({
        data: {
          tool_name: "InSilicoResearchAgent",
          answer: "Task created",
          status: "RUNNING",
          task_id: "child-missing-run",
          follow_up_questions: [],
        },
      })
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(vi.fn());
    try {
      const { sendMessage } = makeComposable();
      await sendMessage();
    } finally {
      consoleError.mockRestore();
    }

    const assistants = messagesFor(
      getChatState("A"),
      "expert send failure"
    ).filter((message) => message.role === "assistant");
    const failedAssistant = mustGet(
      assistants.at(-1),
      "expert send failure assistant"
    );
    expect(failedAssistant.content).toBe("chat.sendFailed");
    expect(failedAssistant.tool_name).toBe("");
  });

  it("Expert rejects unknown or malformed response tools through the safe send-failure path", async () => {
    for (const data of [
      { tool_name: "UnknownAgent", status: "RUNNING", answer: "bad" },
      {
        tool_name: "InSilicoResearchAgent",
        status: "not-a-status",
        answer: "bad",
      },
    ]) {
      vi.clearAllMocks();
      stateFor("A").messageInput = "bad expert response";
      stateFor("A").mode = "expert";
      stateFor("A").renderedChat = null;
      currentChat.value = { messages: [] };
      mockGetQueryAbortable.mockResolvedValueOnce(
        invalidInput<ApiEnvelope<DecodedQueryData>>({ data })
      );
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(vi.fn());
      try {
        const { sendMessage } = makeComposable();
        await sendMessage();
      } finally {
        consoleError.mockRestore();
      }
      const assistants = messagesFor(
        getChatState("A"),
        "malformed expert send failure"
      ).filter((message) => message.role === "assistant");
      const failedAssistant = mustGet(
        assistants.at(-1),
        "malformed expert send failure assistant"
      );
      expect(failedAssistant.content).toBe("chat.sendFailed");
      expect(failedAssistant.tool_name).toBe("");
      stateFor("A").messageInput = "";
    }
  });

  it("blocking AnalystAgent response does not invent task_id (Update stays unavailable)", async () => {
    stateFor("A").messageInput = "analyze please";
    mockGetQueryAbortable.mockResolvedValueOnce(
      invalidInput<ApiEnvelope<DecodedQueryData>>({
        data: {
          tool_name: "AnalystAgent",
          answer: "job submitted",
          id: "9001",
          compute_resource: "analyst-agents-small",
          follow_up_questions: [],
          // Intentionally omit task_id — blocking QueryData does not provide it.
        },
      })
    );

    const { sendMessage } = makeComposable();
    await sendMessage();

    const analystMessages = messagesFor(getChatState("A"), "analyst response");
    expect(analystMessages).toHaveLength(2);
    const assistant = mustGet(analystMessages[1], "analyst assistant message");
    expect(assistant.tool_name).toBe("AnalystAgent");
    expect(assistant.id).toBe("9001");
    expect(assistant.task_id).toBeUndefined();
    expect("task_id" in assistant).toBe(false);
  });

  it.each([
    {
      name: "instant",
      mode: "instant" as const,
      selectedAgent: "DataAgent",
      expectedTool: "",
      expectedActive: "ChatAgent",
    },
    {
      name: "expert autonomous",
      mode: "expert" as const,
      selectedAgent: "",
      expectedTool: "",
      expectedActive: "",
    },
    {
      name: "expert forced",
      mode: "expert" as const,
      selectedAgent: "DataAgent",
      expectedTool: "DataAgent",
      expectedActive: "DataAgent",
    },
  ])(
    "derives the exact $name payload and progress identity from captured routing state",
    async ({ mode, selectedAgent, expectedTool, expectedActive }) => {
      const state = stateFor("A");
      state.messageInput = "literal @DataAgent, remains query text";
      state.mode = mode;
      state.selectedAgent = selectedAgent;
      const pending = deferred<ApiEnvelope<DecodedQueryData>>();
      mockGetQueryAbortable.mockReturnValueOnce(pending.promise);

      const { sendMessage } = makeComposable();
      const sent = sendMessage();
      await Promise.resolve();
      await Promise.resolve();

      const [formDataArg] = queryCallAt(0, `${mode} payload`);
      const formData = formDataArg as FormData;
      expect(formData.get("mode")).toBe(mode);
      expect(formData.get("tool")).toBe(expectedTool);
      expect(formData.get("query")).toBe(
        "literal @DataAgent, remains query text"
      );
      expect(state.activeAgentName).toBe(expectedActive);

      pending.resolve(
        invalidInput<ApiEnvelope<DecodedQueryData>>({
          data: {
            tool_name: mode === "expert" ? "DataAgent" : "ChatAgent",
            answer: "accepted",
            status: mode === "expert" ? "SUCCEEDED" : undefined,
            id: `${mode}-payload`,
          },
        })
      );
      await sent;
    }
  );

  it("keeps an unchanged captured forced Expert selection after synchronous acceptance", async () => {
    const state = stateFor("A");
    state.mode = "expert";
    state.selectedAgent = "DataAgent";
    currentChat.value = {
      messages: [buildChatMessage({ role: "assistant", content: "prior" })],
    };
    mockGetQueryAbortable.mockResolvedValueOnce(
      invalidInput<ApiEnvelope<DecodedQueryData>>({
        data: {
          tool_name: "DataAgent",
          answer: "accepted",
          status: "SUCCEEDED",
          id: "accepted-sync",
        },
      })
    );

    const { sendMessage } = makeComposable();
    await sendMessage();

    expect(state.selectedAgent).toBe("DataAgent");
    expect(state.pendingTurnId).toBeNull();
    expect(state.pendingTurnFingerprint).toBeNull();
  });

  it("keeps an unchanged captured forced Expert selection after accepted RUNNING response", async () => {
    const state = stateFor("A");
    state.mode = "expert";
    state.selectedAgent = "DataAgent";
    mockGetQueryAbortable.mockResolvedValueOnce(
      invalidInput<ApiEnvelope<DecodedQueryData>>({
        data: {
          tool_name: "DataAgent",
          answer: "accepted",
          status: "RUNNING",
          bot_run_id: "run-accepted",
          request_id: "request-accepted",
          id: "accepted-running",
        },
      })
    );

    const { sendMessage } = makeComposable();
    await sendMessage();

    expect(state.selectedAgent).toBe("DataAgent");
    expect(state.pendingTurnId).toBeNull();
    expect(state.pendingTurnFingerprint).toBeNull();
  });

  it("sends the same forced Knowledge tool on an Expert follow-up turn", async () => {
    const state = stateFor("A");
    state.mode = "expert";
    state.selectedAgent = "KnowledgeAgent";
    mockGetQueryAbortable.mockResolvedValueOnce(
      invalidInput<ApiEnvelope<DecodedQueryData>>({
        data: {
          tool_name: "KnowledgeAgent",
          answer: "first knowledge answer",
          status: "SUCCEEDED",
          id: "knowledge-first",
        },
      })
    );

    const { sendMessage } = makeComposable();
    await sendMessage();

    expect(state.selectedAgent).toBe("KnowledgeAgent");
    state.messageInput = "follow-up citation question";
    mockGetQueryAbortable.mockResolvedValueOnce(
      invalidInput<ApiEnvelope<DecodedQueryData>>({
        data: {
          tool_name: "KnowledgeAgent",
          answer: "second knowledge answer",
          status: "SUCCEEDED",
          id: "knowledge-follow-up",
        },
      })
    );
    await sendMessage();

    const followUp = queryCallAt(1, "knowledge follow-up")[0] as FormData;
    expect(followUp.get("tool")).toBe("KnowledgeAgent");
    expect(followUp.get("mode")).toBe("expert");
    expect(followUp.get("query")).toBe("follow-up citation question");
    expect(state.selectedAgent).toBe("KnowledgeAgent");
  });

  it.each(["PENDING", "QUEUED", "INPUT_REQUIRED"] as const)(
    "preserves an unchanged forced Expert selection for %s responses",
    async (status) => {
      const state = stateFor("A");
      state.mode = "expert";
      state.selectedAgent = "DataAgent";
      mockGetQueryAbortable.mockResolvedValueOnce(
        invalidInput<ApiEnvelope<DecodedQueryData>>({
          data: {
            tool_name: "DataAgent",
            answer: "not yet accepted",
            status,
            bot_run_id: `run-${status.toLowerCase()}`,
            id: `selection-${status.toLowerCase()}`,
          },
        })
      );

      const { sendMessage } = makeComposable();
      await sendMessage();

      expect(state.selectedAgent).toBe("DataAgent");
      expect(state.pendingTurnId).not.toBeNull();
      expect(state.pendingTurnFingerprint).not.toBeNull();
    }
  );

  it("preserves the forced Expert selection for rejected, aborted, timeout, and unverified network outcomes", async () => {
    const { isNetworkError } = await import("@/utils/network-error");
    const outcomes = [
      () =>
        mockGetQueryAbortable.mockResolvedValueOnce(
          invalidInput<ApiEnvelope<DecodedQueryData>>({
            code: 400,
            data: { tool_name: "DataAgent", answer: "rejected" },
          })
        ),
      () =>
        mockGetQueryAbortable.mockRejectedValueOnce({
          code: "ERR_CANCELED",
        }),
      () =>
        mockGetQueryAbortable.mockRejectedValueOnce({
          response: { status: 504 },
        }),
      () => {
        vi.mocked(isNetworkError).mockReturnValueOnce(true);
        mockGetQueryAbortable.mockRejectedValueOnce(new Error("network"));
      },
    ];

    for (const configureOutcome of outcomes) {
      vi.clearAllMocks();
      const state = stateFor("A");
      state.messageInput = "retry-safe";
      state.mode = "expert";
      state.selectedAgent = "DataAgent";
      configureOutcome();
      const errorSpy = vi.spyOn(console, "error").mockImplementation(vi.fn());
      const { sendMessage } = makeComposable();
      if (vi.mocked(isNetworkError).mock.results.at(-1)?.value === true) {
        vi.useFakeTimers();
        const sent = sendMessage();
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(1000);
        await sent;
        vi.useRealTimers();
      } else {
        await sendMessage();
      }
      errorSpy.mockRestore();
      expect(state.selectedAgent).toBe("DataAgent");
    }
  });

  it("preserves selection when reconciliation finds a new matching history id", async () => {
    const { isNetworkError } = await import("@/utils/network-error");
    vi.mocked(isNetworkError).mockReturnValue(true);
    vi.useFakeTimers();
    const state = stateFor("A");
    state.mode = "expert";
    state.selectedAgent = "DataAgent";
    currentChat.value = {
      messages: [
        buildChatMessage({
          id: "history-before-request",
          role: "assistant",
          content: "prior",
        }),
      ],
    };
    mockGetQueryAbortable.mockRejectedValueOnce(new Error("network"));
    mockGetAnswerCheck.mockResolvedValueOnce(
      invalidInput<Awaited<ReturnType<typeof getAnswerCheck>>>({
        code: 200,
        data: [{ id: "history-accepted-request", query: "hi" }],
      })
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(vi.fn());

    const { sendMessage } = makeComposable();
    const sent = sendMessage();
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    await sent;

    errorSpy.mockRestore();
    vi.mocked(isNetworkError).mockReturnValue(false);
    vi.useRealTimers();
    expect(state.selectedAgent).toBe("DataAgent");
    expect(selectChat).toHaveBeenCalledWith("A");
  });

  it("preserves selection when reconciliation finds only a duplicate prior query", async () => {
    const { isNetworkError } = await import("@/utils/network-error");
    vi.mocked(isNetworkError).mockReturnValue(true);
    vi.useFakeTimers();
    const state = stateFor("A");
    state.mode = "expert";
    state.selectedAgent = "DataAgent";
    currentChat.value = {
      messages: [
        buildChatMessage({
          id: "history-duplicate-query",
          role: "assistant",
          content: "prior duplicate",
        }),
      ],
    };
    mockGetQueryAbortable.mockRejectedValueOnce(new Error("network"));
    mockGetAnswerCheck.mockResolvedValueOnce(
      invalidInput<Awaited<ReturnType<typeof getAnswerCheck>>>({
        code: 200,
        data: [{ id: "history-duplicate-query", query: "hi" }],
      })
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(vi.fn());

    try {
      const { sendMessage } = makeComposable();
      const sent = sendMessage();
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(1000);
      await sent;

      expect(state.selectedAgent).toBe("DataAgent");
      expect(selectChat).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
      vi.mocked(isNetworkError).mockReturnValue(false);
      vi.useRealTimers();
    }
  });

  it.each(["stopped", "stale"] as const)(
    "preserves selection when reconciliation becomes %s before history returns",
    async (lifecycle) => {
      const { isNetworkError } = await import("@/utils/network-error");
      vi.mocked(isNetworkError).mockReturnValue(true);
      vi.useFakeTimers();
      const state = stateFor("A");
      state.mode = "expert";
      state.selectedAgent = "DataAgent";
      currentChat.value = {
        messages: [
          buildChatMessage({
            id: "history-before-request",
            role: "assistant",
            content: "prior",
          }),
        ],
      };
      mockGetQueryAbortable.mockRejectedValueOnce(new Error("network"));
      const history = deferred<Awaited<ReturnType<typeof getAnswerCheck>>>();
      mockGetAnswerCheck.mockReturnValueOnce(history.promise);
      const errorSpy = vi.spyOn(console, "error").mockImplementation(vi.fn());

      try {
        const { sendMessage } = makeComposable();
        const sent = sendMessage();
        await Promise.resolve();
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(1000);
        await Promise.resolve();
        if (lifecycle === "stopped") {
          state.generationStopped = true;
        } else {
          state.activeRequestId = "newer-request";
        }
        history.resolve(
          invalidInput<Awaited<ReturnType<typeof getAnswerCheck>>>({
            code: 200,
            data: [{ id: "history-accepted-request", query: "hi" }],
          })
        );
        await sent;

        expect(state.selectedAgent).toBe("DataAgent");
        expect(selectChat).not.toHaveBeenCalled();
      } finally {
        errorSpy.mockRestore();
        vi.mocked(isNetworkError).mockReturnValue(false);
        vi.useRealTimers();
      }
    }
  );

  it("preserves a newer forced selection changed while the captured request is in flight", async () => {
    const state = stateFor("A");
    state.mode = "expert";
    state.selectedAgent = "DataAgent";
    const pending = deferred<ApiEnvelope<DecodedQueryData>>();
    mockGetQueryAbortable.mockReturnValueOnce(pending.promise);

    const { sendMessage } = makeComposable();
    const sent = sendMessage();
    await Promise.resolve();
    await Promise.resolve();
    state.selectedAgent = "KnowledgeAgent";
    pending.resolve(
      invalidInput<ApiEnvelope<DecodedQueryData>>({
        data: {
          tool_name: "DataAgent",
          answer: "accepted",
          status: "SUCCEEDED",
          id: "changed-selection",
        },
      })
    );
    await sent;

    expect(state.selectedAgent).toBe("KnowledgeAgent");
  });
});
