import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { nextTick, ref, type Ref } from "vue";
import { useSelectChat } from "@/views/chat/composables/useSelectChat";
import type {
  Chat,
  ChatMessage,
  ChatUIState,
  ChatView,
} from "@/views/chat/types";
import type { ApiEnvelope, ChatHistoryRecord } from "@/api/types";
import type { UploadRecoveryStore } from "@/views/chat/upload/store";
import { accountScopeForUsername } from "@/views/chat/upload/hash";
import { buildChat, buildChatState } from "../../../helpers/chatBuilders";
import {
  buildApiEnvelope,
  buildChatHistoryRecord,
} from "../../../helpers/apiBuilders";
import { invalidInput } from "../../../helpers/invalidInput";
import { deferred, mustGet } from "../../../helpers/mockFactories";

vi.mock("element-plus", () => ({
  ElMessage: { warning: vi.fn() },
}));

// Mock getAnswerCheck API (the only API selectChat calls)
vi.mock("@/api/chat", () => ({
  getAnswerCheck: vi.fn(),
}));

vi.mock("@/views/chat/utils/agent-log", () => ({
  readServerFile: vi.fn(),
}));

import { getAnswerCheck } from "@/api/chat";
import { readServerFile } from "@/views/chat/utils/agent-log";
import { ElMessage } from "element-plus";

const mockGetAnswerCheck = vi.mocked(getAnswerCheck);
const mockReadServerFile = vi.mocked(readServerFile);

describe("useSelectChat", () => {
  // Each dialogueId maps to one mutable state record; repeated getChatState(id) returns the same object
  let states: Map<string, ChatUIState>;
  let getChatState: (dialogueId: string) => ChatUIState;
  let currentChatId: Ref<string>;
  let chatList: Ref<Chat[]>;
  let scrollToBottom: Mock<() => Promise<void>>;
  let updateUrlWithChatId: ReturnType<typeof vi.fn>;
  let timestamp: Ref<number>;
  let username: Ref<string>;

  beforeEach(() => {
    vi.clearAllMocks();
    states = new Map();
    getChatState = (dialogueId: string) => {
      if (!states.has(dialogueId)) {
        states.set(dialogueId, buildChatState());
      }
      return mustGet(states.get(dialogueId), `chat state ${dialogueId}`);
    };
    currentChatId = ref("");
    chatList = ref<Chat[]>([
      buildChat({ id: 1, dialogue_id: "d1", title: "t" }),
      buildChat({ id: 2, dialogue_id: "d2", title: "t2" }),
    ]);
    scrollToBottom = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    updateUrlWithChatId = vi.fn();
    timestamp = ref(0);
    username = ref("researcher@example.com");
  });

  function historyResponse(
    records: ChatHistoryRecord[],
    overrides: Partial<ApiEnvelope<ChatHistoryRecord[]>> = {}
  ): ApiEnvelope<ChatHistoryRecord[]> {
    return buildApiEnvelope(records, overrides);
  }

  function stateFor(dialogueId: string): ChatUIState {
    return mustGet(states.get(dialogueId), `chat state ${dialogueId}`);
  }

  function renderedFor(dialogueId: string, label: string): ChatView {
    return mustGet(
      stateFor(dialogueId).renderedChat,
      `${label}: rendered chat`
    );
  }

  function messageAt(
    dialogueId: string,
    index: number,
    label: string
  ): ChatMessage {
    return mustGet(renderedFor(dialogueId, label).messages[index], label);
  }

  function historyAt(
    dialogueId: string,
    index: number,
    label: string
  ): ChatMessage {
    const historyQuestion = mustGet(
      stateFor(dialogueId).historyQuestion,
      `${label}: history question`
    );
    return mustGet(historyQuestion[index], label);
  }

  function makeComposable(
    options: Partial<{
      username: Ref<string>;
      attachmentStore: UploadRecoveryStore;
    }> = {}
  ) {
    return useSelectChat({
      getChatState,
      ownsChatState: (dialogueId, state) => states.get(dialogueId) === state,
      currentChatId,
      scrollToBottom,
      updateUrlWithChatId,
      chatList,
      timestamp,
      ...options,
    });
  }

  function attachmentStore(
    records: Array<{
      assetId: string;
      name: string;
      size: number;
      type: string;
      status: "completed" | "failed";
    }>
  ): UploadRecoveryStore {
    return {
      list: vi.fn().mockResolvedValue(records),
      upsert: vi.fn(),
      load: vi.fn(),
      remove: vi.fn(),
      close: vi.fn(),
    } as unknown as UploadRecoveryStore;
  }

  it.each(["instant", "expert"] as const)(
    "restores persisted %s mode instead of retaining the new-chat default",
    async (persistedMode) => {
      states.set(
        "d1",
        buildChatState({
          mode: persistedMode === "instant" ? "expert" : "instant",
        })
      );
      mockGetAnswerCheck.mockResolvedValueOnce(
        historyResponse([
          buildChatHistoryRecord({
            id: `mode-${persistedMode}`,
            query: "Persisted question",
            answer: "Persisted answer",
            tool_name: "ChatAgent",
            mode: persistedMode,
          }),
        ])
      );

      const { selectChat } = makeComposable();
      await selectChat("d1");

      expect(stateFor("d1").mode).toBe(persistedMode);
    }
  );

  it("hydrates structured attachments with purpose-free same-account metadata", async () => {
    mockGetAnswerCheck.mockResolvedValueOnce(
      historyResponse([
        buildChatHistoryRecord({
          id: "asset-history",
          query: "Analyze these reads",
          answer: "Done",
          tool_name: "ChatAgent",
          attachments: [{ asset_id: "file_reads" }],
        }),
      ])
    );
    const store = attachmentStore([
      {
        assetId: "file_reads",
        name: "reads.fastq.gz",
        size: 42,
        type: "application/gzip",
        status: "completed",
      },
    ]);

    await makeComposable({ username, attachmentStore: store }).selectChat("d1");

    const user = messageAt("d1", 0, "structured attachment user");
    expect(user.content).toBe("Analyze these reads");
    expect(user.attachments).toEqual([
      {
        asset_id: "file_reads",
        name: "reads.fastq.gz",
        size: 42,
        type: "application/gzip",
      },
    ]);
    expect(
      historyAt("d1", 0, "structured attachment history").attachments
    ).toEqual(user.attachments);
  });

  it("hydrates the persisted Research query exactly into display and next-turn history", async () => {
    const rawQuery =
      '\n  Reproduce the rice root atlas.\n\nPaper text: root cell atlas.\n\ndata: {\n  "/obs/safe/\u7a3b-root/matrix.mtx.gz": "counts"\n}\n  ';
    mockGetAnswerCheck.mockResolvedValueOnce(
      historyResponse([
        buildChatHistoryRecord({
          id: "research-history",
          query: rawQuery,
          answer: "",
          status: "RUNNING",
          tool_name: "InSilicoResearchAgent",
          attachments: [],
        }),
      ])
    );

    await makeComposable().selectChat("d1");

    expect(messageAt("d1", 0, "Research raw user query").content).toBe(
      rawQuery
    );
    expect(historyAt("d1", 0, "Research raw next-turn history")).toEqual({
      role: "user",
      content: rawQuery,
      attachments: [],
    });
  });

  it("seeds hydrated report identities as handled before exposing the chat", async () => {
    mockGetAnswerCheck.mockResolvedValueOnce(
      historyResponse([
        buildChatHistoryRecord({
          id: "hydrated-cited",
          query: "Cited query",
          answer: "# Cited report",
          status: "FAILED",
          tool_name: "KnowledgeAgent",
        }),
        buildChatHistoryRecord({
          id: "hydrated-research",
          query: "Research query",
          answer: "# Research report",
          status: "RUNNING",
          tool_name: "InSilicoResearchAgent",
        }),
      ])
    );

    await makeComposable().selectChat("d1");

    expect(stateFor("d1").handledArtifactIdentities).toEqual([
      "message:hydrated-cited",
      "message:hydrated-research",
    ]);
    expect(stateFor("d1").renderedChat?.messages).toHaveLength(4);
  });

  it("drops legacy storage fields while preserving v1 delivery and opaque artifacts", async () => {
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
    mockGetAnswerCheck.mockResolvedValueOnce(
      historyResponse([
        buildChatHistoryRecord({
          id: "archive-history",
          query: "Build a network",
          answer: "Network report",
          tool_name: "GeneNetworkAgent",
          status: "SUCCEEDED",
          result_archive_v1: true,
          delivery,
          artifacts: [
            { id: "archive-1", name: "network-results.zip", kind: "archive" },
          ],
          upload_path: "/obs/private/upload",
          download_path: "/obs/private/download",
          image_paths: ["/obs/private/result.png"],
          server_file_path: "/srv/private/result.txt",
        }),
      ])
    );

    await makeComposable().selectChat("d1");

    const assistant = messageAt("d1", 1, "archive history");
    expect(assistant.delivery).toEqual(delivery);
    expect(assistant.artifacts).toEqual([
      { id: "archive-1", name: "network-results.zip", kind: "archive" },
    ]);
    expect(assistant).not.toHaveProperty("upload_path");
    expect(assistant).not.toHaveProperty("download_path");
    expect(assistant).not.toHaveProperty("server_file_path");
    expect(JSON.stringify(assistant)).not.toContain("/obs/private");
    expect(JSON.stringify(assistant)).not.toContain("/srv/private");
  });

  it("hydrates historical structured attachments without classification", async () => {
    mockGetAnswerCheck.mockResolvedValueOnce(
      historyResponse([
        buildChatHistoryRecord({
          query: "Inspect the old attachment",
          answer: "Done",
          tool_name: "ChatAgent",
          attachments: [{ asset_id: "file_legacy" }],
        }),
      ])
    );

    await makeComposable({
      username,
      attachmentStore: attachmentStore([
        {
          assetId: "file_legacy",
          name: "legacy.csv",
          size: 12,
          type: "text/csv",
          status: "completed",
        },
      ]),
    }).selectChat("d1");

    expect(messageAt("d1", 0, "legacy attachment").attachments).toEqual([
      {
        asset_id: "file_legacy",
        name: "legacy.csv",
        size: 12,
        type: "text/csv",
      },
    ]);
  });

  it("uses a localized generic label when same-account metadata is unavailable", async () => {
    mockGetAnswerCheck.mockResolvedValueOnce(
      historyResponse([
        buildChatHistoryRecord({
          query: "Inspect the asset",
          answer: "Done",
          tool_name: "ChatAgent",
          attachments: [{ asset_id: "file_missing" }],
        }),
      ])
    );

    await makeComposable({
      username,
      attachmentStore: attachmentStore([]),
    }).selectChat("d1");

    expect(
      messageAt("d1", 0, "missing attachment fallback").attachments
    ).toEqual([
      {
        asset_id: "file_missing",
        name: "Completed file",
        size: 0,
        type: "",
      },
    ]);
  });

  it("does not reuse IndexedDB metadata across account scopes", async () => {
    const firstScope = await accountScopeForUsername(username.value);
    const list = vi.fn().mockImplementation((scope: string) =>
      Promise.resolve(
        scope === firstScope
          ? [
              {
                assetId: "file_private",
                name: "private.fastq",
                size: 9,
                type: "application/gzip",
                status: "completed",
              },
            ]
          : []
      )
    );
    const store = {
      list,
      upsert: vi.fn(),
      load: vi.fn(),
      remove: vi.fn(),
      close: vi.fn(),
    } as unknown as UploadRecoveryStore;
    const history = (query: string) =>
      historyResponse([
        buildChatHistoryRecord({
          query,
          answer: "Done",
          tool_name: "ChatAgent",
          attachments: [{ asset_id: "file_private" }],
        }),
      ]);

    mockGetAnswerCheck.mockResolvedValueOnce(history("First account"));
    const composable = makeComposable({ username, attachmentStore: store });
    await composable.selectChat("d1");
    expect(
      messageAt("d1", 0, "first account attachment").attachments?.[0]?.name
    ).toBe("private.fastq");

    username.value = "other@example.com";
    getChatState("d2").renderedChat = null;
    mockGetAnswerCheck.mockResolvedValueOnce(history("Second account"));
    await composable.selectChat("d2");

    expect(list).toHaveBeenCalledTimes(2);
    expect(list.mock.calls[0]?.[0]).not.toBe(list.mock.calls[1]?.[0]);
    expect(
      messageAt("d2", 0, "second account attachment").attachments?.[0]
    ).toMatchObject({
      asset_id: "file_private",
      name: "Completed file",
    });
  });

  it("keeps literal marker text for structured rows and only parses legacy rows", async () => {
    mockGetAnswerCheck.mockResolvedValueOnce(
      historyResponse([
        buildChatHistoryRecord({
          query: "Literal [Attachment: note.txt (1 KB)]",
          answer: "Structured",
          tool_name: "ChatAgent",
          attachments: [],
        }),
        buildChatHistoryRecord({
          id: "legacy",
          query: "Legacy\n\n[Attachment: old.txt (1 KB)]",
          answer: "Legacy answer",
          tool_name: "ChatAgent",
        }),
      ])
    );

    await makeComposable().selectChat("d1");

    expect(messageAt("d1", 0, "literal structured marker").content).toBe(
      "Literal [Attachment: note.txt (1 KB)]"
    );
    expect(messageAt("d1", 2, "legacy marker").content).toBe("Legacy");
    expect(messageAt("d1", 2, "legacy marker").attachedFiles).toHaveLength(1);
  });

  it("ChatAgent history: syncs currentChatId, hydrates reaction, rebuilds messages, sets historyQuestion, updates URL", async () => {
    mockGetAnswerCheck.mockResolvedValueOnce({
      ...historyResponse([
        buildChatHistoryRecord({
          id: "msg-1",
          reaction_type: "1",
          query: "Hello",
          answer: "Hello, I'm the assistant",
          tool_name: "ChatAgent",
        }),
      ]),
    });

    const { selectChat } = makeComposable();
    await expect(selectChat("d1")).resolves.toBeUndefined();

    // currentChatId is written synchronously before the await
    expect(currentChatId.value).toBe("d1");

    // reaction hydration (string "1" → number 1)
    expect(stateFor("d1").reactions["msg-1"]).toBe(1);

    // messages rebuilt into this dialogue's renderedChat owner
    const rendered = renderedFor("d1", "ChatAgent history");
    const messages = rendered.messages;
    expect(messages).toHaveLength(2);

    const userMsg = mustGet(messages[0], "ChatAgent history user message");
    expect(userMsg.role).toBe("user");
    expect(userMsg.content).toBe("Hello");

    const assistantMsg = mustGet(
      messages[1],
      "ChatAgent history assistant message"
    );
    expect(assistantMsg.role).toBe("assistant");
    expect(assistantMsg.content).toBe("Hello, I'm the assistant");
    expect(assistantMsg.tool_name).toBe("ChatAgent");
    expect(assistantMsg.id).toBe("msg-1");

    // renderedChat merges in the original chat record's fields
    expect(rendered.dialogue_id).toBe("d1");
    expect(rendered.title).toBe("t");

    // historyQuestion is set (non-null, holding two condensed records)
    const hq = mustGet(stateFor("d1").historyQuestion, "ChatAgent history");
    expect(hq).toHaveLength(2);
    expect(historyAt("d1", 0, "ChatAgent history user record")).toEqual({
      role: "user",
      content: "Hello",
    });
    expect(historyAt("d1", 1, "ChatAgent history assistant record")).toEqual({
      role: "assistant",
      content: "Hello, I'm the assistant",
    });

    // URL updated
    expect(updateUrlWithChatId).toHaveBeenCalledWith("d1");

    // Scroll to bottom when there are messages
    expect(scrollToBottom).toHaveBeenCalled();
  });

  it("hydrates only the bounded degraded context notice from history", async () => {
    mockGetAnswerCheck.mockResolvedValueOnce(
      historyResponse([
        invalidInput<ChatHistoryRecord>({
          ...buildChatHistoryRecord({
            id: "context-history-1",
            query: "Historical question",
            answer: "Historical answer",
            tool_name: "ChatAgent",
            context_rebuilt: false,
            context_degraded: true,
          }),
          context_version: "private-v2",
        }),
      ])
    );

    await makeComposable().selectChat("d1");

    const assistant = messageAt("d1", 1, "history context notice");
    expect(assistant.contextNotice).toEqual({ rebuilt: false, degraded: true });
    expect("context_version" in assistant).toBe(false);
  });

  it("resets reaction state before loading: stale entries are cleared before hydration", async () => {
    // Seed a stale reaction (pointing to the same d1 record)
    const stale = getChatState("d1");
    stale.reactions = { "old-msg": 2 };

    mockGetAnswerCheck.mockResolvedValueOnce(
      historyResponse([
        buildChatHistoryRecord({
          id: "msg-1",
          reaction_type: "1",
          query: "Question",
          answer: "Answer",
          tool_name: "ChatAgent",
        }),
      ])
    );

    const { selectChat } = makeComposable();
    await selectChat("d1");

    const reactions = stateFor("d1").reactions;
    // The stale entry is cleared
    expect(reactions["old-msg"]).toBeUndefined();
    // The new entry is hydrated
    expect(reactions["msg-1"]).toBe(1);
  });

  it("warns once for a hydrated degraded answer and keeps context rebuild quiet", async () => {
    const degraded = invalidInput<ChatHistoryRecord>({
      ...buildChatHistoryRecord({
        id: "degraded-message",
        query: "Question",
        answer: "Saved answer",
        tool_name: "ChatAgent",
      }),
      context_rebuilt: true,
      context_degraded: true,
    });
    mockGetAnswerCheck.mockResolvedValueOnce(historyResponse([degraded]));

    const { selectChat } = makeComposable();
    await selectChat("d1");

    expect(messageAt("d1", 1, "degraded history").content).toBe("Saved answer");
    expect(ElMessage.warning).toHaveBeenCalledTimes(1);
    expect(ElMessage.warning).toHaveBeenCalledWith(
      "Answer saved. Conversation context will be rebuilt on the next message."
    );

    // Force a second hydration of the same row to prove the warning is
    // message-scoped rather than selection-scoped.
    stateFor("d1").renderedChat = null;
    mockGetAnswerCheck.mockResolvedValueOnce(historyResponse([degraded]));
    await selectChat("d1");
    expect(ElMessage.warning).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    mockGetAnswerCheck.mockResolvedValueOnce(
      historyResponse([
        invalidInput<ChatHistoryRecord>({
          ...buildChatHistoryRecord({
            id: "rebuilt-message",
            query: "Question",
            answer: "Rebuilt answer",
            tool_name: "ChatAgent",
          }),
          context_rebuilt: true,
        }),
      ])
    );
    stateFor("d1").renderedChat = null;
    await selectChat("d1");
    expect(ElMessage.warning).not.toHaveBeenCalled();
  });

  it("ignores optional history source metadata and preserves legacy rendering", async () => {
    mockGetAnswerCheck.mockResolvedValueOnce(
      historyResponse([
        invalidInput<ChatHistoryRecord>({
          ...buildChatHistoryRecord({
            id: "msg-source",
            query: "Question",
            answer: "Answer",
            tool_name: "ChatAgent",
          }),
          source: "unexpected-diagnostic",
          fallback_reason: "private upstream error",
        }),
      ])
    );

    const { selectChat } = makeComposable();
    await selectChat("d1");

    const messages = renderedFor("d1", "source metadata").messages;
    expect(messages).toHaveLength(2);
    expect(mustGet(messages[0], "source metadata user message")).toMatchObject({
      role: "user",
      content: "Question",
    });
    const assistant = mustGet(messages[1], "source metadata assistant message");
    expect(assistant).toMatchObject({ role: "assistant", content: "Answer" });
    expect("source" in assistant).toBe(false);
    expect("fallback_reason" in assistant).toBe(false);
  });

  it("reselects a live rendered owner without overwriting its message runtime from history", async () => {
    const transport = vi.fn();
    const runtime = {
      dialogueId: "d1",
      messageId: "live-message",
      runId: "live-run",
      transport,
    };
    const liveMessage: ChatMessage = {
      role: "assistant",
      content: "",
      streaming: true,
      a2uiRuntime: runtime,
      blocks: [],
    };
    const state = getChatState("d1");
    state.renderedChat = { dialogue_id: "d1", messages: [liveMessage] };
    const renderedOwner = state.renderedChat;

    const { selectChat } = makeComposable();
    await selectChat("d1");

    expect(mockGetAnswerCheck).not.toHaveBeenCalled();
    expect(state.renderedChat).toBe(renderedOwner);
    expect(messageAt("d1", 0, "live rendered owner").a2uiRuntime).toBe(runtime);
    expect(updateUrlWithChatId).toHaveBeenCalledWith("d1");
    expect(scrollToBottom).toHaveBeenCalledTimes(1);
  });

  it("hydrates a persisted A2UI pause as expired instead of dropping the message", async () => {
    mockGetAnswerCheck.mockResolvedValueOnce(
      historyResponse([
        invalidInput<ChatHistoryRecord>({
          ...buildChatHistoryRecord({
            id: "history-a2ui",
            query: "Please complete this form",
            answer: "",
            status: "INPUT_REQUIRED",
            tool_name: "ChatAgent",
          }),
          a2ui: {
            catalog_version: "v1.0",
            surface_id: "history-surface",
            widget: "confirm",
            props: { title: "Continue?" },
          },
        }),
      ])
    );

    const { selectChat } = makeComposable();
    await selectChat("d1");

    const assistant = messageAt("d1", 1, "history A2UI pause");
    expect(assistant).toMatchObject({
      role: "assistant",
      id: "history-a2ui",
      tool_name: "ChatAgent",
    });
    expect(assistant.blocks?.[0]?.a2ui?.state).toEqual({
      status: "expired",
      round: 1,
      code: "reload_unverified",
    });
    expect(assistant.a2uiRuntime).toBeUndefined();
  });

  it("keeps a live A2UI runtime when a background reload returns the same pause", async () => {
    const transport = vi.fn();
    const runtime = {
      dialogueId: "d1",
      messageId: "live-a2ui",
      runId: "live-run",
      transport,
    };
    const state = getChatState("d1");
    const liveMessage: ChatMessage = {
      role: "assistant",
      content: "",
      id: "live-a2ui",
      tool_name: "ChatAgent",
      blocks: [
        {
          type: "agent-surface",
          authority: "agent",
          interactive: true,
          a2ui: {
            surface: {
              catalog_version: "v1.0",
              surface_id: "live-surface",
              widget: "confirm",
              props: { title: "Continue?" },
            },
            state: { status: "ready", round: 1 },
          },
        },
      ],
      a2uiRuntime: runtime,
    };
    state.renderedChat = {
      dialogue_id: "d1",
      messages: [
        { role: "user", content: "Please complete this form" },
        liveMessage,
      ],
    };
    state.historyHydration = "ready";
    mockGetAnswerCheck.mockResolvedValueOnce(
      historyResponse([
        invalidInput<ChatHistoryRecord>({
          ...buildChatHistoryRecord({
            id: "live-a2ui",
            query: "Please complete this form",
            answer: "",
            status: "INPUT_REQUIRED",
            tool_name: "ChatAgent",
          }),
          a2ui: {
            catalog_version: "v1.0",
            surface_id: "live-surface",
            widget: "confirm",
            props: { title: "Continue?" },
          },
        }),
      ])
    );

    const { reloadChat } = makeComposable();
    await expect(reloadChat("d1")).resolves.toBe("applied");

    const assistant = messageAt("d1", 1, "live A2UI reload");
    expect(assistant.a2uiRuntime).toBe(runtime);
    expect(assistant.blocks?.[0]?.a2ui?.state).toEqual({
      status: "ready",
      round: 1,
    });
  });

  it("non-200 response: clears stale history and records a recoverable request error", async () => {
    // Seed stale rendered/history state to verify this dialogue is reset before fetch.
    const st = getChatState("d1");
    st.historyQuestion = [{ role: "user", content: "keep me" }];
    st.renderedChat = null;

    mockGetAnswerCheck.mockResolvedValueOnce(
      historyResponse([], { code: 500, message: "history unavailable" })
    );

    const { selectChat } = makeComposable();
    await selectChat("d1");

    // The synchronous currentChatId write still happens
    expect(currentChatId.value).toBe("d1");
    // The non-200 branch leaves no stale rendered history behind.
    expect(stateFor("d1").renderedChat).toBeNull();
    expect(stateFor("d1").historyQuestion).toBeNull();
    expect(stateFor("d1").historyHydration).toBe("error");
    expect(stateFor("d1").historyErrorKind).toBe("request");
    // The URL is updated while still active
    expect(updateUrlWithChatId).toHaveBeenCalledWith("d1");
  });

  it("hydrates legacy title-only rows without fabricating a missing assistant answer", async () => {
    mockGetAnswerCheck.mockResolvedValueOnce(
      historyResponse([
        invalidInput<ChatHistoryRecord>({
          id: "legacy-title-only",
          title_query: "Legacy title question",
          answer: undefined,
          tool_name: "ChatAgent",
        }),
      ])
    );

    const { selectChat } = makeComposable();
    await selectChat("d1");

    expect(stateFor("d1").historyHydration).toBe("ready");
    expect(stateFor("d1").historyErrorKind).toBeNull();
    expect(renderedFor("d1", "legacy title-only").messages).toEqual([
      expect.objectContaining({
        role: "user",
        content: "Legacy title question",
      }),
    ]);
    expect(stateFor("d1").historyQuestion).toEqual([
      { role: "user", content: "Legacy title question" },
    ]);
  });

  it("uses the sidebar title only for the parent row, not every child answer", async () => {
    mockGetAnswerCheck.mockResolvedValueOnce(
      historyResponse([
        invalidInput<ChatHistoryRecord>({
          id: "legacy-parent",
          query: undefined,
          title_query: "Legacy conversation title",
          answer: "",
          tool_name: "ChatAgent",
        }),
        invalidInput<ChatHistoryRecord>({
          id: "legacy-child",
          query: undefined,
          title_query: undefined,
          answer: "Child answer",
          tool_name: "ChatAgent",
        }),
      ])
    );

    const { selectChat } = makeComposable();
    await selectChat("d1");

    expect(renderedFor("d1", "legacy parent and child").messages).toEqual([
      expect.objectContaining({
        role: "user",
        content: "Legacy conversation title",
      }),
      expect.objectContaining({ role: "assistant", content: "Child answer" }),
    ]);
    expect(stateFor("d1").historyQuestion).toEqual([
      { role: "user", content: "Legacy conversation title" },
      { role: "assistant", content: "Child answer" },
    ]);
  });

  it("records an empty successful history without rendering fabricated rows", async () => {
    mockGetAnswerCheck.mockResolvedValueOnce(historyResponse([]));

    const { selectChat } = makeComposable();
    await selectChat("d1");

    expect(stateFor("d1").historyHydration).toBe("history-empty");
    expect(stateFor("d1").historyErrorKind).toBeNull();
    expect(renderedFor("d1", "empty history").messages).toEqual([]);
    expect(stateFor("d1").historyQuestion).toEqual([]);
  });

  it("records a decode error for a malformed successful payload", async () => {
    mockGetAnswerCheck.mockResolvedValueOnce(
      invalidInput<ApiEnvelope<ChatHistoryRecord[]>>({ code: 200, data: null })
    );

    const { selectChat } = makeComposable();
    await selectChat("d1");

    expect(stateFor("d1").historyHydration).toBe("error");
    expect(stateFor("d1").historyErrorKind).toBe("decode");
    expect(stateFor("d1").renderedChat).toBeNull();
  });

  it("records a request error when history retrieval rejects", async () => {
    mockGetAnswerCheck.mockRejectedValueOnce(new Error("network unavailable"));

    const { selectChat } = makeComposable();
    await selectChat("d1");

    expect(stateFor("d1").historyHydration).toBe("error");
    expect(stateFor("d1").historyErrorKind).toBe("request");
    expect(updateUrlWithChatId).toHaveBeenCalledWith("d1");
  });

  it("concurrent-switch safety: after mid-fetch currentChatId switch, reaction and historyQuestion write back to the argument dialogueId, not the live currentChatId", async () => {
    // Manually control when getAnswerCheck resolves
    const pendingCheck = deferred<ApiEnvelope<ChatHistoryRecord[]>>();
    mockGetAnswerCheck.mockReturnValueOnce(pendingCheck.promise);

    const { selectChat } = makeComposable();

    // 1. Start selectChat("d1") but don't await — the fetch hangs
    const p = selectChat("d1");

    // 2. During the await, the user switches to d2
    currentChatId.value = "d2";
    getChatState("d2");

    // 3. Resolve the fetch with a ChatAgent-style reaction_type
    pendingCheck.resolve(
      historyResponse([
        buildChatHistoryRecord({
          id: "msg-concurrent",
          reaction_type: "2",
          query: "Concurrent question",
          answer: "Concurrent answer",
          tool_name: "ChatAgent",
        }),
      ])
    );

    await p;

    // reaction hydration writes to the argument d1, not to the live currentChatId d2
    expect(stateFor("d1").reactions["msg-concurrent"]).toBe(2);
    expect(stateFor("d2").reactions["msg-concurrent"]).toBeUndefined();

    // historyQuestion is also written to d1
    const hq = mustGet(stateFor("d1").historyQuestion, "concurrent history");
    expect(hq).toHaveLength(2);
    expect(stateFor("d2").historyQuestion).toBeNull();

    // rendered data lands on d1 only; late response does not steal URL/scroll
    expect(renderedFor("d1", "concurrent history").messages).toHaveLength(2);
    expect(stateFor("d2").renderedChat).toBeNull();
    expect(currentChatId.value).toBe("d2");
    expect(updateUrlWithChatId).not.toHaveBeenCalled();
    expect(scrollToBottom).not.toHaveBeenCalled();
  });

  it("out-of-order A/B history responses populate only their states and never revert current ID/URL/scroll", async () => {
    const pendingA = deferred<ApiEnvelope<ChatHistoryRecord[]>>();
    const pendingB = deferred<ApiEnvelope<ChatHistoryRecord[]>>();

    mockGetAnswerCheck
      .mockReturnValueOnce(pendingA.promise)
      .mockReturnValueOnce(pendingB.promise);

    const { selectChat } = makeComposable();
    const pA = selectChat("d1");
    const pB = selectChat("d2");

    expect(currentChatId.value).toBe("d2");

    // B resolves first
    pendingB.resolve(
      historyResponse([
        buildChatHistoryRecord({
          id: "msg-b",
          query: "B-q",
          answer: "B-a",
          tool_name: "ChatAgent",
        }),
      ])
    );
    await pB;

    expect(currentChatId.value).toBe("d2");
    expect(messageAt("d2", 0, "B history").content).toBe("B-q");
    expect(updateUrlWithChatId).toHaveBeenCalledTimes(1);
    expect(updateUrlWithChatId).toHaveBeenCalledWith("d2");
    expect(scrollToBottom).toHaveBeenCalledTimes(1);

    // A resolves later — data only, no foreground steal
    pendingA.resolve(
      historyResponse([
        buildChatHistoryRecord({
          id: "msg-a",
          query: "A-q",
          answer: "A-a",
          tool_name: "ChatAgent",
        }),
      ])
    );
    await pA;

    expect(currentChatId.value).toBe("d2");
    expect(messageAt("d1", 0, "A history").content).toBe("A-q");
    expect(messageAt("d2", 0, "B history").content).toBe("B-q");
    expect(updateUrlWithChatId).toHaveBeenCalledTimes(1);
    expect(updateUrlWithChatId).toHaveBeenCalledWith("d2");
    expect(scrollToBottom).toHaveBeenCalledTimes(1);
  });

  it("A→B→A ignores the stale first A response after the newer A hydration succeeds", async () => {
    const firstA = deferred<ApiEnvelope<ChatHistoryRecord[]>>();
    const pendingB = deferred<ApiEnvelope<ChatHistoryRecord[]>>();
    const secondA = deferred<ApiEnvelope<ChatHistoryRecord[]>>();
    mockGetAnswerCheck
      .mockReturnValueOnce(firstA.promise)
      .mockReturnValueOnce(pendingB.promise)
      .mockReturnValueOnce(secondA.promise);

    const { selectChat } = makeComposable();
    const firstASelection = selectChat("d1");
    const bSelection = selectChat("d2");
    const secondASelection = selectChat("d1");

    secondA.resolve(
      historyResponse([
        buildChatHistoryRecord({
          id: "new-a",
          query: "New A question",
          answer: "New A answer",
          tool_name: "ChatAgent",
        }),
      ])
    );
    await secondASelection;

    expect(messageAt("d1", 0, "new A history").content).toBe("New A question");
    expect(stateFor("d1").historyHydration).toBe("ready");
    expect(updateUrlWithChatId).toHaveBeenCalledTimes(1);
    expect(scrollToBottom).toHaveBeenCalledTimes(1);

    firstA.resolve(
      historyResponse([
        buildChatHistoryRecord({
          id: "old-a",
          query: "Old A question",
          answer: "Old A answer",
          tool_name: "ChatAgent",
        }),
      ])
    );
    await firstASelection;

    expect(messageAt("d1", 0, "stale A history").content).toBe(
      "New A question"
    );
    expect(stateFor("d1").historyHydration).toBe("ready");
    expect(updateUrlWithChatId).toHaveBeenCalledTimes(1);
    expect(scrollToBottom).toHaveBeenCalledTimes(1);

    pendingB.resolve(historyResponse([]));
    await bSelection;
  });

  it("a rejected stale request cannot overwrite the newer hydration error state", async () => {
    const firstA = deferred<ApiEnvelope<ChatHistoryRecord[]>>();
    const secondA = deferred<ApiEnvelope<ChatHistoryRecord[]>>();
    mockGetAnswerCheck
      .mockReturnValueOnce(firstA.promise)
      .mockReturnValueOnce(secondA.promise);

    const { selectChat } = makeComposable();
    const firstASelection = selectChat("d1");
    const secondASelection = selectChat("d1");

    secondA.resolve(historyResponse([], { code: 500 }));
    await secondASelection;
    expect(stateFor("d1").historyHydration).toBe("error");
    expect(stateFor("d1").historyErrorKind).toBe("request");
    expect(updateUrlWithChatId).toHaveBeenCalledTimes(1);

    firstA.reject(new Error("stale request failed"));
    await firstASelection;

    expect(stateFor("d1").historyHydration).toBe("error");
    expect(stateFor("d1").historyErrorKind).toBe("request");
    expect(updateUrlWithChatId).toHaveBeenCalledTimes(1);
  });

  it("reloads a background dialogue without changing foreground navigation or composer state", async () => {
    const pendingA = deferred<ApiEnvelope<ChatHistoryRecord[]>>();
    const stateA = getChatState("d1");
    stateA.renderedChat = {
      dialogue_id: "d1",
      messages: [{ role: "assistant", content: "old A" }],
    };
    stateA.historyHydration = "ready";
    const stateB = getChatState("d2");
    stateB.renderedChat = {
      dialogue_id: "d2",
      messages: [{ role: "assistant", content: "B stays visible" }],
    };
    stateB.messageInput = "draft for B";
    stateB.selectedAgent = "AnalystAgent";
    currentChatId.value = "d2";
    mockGetAnswerCheck.mockReturnValueOnce(pendingA.promise);

    const { reloadChat } = makeComposable();
    const reload = reloadChat("d1");

    expect(currentChatId.value).toBe("d2");
    expect(stateFor("d1").renderedChat?.messages[0]?.content).toBe("old A");
    expect(stateFor("d2").messageInput).toBe("draft for B");
    expect(stateFor("d2").selectedAgent).toBe("AnalystAgent");

    pendingA.resolve(
      historyResponse([
        buildChatHistoryRecord({
          id: "updated-a",
          query: "updated question",
          answer: "updated answer",
          tool_name: "ChatAgent",
        }),
      ])
    );
    await expect(reload).resolves.toBe("applied");

    expect(messageAt("d1", 0, "background reloaded A").content).toBe(
      "updated question"
    );
    expect(messageAt("d2", 0, "preserved B").content).toBe("B stays visible");
    expect(currentChatId.value).toBe("d2");
    expect(updateUrlWithChatId).not.toHaveBeenCalled();
    expect(scrollToBottom).not.toHaveBeenCalled();
  });

  it("keeps an in-flight background reload authoritative when the live dialogue is reselected", async () => {
    const pending = deferred<ApiEnvelope<ChatHistoryRecord[]>>();
    const state = getChatState("d1");
    state.renderedChat = {
      dialogue_id: "d1",
      messages: [{ role: "assistant", content: "stale rendered answer" }],
    };
    state.historyHydration = "ready";
    mockGetAnswerCheck.mockReturnValueOnce(pending.promise);

    const { reloadChat, selectChat } = makeComposable();
    const reload = reloadChat("d1");
    await expect(selectChat("d1")).resolves.toBeUndefined();

    expect(mockGetAnswerCheck).toHaveBeenCalledOnce();
    expect(currentChatId.value).toBe("d1");
    expect(updateUrlWithChatId).toHaveBeenCalledOnce();
    expect(scrollToBottom).toHaveBeenCalledOnce();

    pending.resolve(
      historyResponse([
        buildChatHistoryRecord({
          id: "material-update",
          query: "updated question",
          answer: "updated material answer",
          tool_name: "ChatAgent",
        }),
      ])
    );

    await expect(reload).resolves.toBe("applied");
    expect(messageAt("d1", 1, "reselected material reload").content).toBe(
      "updated material answer"
    );
  });

  it("supersedes an in-flight reload when its captured state is rekeyed", async () => {
    const pending = deferred<ApiEnvelope<ChatHistoryRecord[]>>();
    const capturedState = getChatState("d1");
    capturedState.renderedChat = {
      dialogue_id: "d1",
      messages: [{ role: "assistant", content: "preserve moved history" }],
    };
    capturedState.historyHydration = "ready";
    mockGetAnswerCheck.mockReturnValueOnce(pending.promise);

    const { reloadChat } = makeComposable();
    const reload = reloadChat("d1");
    states.set("server-dialogue", capturedState);
    states.delete("d1");

    pending.resolve(
      historyResponse([
        buildChatHistoryRecord({
          query: "stale old-dialogue question",
          answer: "stale old-dialogue answer",
          tool_name: "ChatAgent",
        }),
      ])
    );

    await expect(reload).resolves.toBe("superseded");
    expect(
      renderedFor("server-dialogue", "rekeyed history").messages[0]?.content
    ).toBe("preserve moved history");
  });

  it("does not let an older background reload overwrite a newer reload", async () => {
    const older = deferred<ApiEnvelope<ChatHistoryRecord[]>>();
    const newer = deferred<ApiEnvelope<ChatHistoryRecord[]>>();
    const stateA = getChatState("d1");
    stateA.renderedChat = { dialogue_id: "d1", messages: [] };
    stateA.historyHydration = "ready";
    currentChatId.value = "d2";
    mockGetAnswerCheck
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);

    const { reloadChat } = makeComposable();
    const oldReload = reloadChat("d1");
    const newReload = reloadChat("d1");

    newer.resolve(
      historyResponse([
        buildChatHistoryRecord({
          query: "new question",
          answer: "new answer",
          tool_name: "ChatAgent",
        }),
      ])
    );
    await expect(newReload).resolves.toBe("applied");
    older.resolve(
      historyResponse([
        buildChatHistoryRecord({
          query: "old question",
          answer: "old answer",
          tool_name: "ChatAgent",
        }),
      ])
    );
    await expect(oldReload).resolves.toBe("superseded");

    expect(messageAt("d1", 0, "newer background reload").content).toBe(
      "new question"
    );
    expect(currentChatId.value).toBe("d2");
  });

  it("keeps the rendered background tree ready when a reload request fails", async () => {
    const stateA = getChatState("d1");
    stateA.renderedChat = {
      dialogue_id: "d1",
      messages: [{ role: "assistant", content: "keep this answer" }],
    };
    stateA.historyHydration = "ready";
    currentChatId.value = "d2";
    mockGetAnswerCheck.mockRejectedValueOnce(new Error("network unavailable"));

    const { reloadChat } = makeComposable();
    await expect(reloadChat("d1")).resolves.toBe("failed");

    expect(stateFor("d1").renderedChat?.messages[0]?.content).toBe(
      "keep this answer"
    );
    expect(stateFor("d1").historyHydration).toBe("ready");
    expect(stateFor("d1").historyErrorKind).toBe("request");
    expect(currentChatId.value).toBe("d2");
    expect(updateUrlWithChatId).not.toHaveBeenCalled();
    expect(scrollToBottom).not.toHaveBeenCalled();
  });

  it("keeps the rendered background tree ready when a reload receives a non-200 response", async () => {
    const stateA = getChatState("d1");
    stateA.renderedChat = {
      dialogue_id: "d1",
      messages: [{ role: "assistant", content: "keep this answer" }],
    };
    stateA.historyHydration = "ready";
    mockGetAnswerCheck.mockResolvedValueOnce(
      historyResponse([], { code: 500 })
    );

    await expect(makeComposable().reloadChat("d1")).resolves.toBe("failed");

    expect(stateFor("d1").renderedChat?.messages[0]?.content).toBe(
      "keep this answer"
    );
    expect(stateFor("d1").historyHydration).toBe("ready");
    expect(stateFor("d1").historyErrorKind).toBe("request");
  });

  it("keeps the rendered background tree ready when a reload receives malformed data", async () => {
    const stateA = getChatState("d1");
    stateA.renderedChat = {
      dialogue_id: "d1",
      messages: [{ role: "assistant", content: "keep this answer" }],
    };
    stateA.historyHydration = "ready";
    mockGetAnswerCheck.mockResolvedValueOnce(
      invalidInput<ApiEnvelope<ChatHistoryRecord[]>>({ code: 200, data: null })
    );

    await expect(makeComposable().reloadChat("d1")).resolves.toBe("failed");

    expect(stateFor("d1").renderedChat?.messages[0]?.content).toBe(
      "keep this answer"
    );
    expect(stateFor("d1").historyHydration).toBe("ready");
    expect(stateFor("d1").historyErrorKind).toBe("decode");
  });

  it("updates the still-owned DeepGenome history message after leave and reselect", async () => {
    const fileRead = deferred<string>();
    mockReadServerFile.mockReturnValueOnce(fileRead.promise);
    mockGetAnswerCheck.mockResolvedValueOnce(
      historyResponse([
        buildChatHistoryRecord({
          id: "deep-history",
          query: "Open Deep Genome",
          answer: '{"content":"persisted answer"}',
          tool_name: "DeepGenomeAgent",
          server_file_path: "history/deep.md",
        }),
      ])
    );

    const { selectChat } = makeComposable();
    await selectChat("d1");
    expect(messageAt("d1", 1, "DeepGenome loading").content).toBe(
      "Loading file content..."
    );

    currentChatId.value = "d2";
    await selectChat("d1");
    fileRead.resolve("resolved file content");
    await Promise.resolve();
    await nextTick();

    expect(messageAt("d1", 1, "DeepGenome resolved").content).toBe(
      "resolved file content"
    );
    expect(timestamp.value).toBeGreaterThan(0);
  });

  it("does not update a DeepGenome file callback after a newer owner replaces it", async () => {
    const fileRead = deferred<string>();
    mockReadServerFile.mockReturnValueOnce(fileRead.promise);
    mockGetAnswerCheck
      .mockResolvedValueOnce(
        historyResponse([
          buildChatHistoryRecord({
            id: "deep-stale",
            query: "Old Deep Genome",
            answer: '{"content":"old persisted answer"}',
            tool_name: "DeepGenomeAgent",
            server_file_path: "history/stale.md",
          }),
        ])
      )
      .mockResolvedValueOnce(
        historyResponse([
          buildChatHistoryRecord({
            id: "new-owner",
            query: "New question",
            answer: "New answer",
            tool_name: "ChatAgent",
          }),
        ])
      );

    const { selectChat } = makeComposable();
    await selectChat("d1");
    const state = stateFor("d1");
    state.renderedChat = null;
    await selectChat("d1");
    const updatesAfterReplacement = updateUrlWithChatId.mock.calls.length;
    const scrollsAfterReplacement = scrollToBottom.mock.calls.length;
    const timestampAfterReplacement = timestamp.value;

    fileRead.resolve("stale file content");
    await Promise.resolve();
    await nextTick();

    expect(messageAt("d1", 0, "replacement owner").content).toBe(
      "New question"
    );
    expect(timestamp.value).toBe(timestampAfterReplacement);
    expect(updateUrlWithChatId).toHaveBeenCalledTimes(updatesAfterReplacement);
    expect(scrollToBottom).toHaveBeenCalledTimes(scrollsAfterReplacement);
  });

  it("history AnalystAgent hydrates the existing task_id onto the message", async () => {
    mockGetAnswerCheck.mockResolvedValueOnce(
      historyResponse([
        buildChatHistoryRecord({
          id: "1001",
          query: "run analysis",
          answer: "analysis started",
          tool_name: "AnalystAgent",
          task_id: "ei-task-abc",
          compute_resource: "analyst-agents-small",
        }),
      ])
    );

    const { selectChat } = makeComposable();
    await selectChat("d1");

    const assistant = messageAt("d1", 1, "Analyst history");
    expect(assistant.tool_name).toBe("AnalystAgent");
    expect(assistant.id).toBe("1001");
    expect(assistant.task_id).toBe("ei-task-abc");
  });

  it("hydrates blank nonterminal background agents as discoverable assistant placeholders", async () => {
    mockGetAnswerCheck.mockResolvedValueOnce(
      historyResponse([
        ...[
          "AnalystAgent",
          "DeepGenomeAgent",
          "InSilicoResearchAgent",
          "GeneNetworkAgent",
          "DigitalDesignAgent",
        ].map((tool_name, index) =>
          buildChatHistoryRecord({
            id: String(201 + index),
            answer: "",
            status: "RUNNING",
            tool_name,
          })
        ),
        buildChatHistoryRecord({
          id: "206",
          answer: "",
          status: "RUNNING",
          tool_name: "ChatAgent",
        }),
        buildChatHistoryRecord({
          id: "malformed",
          answer: "",
          status: "RUNNING",
          tool_name: "AnalystAgent",
        }),
        buildChatHistoryRecord({
          id: "207",
          answer: "",
          status: "SUCCEEDED",
          tool_name: "AnalystAgent",
        }),
        buildChatHistoryRecord({
          id: "208",
          answer: "",
          status: "FAILED",
          tool_name: "GeneNetworkAgent",
        }),
        buildChatHistoryRecord({
          id: "209",
          answer: "",
          status: "CANCELLED",
          tool_name: "DigitalDesignAgent",
        }),
      ])
    );

    await makeComposable().selectChat("d1");

    expect(renderedFor("d1", "blank background rows").messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          id: "201",
          tool_name: "AnalystAgent",
          status: "RUNNING",
          content: "",
        }),
        expect.objectContaining({
          role: "assistant",
          id: "202",
          tool_name: "DeepGenomeAgent",
          status: "RUNNING",
          content: "",
        }),
        expect.objectContaining({
          role: "assistant",
          id: "203",
          tool_name: "InSilicoResearchAgent",
          status: "RUNNING",
          content: "",
        }),
        expect.objectContaining({
          role: "assistant",
          id: "204",
          tool_name: "GeneNetworkAgent",
          status: "RUNNING",
          content: "",
        }),
        expect.objectContaining({
          role: "assistant",
          id: "205",
          tool_name: "DigitalDesignAgent",
          status: "RUNNING",
          content: "",
        }),
        expect.objectContaining({
          role: "assistant",
          id: "208",
          tool_name: "GeneNetworkAgent",
          status: "FAILED",
          content: "",
        }),
        expect.objectContaining({
          role: "assistant",
          id: "209",
          tool_name: "DigitalDesignAgent",
          status: "CANCELLED",
          content: "",
        }),
      ])
    );
    expect(
      renderedFor("d1", "blank background rows").messages.map((message) =>
        String(message.id ?? "")
      )
    ).not.toEqual(expect.arrayContaining(["206", "207", "malformed"]));
  });
});
