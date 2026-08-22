import { nextTick } from "vue";
import type { Ref } from "vue";
import type {
  ChatComposerHandle,
  ChatMessage,
  Chat,
  DialogueReconciliationResult,
  ChatUIState,
  ChatView,
} from "../types";
import { normalizeChatContextNotice } from "../types";
import { ElMessage, ElMessageBox } from "element-plus";
import i18n from "@/locales";
import {
  decodeCitationDocuments,
  decodeTableDataInput,
  convertToTableData,
  optionalStringValue,
  parseAgentAnswer,
} from "../utils/format";
import { readServerFile } from "../utils/agent-log";
import {
  writePendingChat,
  isLocalStorageChat,
  upsertPendingChatListEntry,
  clearPendingChat,
  removePendingChatListEntry,
} from "@/utils/pending-chat";
import { isNetworkError } from "@/utils/network-error";
import { getQueryAbortable, getAnswerCheck, type QueryData } from "@/api/chat";
import { normalizePositiveTaskRowId } from "@/api/task";
import { shouldStream } from "../streaming/sendBranch";
import { useStreamMessage } from "./useStreamMessage";
import { createChatRequestKey } from "../utils/chat-request-key";
import {
  clientTurnDraftFingerprint,
  clientTurnDraftFingerprintMatches,
  createClientTurnId,
  isDefinitePreDispatch4xx,
} from "../utils/client-turn-id";
import { parentRowIdForDialogue } from "../utils/chat-parent-row";
import { parseBotProjection } from "../botProjection";
import { decodeA2uiOpenSurface } from "../streaming/a2uiParse";
import { createFetchA2uiTransport } from "../streaming/a2uiAction";
import { getToken } from "@/utils/auth";
import { CANONICAL_AGENT_TOOLS } from "@/constants/agents";
import {
  progressConfigFor,
  remainingCotFlushMs,
  rememberProgressStartedAt,
} from "../utils/agentProgress";
import { isRecord, isSuccessfulDataEnvelope } from "@/api/contracts";
import {
  chatContentToText,
  decodeAgentSteps,
  decodeFollowUpQuestions,
  messagePlainText,
} from "../messageTypes";
import {
  completedUploadDisplays,
  toAssetAttachmentRefs,
} from "../utils/asset-attachments";
import { queryWithinLimit } from "../utils/research-input-policy";
import {
  MAX_CONVERSATION_HISTORY_MESSAGES,
  projectHistoryForTransport,
} from "../utils/chat-history-normalization";
import type {
  BotCapabilityByTool,
  BotResearchInputCapability,
} from "./useBotCapabilities";

const CANONICAL_TOOL_SET = new Set<string>(CANONICAL_AGENT_TOOLS);
const ACCEPTED_EMPTY_BACKGROUND_TOOLS = new Set([
  "GeneNetworkAgent",
  "DigitalDesignAgent",
  "InSilicoResearchAgent",
]);
const SAFE_WEB_REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

type ChatUserStore = {
  FedLogOut: () => Promise<unknown>;
};

function isCanonicalToolName(value: unknown): value is string {
  return typeof value === "string" && CANONICAL_TOOL_SET.has(value);
}

function safeWebRequestID(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return SAFE_WEB_REQUEST_ID_PATTERN.test(normalized) ? normalized : undefined;
}

function hasDurableRowId(value: unknown): boolean {
  if (typeof value === "string") return value.trim() !== "";
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isDurableSelectingWait(data: QueryData): boolean {
  const toolName =
    typeof data.tool_name === "string" ? data.tool_name.trim() : "";
  if (toolName !== "") return false;
  const status =
    typeof data.status === "string" ? data.status.trim().toUpperCase() : "";
  if (status !== "RUNNING" && status !== "SUBMITTING") return false;
  try {
    normalizePositiveTaskRowId(data.id ?? "");
    return true;
  } catch {
    return false;
  }
}

function clearPendingTurnIdentity(
  chatState: ChatUIState,
  clientTurnId: string,
  draftFingerprint: string
): void {
  if (
    chatState.pendingTurnId === clientTurnId &&
    chatState.pendingTurnFingerprint !== null &&
    clientTurnDraftFingerprintMatches(
      chatState.pendingTurnFingerprint,
      draftFingerprint
    )
  ) {
    chatState.pendingTurnId = null;
    chatState.pendingTurnFingerprint = null;
  }
}

function settlePendingTurnIdentity(
  chatState: ChatUIState,
  clientTurnId: string,
  draftFingerprint: string,
  durableRowId: unknown
): void {
  if (!hasDurableRowId(durableRowId)) return;
  clearPendingTurnIdentity(chatState, clientTurnId, draftFingerprint);
}

function isAcceptedExpertResponse(
  expertSucceeded: boolean,
  projection: ReturnType<typeof parseBotProjection> | undefined
): boolean {
  if (expertSucceeded) return true;
  return projection?.runId !== null && projection?.status === "RUNNING";
}

function persistedMessageIds(messages: readonly ChatMessage[]): Set<string> {
  return new Set(
    messages.flatMap((message) =>
      typeof message.id === "string" && message.id.trim() !== ""
        ? [message.id]
        : []
    )
  );
}

function isHistoryMessage(value: unknown): value is ChatMessage {
  return (
    isRecord(value) &&
    (value.role === "user" || value.role === "assistant") &&
    Object.prototype.hasOwnProperty.call(value, "content")
  );
}

function historyText(message: ChatMessage): string {
  return messagePlainText(message);
}

function historyAttachments(message: ChatMessage) {
  const attachments = message.attachments
    ?.map((attachment) => ({ ...attachment }))
    .filter(({ asset_id }) => asset_id !== "");
  return attachments && attachments.length > 0 ? attachments : undefined;
}

function commitSuccessfulTurn(
  chatState: ChatUIState,
  userMessage: ChatMessage,
  assistantMessage: ChatMessage
): void {
  const status = (assistantMessage.status ?? "").trim().toUpperCase();
  if (status !== "" && status !== "SUCCEEDED") return;

  const userContent = historyText(userMessage);
  const assistantContent = historyText(assistantMessage);
  if (!userContent || !assistantContent) return;

  const prior = (
    Array.isArray(chatState.historyQuestion)
      ? chatState.historyQuestion.filter(isHistoryMessage)
      : []
  ).flatMap((message) => {
    const content = historyText(message);
    const attachments = historyAttachments(message);
    return content
      ? [
          {
            role: message.role,
            content,
            ...(attachments ? { attachments } : {}),
          },
        ]
      : [];
  });
  chatState.historyQuestion = [
    ...prior,
    {
      role: "user",
      content: userContent,
      ...(historyAttachments(userMessage)
        ? { attachments: historyAttachments(userMessage) }
        : {}),
    },
    { role: "assistant", content: assistantContent },
  ].slice(-MAX_CONVERSATION_HISTORY_MESSAGES);
}

function parseBlockingProjection(data: QueryData) {
  const payload =
    data.answer === undefined && data.final_answer !== undefined
      ? { ...data, answer: data.final_answer }
      : data;
  try {
    return parseBotProjection(payload);
  } catch {
    // Legacy responses may contain fields outside the projection contract. Do
    // not copy an unvalidated envelope into the reactive message state.
    return undefined;
  }
}

function reviewAnswerText(data: QueryData): string {
  const answer = data.answer ?? data.final_answer;
  if (typeof answer !== "string") return "";

  const parsed = parseAgentAnswer(answer);
  const content = optionalStringValue(parsed, "content");
  if (content !== undefined) return content;
  return Object.keys(parsed).length === 0 ? answer : "";
}

function normalizeCompletedReviewBlockingProjection(
  data: QueryData,
  projection: ReturnType<typeof parseBotProjection> | undefined
) {
  if (!projection || projection.status !== "INPUT_REQUIRED") return projection;
  const agent = projection.agent.trim().toLowerCase();
  if (
    (agent !== "review" && agent !== "reviewagent") ||
    reviewAnswerText(data).trim() === ""
  ) {
    return projection;
  }
  return { ...projection, status: "SUCCEEDED" as const };
}

const EXPERT_RUN_ID_KEYS = ["bot_run_id", "run_id", "runId"] as const;
const EXPERT_PROJECTION_KEYS = ["projection", "result", "data"] as const;

function isProjectionRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.prototype.toString.call(value) === "[object Object]"
  );
}

function hasMalformedExpertRunIdentity(value: unknown): boolean {
  if (!isProjectionRecord(value)) return false;
  const sources: Record<string, unknown>[] = [value];
  const seen = new Set<Record<string, unknown>>(sources);
  for (const key of EXPERT_PROJECTION_KEYS) {
    const nested = value[key];
    if (isProjectionRecord(nested) && !seen.has(nested)) {
      sources.push(nested);
      seen.add(nested);
    }
  }

  for (const source of sources) {
    for (const key of EXPERT_RUN_ID_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
      const raw = source[key];
      if (raw === undefined || raw === null || raw === "") continue;
      if (typeof raw !== "string") return true;
      const trimmed = raw.trim();
      if (
        Array.from(raw).length > 128 ||
        raw.includes("\u0000") ||
        /[\r\n\t]/u.test(raw) ||
        /[\\/]/u.test(trimmed) ||
        trimmed === ""
      ) {
        return true;
      }
    }
  }
  return false;
}

const SAFE_DIALOGUE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;

function attachBlockingLegacyFields(
  message: ChatMessage,
  data: QueryData,
  resultArchiveV1: boolean
): void {
  if (typeof data.task_id === "string" && data.task_id.trim() !== "") {
    message.task_id = data.task_id;
  }
  if (
    !resultArchiveV1 &&
    typeof data.download_path === "string" &&
    data.download_path.trim() !== ""
  ) {
    message.download_path = data.download_path;
  }
  if (data.delivery) message.delivery = { ...data.delivery };
  if (Array.isArray(data.artifacts)) {
    message.artifacts = data.artifacts.map((artifact) => ({ ...artifact }));
  }
}

function stripActiveArchiveLegacyFields(
  message: ChatMessage,
  resultArchiveV1: boolean
): void {
  if (!resultArchiveV1) return;
  delete message.download_path;
  delete message.upload_path;
  delete message.server_file_path;
  delete message.original;
}

function attachBlockingA2ui(
  message: ChatMessage,
  data: QueryData,
  projection: ReturnType<typeof parseBotProjection> | undefined
): void {
  if (
    !projection ||
    projection.status !== "INPUT_REQUIRED" ||
    data.a2ui === undefined ||
    data.a2ui === null
  ) {
    return;
  }

  const decoded = decodeA2uiOpenSurface(data.a2ui);
  if (!decoded.ok) return;

  message.blocks = [
    {
      type: "agent-surface",
      authority: "agent",
      interactive: true,
      a2ui: {
        surface: decoded.value,
        state: { status: "ready", round: 1 },
      },
    },
  ];

  const runId = projection.runId;
  const dialogueId = data.dialogue_id?.trim() ?? "";
  const messageId =
    data.id === undefined || data.id === null ? "" : String(data.id);
  if (
    !runId ||
    !SAFE_DIALOGUE_ID_PATTERN.test(dialogueId) ||
    !/^[1-9]\d*$/u.test(messageId)
  ) {
    return;
  }

  message.a2uiRuntime = {
    dialogueId,
    messageId,
    runId,
    transport: createFetchA2uiTransport({
      conversationId: dialogueId,
      getToken,
      acceptLanguage: i18n.global.locale.value,
    }),
  };
}

export function useSendMessage(opts: {
  getChatState: (dialogueId: string) => ChatUIState;
  currentChatId: Ref<string>;
  currentChat: Ref<ChatView | null>;
  composerRef: Ref<ChatComposerHandle | null>;
  t: (key: string) => string;
  userStore: () => ChatUserStore;
  getHistoryQuestionData: (
    sendingDialogueId?: string,
    options?: { blockingDialogueId?: string }
  ) =>
    | Promise<DialogueReconciliationResult | undefined>
    | DialogueReconciliationResult
    | undefined;
  reconcileDialogueIdentity: (
    tempId: string,
    serverId: string
  ) => DialogueReconciliationResult;
  chatList: Ref<Chat[]>;
  timestamp: Ref<number>;
  selectChat: (dialogueId: string) => Promise<void> | void;
  scrollToBottom: () => Promise<void>;
  attachmentTargetBlocked?: Readonly<Ref<boolean>>;
  researchInputCapability: Readonly<Ref<BotResearchInputCapability>>;
  botCapabilitiesByTool: Readonly<Ref<BotCapabilityByTool>>;
}) {
  const {
    getChatState,
    currentChatId,
    currentChat,
    composerRef,
    t,
    userStore,
    getHistoryQuestionData,
    reconcileDialogueIdentity,
    chatList,
    timestamp,
    selectChat,
    scrollToBottom,
    attachmentTargetBlocked,
    researchInputCapability,
    botCapabilitiesByTool,
  } = opts;

  const isForeground = (sendingDialogueId: string) =>
    currentChatId.value === sendingDialogueId;

  const sendMessage = async () => {
    if (!currentChatId.value || attachmentTargetBlocked?.value) return;

    const sendingDialogueId = currentChatId.value;
    const chatState = getChatState(sendingDialogueId);
    if (
      !chatState ||
      !chatState.messageInput.trim() ||
      chatState.isSending ||
      chatState.activeRequestId
    )
      return;

    const capturedMode = chatState.mode;
    const capturedSelectedAgent =
      capturedMode === "expert" ? chatState.selectedAgent : "";
    const capturedActiveAgentName =
      capturedMode === "instant" ? "ChatAgent" : capturedSelectedAgent;
    const currentMessage = chatState.messageInput;
    if (!currentMessage.trim()) return;
    if (
      capturedMode === "expert" &&
      capturedSelectedAgent === "InSilicoResearchAgent"
    ) {
      const limit = researchInputCapability.value.max_user_query_chars;
      if (limit > 0 && !queryWithinLimit(currentMessage, limit)) {
        ElMessage.warning(t("agents.research.questionTooLong"));
        return;
      }
    }

    // Capture parent row, completed asset references, mode, history, and request
    // key before any await so an A→B switch during scrollToBottom cannot
    // retarget the payload.
    const parentRowId = parentRowIdForDialogue(
      sendingDialogueId,
      chatList.value
    );
    const capturedUploads = [...chatState.fileList];
    const capturedAttachments = completedUploadDisplays(capturedUploads);
    if (capturedAttachments === null) {
      return;
    }
    const attachmentRefs = toAssetAttachmentRefs(capturedUploads);
    const capturedHistory = chatState.historyQuestion;
    const requestKey = createChatRequestKey();

    chatState.isSending = true;
    chatState.generationStopped = false;
    chatState.activeRequestId = requestKey;
    chatState.sendStartedAt = Date.now();
    rememberProgressStartedAt(sendingDialogueId, chatState.sendStartedAt);
    chatState.activeAgentName = capturedActiveAgentName;
    chatState.completing = false;
    chatState.messageInput = "";

    const isNewChat = (() => {
      if (!chatState.renderedChat) {
        if (
          currentChatId.value === sendingDialogueId &&
          currentChat.value?.messages
        ) {
          chatState.renderedChat = currentChat.value;
        } else {
          chatState.renderedChat = { messages: [] };
        }
      }
      return chatState.renderedChat.messages.length === 0;
    })();
    // Keep the shell currentChat view in sync when this dialogue is focused
    // (production computed setter writes the same object; test harnesses may
    // still pass a separate ref).
    if (currentChatId.value === sendingDialogueId) {
      currentChat.value = chatState.renderedChat;
    }
    const preRequestHistoryIds = persistedMessageIds(
      chatState.renderedChat.messages
    );

    // Keep the user-visible/persisted query exactly as authored. Attachment
    // metadata is carried separately as bounded asset references.
    const userMessage = {
      role: "user",
      content: currentMessage,
      attachments:
        capturedAttachments.length > 0 ? [...capturedAttachments] : undefined,
    };

    const sendingMessages = chatState.renderedChat.messages;
    sendingMessages.push(userMessage);

    const sendingTitle = currentMessage;
    let blockingDialogueId: string | undefined;
    let acceptedTurn = false;
    let identityReconciliation: DialogueReconciliationResult | undefined;

    if (parentRowId === null) {
      // Hard no-send: missing/ambiguous existing parent mapping.
      sendingMessages.push({
        role: "assistant",
        content: t("chat.sendFailed"),
        steps: [],
        status: "",
        upload_path: "",
        download_path: "",
        instantMessage: true,
        tool_name: "",
        followUpQuestions: [],
        showFollowUpQuestions: false,
        showLog: false,
      });
      if (chatState.activeRequestId === requestKey) {
        chatState.activeRequestId = "";
        chatState.isSending = false;
        chatState.sendStartedAt = null;
        chatState.completing = false;
        chatState.activeAgentName = "";
        chatState.generationStopped = false;
      }
      if (isForeground(sendingDialogueId)) {
        await scrollToBottom();
      }
      return;
    }

    const draftFingerprint = clientTurnDraftFingerprint({
      parentRowId,
      operation: "append",
      mode: capturedMode,
      selectedAgent: capturedSelectedAgent,
      query: currentMessage,
      attachments: attachmentRefs.map(({ asset_id }) => asset_id),
    });
    const clientTurnId =
      chatState.pendingTurnFingerprint !== null &&
      clientTurnDraftFingerprintMatches(
        chatState.pendingTurnFingerprint,
        draftFingerprint
      ) &&
      chatState.pendingTurnId
        ? chatState.pendingTurnId
        : createClientTurnId();
    chatState.pendingTurnId = clientTurnId;
    chatState.pendingTurnFingerprint = draftFingerprint;

    const discardRejectedLocalDraft = (): void => {
      clearPendingTurnIdentity(chatState, clientTurnId, draftFingerprint);
      if (isLocalStorageChat(sendingDialogueId)) {
        clearPendingChat(sendingDialogueId);
        removePendingChatListEntry(chatList.value, sendingDialogueId);
      }
    };

    const settleAcceptedTurn = (
      assistantMessage: ChatMessage,
      acceptedExpertResponse: boolean
    ): void => {
      if (capturedMode === "expert" && !acceptedExpertResponse) return;
      const durableRowId = assistantMessage.id;
      if (!hasDurableRowId(durableRowId)) return;
      settlePendingTurnIdentity(
        chatState,
        clientTurnId,
        draftFingerprint,
        durableRowId
      );
    };

    if (isNewChat && isLocalStorageChat(sendingDialogueId)) {
      const pendingMessages = sendingMessages as unknown as Array<{
        role: string;
        content: string;
        [key: string]: unknown;
      }>;
      writePendingChat(sendingDialogueId, pendingMessages, {
        title: sendingTitle,
        mode: capturedMode,
        onError: () => {
          if (isForeground(sendingDialogueId)) {
            ElMessage.warning(t("chat.pendingWriteFailed"));
          }
        },
      });
      upsertPendingChatListEntry(
        chatList.value,
        sendingDialogueId,
        sendingTitle
      );
    }

    if (isForeground(sendingDialogueId)) {
      await scrollToBottom();
    }

    try {
      const queryData = new FormData();
      queryData.append("query", currentMessage);
      queryData.append("id", parentRowId.toString());
      queryData.append(
        "tool",
        capturedMode === "expert" ? capturedSelectedAgent : ""
      );
      queryData.append("mode", capturedMode);
      queryData.append("client_turn_id", clientTurnId);
      if (capturedHistory) {
        queryData.append(
          "history",
          JSON.stringify(projectHistoryForTransport(capturedHistory))
        );
      }
      queryData.append("attachments", JSON.stringify(attachmentRefs));

      // Stream branch: chat-family + the mode that can route that agent.
      // Insertion is inside the existing try, so returning here still runs
      // the enclosing finally exactly once.
      const streamAgents = Object.values(botCapabilitiesByTool.value).flatMap(
        (capability) =>
          capability?.enabled && capability.stream ? [capability.tool] : []
      );
      if (
        shouldStream(capturedActiveAgentName, capturedMode, {
          agents: streamAgents,
        })
      ) {
        const placeholder: ChatMessage = {
          role: "assistant",
          content: "",
          streaming: true,
          blocks: [],
          instantMessage: false,
          tool_name: capturedActiveAgentName,
          followUpQuestions: [],
          showFollowUpQuestions: false,
          showLog: false,
          // Runtime-only Activity identity — reuse the captured request key.
          streamPresentationKey: requestKey,
        };
        sendingMessages.push(placeholder);
        const streamPlaceholder =
          sendingMessages[sendingMessages.length - 1] ?? placeholder;
        // Bind stream lookups to the captured state object so a post-rekey
        // getChatState(oldTempId) cannot resurrect an empty temp record.
        const getStreamChatState = (id: string) =>
          id === sendingDialogueId ? chatState : getChatState(id);
        const { streamMessage } = useStreamMessage({
          getChatState: getStreamChatState,
          t,
        });
        const streamResult = await streamMessage({
          dialogueId: sendingDialogueId,
          formData: queryData,
          requestId: requestKey,
          placeholder: streamPlaceholder,
          clientTurnId,
          onIdentity: ({ dialogueId }) => {
            if (chatState.activeRequestId !== requestKey) return;
            blockingDialogueId = dialogueId;
            if (identityReconciliation) return;
            identityReconciliation = reconcileDialogueIdentity(
              sendingDialogueId,
              dialogueId
            );
            void Promise.resolve()
              .then(() => getHistoryQuestionData())
              .catch(() => undefined);
          },
        });
        if (
          chatState.activeRequestId === requestKey &&
          streamResult.dialogueId
        ) {
          blockingDialogueId = streamResult.dialogueId;
        }
        if (
          chatState.activeRequestId === requestKey &&
          streamResult.contextNotice?.context_degraded === true
        ) {
          ElMessage.warning(t("chat.contextDegraded"));
        }
        if (
          chatState.activeRequestId === requestKey &&
          !chatState.generationStopped &&
          streamResult.completed === true
        ) {
          acceptedTurn = true;
          commitSuccessfulTurn(chatState, userMessage, streamPlaceholder);
          if (streamResult.messageId) {
            settlePendingTurnIdentity(
              chatState,
              clientTurnId,
              draftFingerprint,
              streamResult.messageId
            );
          }
        }
        if (
          chatState.activeRequestId === requestKey &&
          streamResult.preDispatch4xx
        ) {
          discardRejectedLocalDraft();
        }
        return;
      }

      const response = await getQueryAbortable(queryData, requestKey);

      // On response: first fast-animate the progress bar to 100% (CSS 300ms), then swap in the answer.
      if (!chatState.generationStopped) {
        chatState.completing = true;
        const elapsed =
          chatState.sendStartedAt == null
            ? 0
            : Math.max(0, Date.now() - chatState.sendStartedAt);
        const flushMs = remainingCotFlushMs(
          elapsed,
          progressConfigFor(chatState.activeAgentName)
        );
        await new Promise((resolve) =>
          setTimeout(resolve, Math.max(300, flushMs))
        );
      }

      // The runtime interceptor returns code 200 for decoded success envelopes;
      // the shared guard preserves only the established `{ data }` shape
      // without `code` and rejects explicit non-success envelopes.
      if (isSuccessfulDataEnvelope<QueryData>(response)) {
        const responseData = response.data;
        const parsedBotProjection = parseBlockingProjection(responseData);
        const botProjection = normalizeCompletedReviewBlockingProjection(
          responseData,
          parsedBotProjection
        );
        const completedReviewAnswer =
          parsedBotProjection?.status === "INPUT_REQUIRED" &&
          botProjection?.status === "SUCCEEDED";
        const resultArchiveV1 =
          botProjection?.resultArchiveV1 === true ||
          responseData.result_archive_v1 === true;
        const expertSucceeded =
          botProjection?.status === "SUCCEEDED" ||
          (botProjection === undefined &&
            typeof responseData.status === "string" &&
            responseData.status.trim().toUpperCase() === "SUCCEEDED");
        const acceptedExpertResponse =
          isDurableSelectingWait(responseData) ||
          isAcceptedExpertResponse(expertSucceeded, botProjection);
        if (
          capturedMode === "expert" &&
          !isDurableSelectingWait(responseData) &&
          (!isCanonicalToolName(responseData.tool_name) ||
            (botProjection && botProjection.agent !== responseData.tool_name) ||
            hasMalformedExpertRunIdentity(responseData) ||
            (!expertSucceeded && (!botProjection || !botProjection.runId)))
        ) {
          // Expert responses must have crossed the Go canonical projection
          // boundary. Unknown or malformed envelopes use the existing send
          // failure path instead of entering reactive message state.
          throw new Error("invalid expert response projection");
        }
        if (
          chatState.activeRequestId === requestKey &&
          typeof responseData.dialogue_id === "string" &&
          responseData.dialogue_id !== ""
        ) {
          blockingDialogueId = responseData.dialogue_id;
        }
        let assistantMessage: ChatMessage | undefined;
        if (response.data.final_answer) {
          assistantMessage = {
            role: "assistant",
            content:
              response.data.final_answer ||
              "Sorry, I cannot answer this question.",
            steps: decodeAgentSteps(response.data.steps),
            status: response.data?.status || "",
            upload_path: response.data?.upload_path || "",
            instantMessage: true,
            id: response.data.id,
            followUpQuestions: decodeFollowUpQuestions(
              response.data.follow_up_questions
            ),
            showFollowUpQuestions: false,
            showLog: false,
          };

          // sync the reaction state of the new message
          if (response.data.id && response.data.reaction_type) {
            chatState.reactions[response.data.id.toString()] = parseInt(
              response.data.reaction_type
            );
          }
        } else {
          if (response.data.tool_name) {
            if (response.data.tool_name === "ChatAgent") {
              assistantMessage = {
                role: "assistant",
                content: response.data.answer,
                status: response.data?.status || "",
                upload_path: response.data?.upload_path || "",
                instantMessage: true,
                tool_name: response.data.tool_name,
                id: response.data.id,
                followUpQuestions: decodeFollowUpQuestions(
                  response.data.follow_up_questions
                ),
                showFollowUpQuestions: false,
                showLog: false,
              };

              // sync the reaction state of the new message
              if (response.data.id && response.data.reaction_type) {
                chatState.reactions[response.data.id.toString()] = parseInt(
                  response.data.reaction_type
                );
              }
            } else if (response.data.tool_name === "DeepGenomeAgent") {
              const contentData = parseAgentAnswer(response.data.answer);
              assistantMessage = {
                role: "assistant",
                content:
                  optionalStringValue(contentData, "content") ||
                  response.data.answer,
                doc_list: decodeCitationDocuments(contentData.doc_list),
                status: response.data?.status || "",
                upload_path: response.data?.upload_path || "",
                instantMessage: true,
                tool_name: response.data.tool_name,
                id: response.data.id,
                followUpQuestions: decodeFollowUpQuestions(
                  response.data.follow_up_questions
                ),
                showFollowUpQuestions: false,
                showLog: false,
                server_file_path: response.data.server_file_path, // add the server file path
              };

              // if there is a server file path, read the file content asynchronously
              if (response.data.server_file_path) {
                // show a loading state first
                if (assistantMessage) {
                  assistantMessage.content = "Loading file content...";
                }

                readServerFile(response.data.server_file_path)
                  .then((fileContent) => {
                    if (fileContent && fileContent.trim() && assistantMessage) {
                      assistantMessage.content = fileContent;
                    } else if (assistantMessage) {
                      assistantMessage.content =
                        "File content is empty or failed to load";
                    }
                    // force a view update (foreground only — do not bump shared
                    // timestamp / scroll while the user is on another dialogue)
                    nextTick(() => {
                      if (isForeground(sendingDialogueId)) {
                        timestamp.value = Date.now();
                        scrollToBottom().catch(() => undefined);
                      }
                    }).catch(() => undefined);
                  })
                  .catch((error) => {
                    console.error(
                      "Failed to read DeepGenomeAgent file:",
                      error
                    );
                    if (assistantMessage) {
                      assistantMessage.content =
                        "Failed to load file, please try again later";
                    }
                    nextTick(() => {
                      if (isForeground(sendingDialogueId)) {
                        timestamp.value = Date.now();
                        scrollToBottom().catch(() => undefined);
                      }
                    }).catch(() => undefined);
                  });
              }

              // sync the reaction state of the new message
              if (response.data.id && response.data.reaction_type) {
                chatState.reactions[response.data.id.toString()] = parseInt(
                  response.data.reaction_type
                );
              }
            } else if (
              response.data.tool_name === "KnowledgeAgent" ||
              response.data.tool_name === "ReviewAgent" ||
              response.data.tool_name === "BriefGeneAgent"
            ) {
              const contentData = parseAgentAnswer(response.data.answer);
              // log the new message's doc_list data
              assistantMessage = {
                role: "assistant",
                content:
                  optionalStringValue(contentData, "content") ||
                  response.data.answer,
                doc_list: decodeCitationDocuments(contentData.doc_list),
                status: response.data?.status || "",
                upload_path: response.data?.upload_path || "",
                instantMessage: true,
                tool_name: response.data.tool_name,
                id: response.data.id,
                followUpQuestions: decodeFollowUpQuestions(
                  response.data.follow_up_questions
                ),
                showFollowUpQuestions: false,
                showLog: false,
              };

              // sync the reaction state of the new message
              if (response.data.id && response.data.reaction_type) {
                chatState.reactions[response.data.id.toString()] = parseInt(
                  response.data.reaction_type
                );
              }
            } else if (response.data.tool_name === "DataAgent") {
              const contentData = parseAgentAnswer(response.data.answer);
              const tableInput = decodeTableDataInput(contentData);
              const tableData = convertToTableData(tableInput);
              assistantMessage = {
                role: "assistant",
                content: tableData,
                tableHeaders: tableInput.headers.map((header: string) => ({
                  prop: header.replace(/\s+/g, "_").toLowerCase(),
                  label: header,
                })),
                status: response.data?.status || "",
                upload_path: response.data?.upload_path || "",
                instantMessage: true,
                original: response.data.answer,
                tool_name: response.data.tool_name,
                id: response.data.id,
                followUpQuestions: decodeFollowUpQuestions(
                  response.data.follow_up_questions
                ),
                showFollowUpQuestions: false,
                showLog: false,
              };

              // sync the reaction state of the new message
              if (response.data.id && response.data.reaction_type) {
                chatState.reactions[response.data.id.toString()] = parseInt(
                  response.data.reaction_type
                );
              }
            } else if (response.data.tool_name === "AnalystAgent") {
              assistantMessage = {
                role: "assistant",
                content: response.data.answer,
                status: response.data?.status || "",
                upload_path: response.data?.upload_path || "",
                instantMessage: true,
                tool_name: response.data.tool_name,
                id: response.data.id,
                followUpQuestions: decodeFollowUpQuestions(
                  response.data.follow_up_questions
                ),
                showFollowUpQuestions: false,
                showLog: false,
                compute_resource: response.data?.compute_resource || "",
              };

              // sync the reaction state of the new message
              if (response.data.id && response.data.reaction_type) {
                chatState.reactions[response.data.id.toString()] = parseInt(
                  response.data.reaction_type
                );
              }
            } else {
              // handle other unknown tool types with the default format
              const acceptedSpecializedBackground =
                acceptedExpertResponse &&
                ACCEPTED_EMPTY_BACKGROUND_TOOLS.has(response.data.tool_name);
              assistantMessage = {
                role: "assistant",
                content:
                  response.data?.answer ||
                  (acceptedSpecializedBackground
                    ? ""
                    : "Sorry, I cannot answer this question."),
                status: response.data?.status || "",
                upload_path: response.data?.upload_path || "",
                download_path: response.data?.download_path || "",
                instantMessage: true,
                tool_name: response.data.tool_name,
                id: response.data.id,
                followUpQuestions: decodeFollowUpQuestions(
                  response.data.follow_up_questions
                ),
                showFollowUpQuestions: false,
                showLog: false,
              };

              // sync the reaction state of the new message
              if (response.data.id && response.data.reaction_type) {
                chatState.reactions[response.data.id.toString()] = parseInt(
                  response.data.reaction_type
                );
              }
            }
          } else {
            assistantMessage = {
              role: "assistant",
              content: response.data.answer,
              status: response.data?.status || "",
              upload_path: response.data?.upload_path || "",
              download_path: response.data?.download_path || "",
              instantMessage: true,
              tool_name: response.data?.tool_name || "",
              id: response.data.id,
              followUpQuestions: decodeFollowUpQuestions(
                response.data.follow_up_questions
              ),
              showFollowUpQuestions: false,
              showLog: false,
            };
          }
        }

        const contextNotice = normalizeChatContextNotice(response.data);
        if (assistantMessage) {
          if (completedReviewAnswer) assistantMessage.status = "SUCCEEDED";
          if (contextNotice) assistantMessage.contextNotice = contextNotice;
          if (response.data.route_reason_code) {
            assistantMessage.route_reason_code =
              response.data.route_reason_code;
          }
          attachBlockingLegacyFields(
            assistantMessage,
            responseData,
            resultArchiveV1
          );
          stripActiveArchiveLegacyFields(assistantMessage, resultArchiveV1);
          // Keep the Web row id and Bot umbrella identity in distinct fields;
          // only the parser output crosses into reactive message state.
          if (botProjection) {
            assistantMessage.botProjection = botProjection;
            attachBlockingA2ui(assistantMessage, responseData, botProjection);
          }
        }

        // ensure assistantMessage was created to avoid pushing undefined.
        // Ownership: Stop without resend leaves generationStopped while
        // activeRequestId may still equal requestKey until finally; Stop then
        // resend replaces activeRequestId. Skip append in both cases.
        const ownsResponse =
          chatState.activeRequestId === requestKey &&
          !chatState.generationStopped;
        if (!ownsResponse) {
          // stale / stopped — finally still clears when this key owns
        } else if (assistantMessage) {
          sendingMessages.push(assistantMessage);
          commitSuccessfulTurn(chatState, userMessage, assistantMessage);
          acceptedTurn = capturedMode !== "expert" || acceptedExpertResponse;
          if (responseData.context_degraded === true) {
            ElMessage.warning(t("chat.contextDegraded"));
          }
          settleAcceptedTurn(assistantMessage, acceptedExpertResponse);
        } else {
          // if assistantMessage was not created, create a default message
          console.warn(
            "assistantMessage was not created; using a default message"
          );
          assistantMessage = {
            role: "assistant",
            content:
              response.data?.answer || "Sorry, I cannot answer this question.",
            status: response.data?.status || "",
            upload_path: response.data?.upload_path || "",
            download_path: response.data?.download_path || "",
            instantMessage: true,
            tool_name: response.data?.tool_name || "",
            id: response.data?.id,
            followUpQuestions: [],
            showFollowUpQuestions: false,
            showLog: false,
          };
          if (contextNotice) assistantMessage.contextNotice = contextNotice;
          if (response.data?.route_reason_code) {
            assistantMessage.route_reason_code =
              response.data.route_reason_code;
          }
          attachBlockingLegacyFields(
            assistantMessage,
            responseData,
            resultArchiveV1
          );
          stripActiveArchiveLegacyFields(assistantMessage, resultArchiveV1);
          if (botProjection) {
            assistantMessage.botProjection = botProjection;
            attachBlockingA2ui(assistantMessage, responseData, botProjection);
          }
          sendingMessages.push(assistantMessage);
          commitSuccessfulTurn(chatState, userMessage, assistantMessage);
          acceptedTurn = capturedMode !== "expert" || acceptedExpertResponse;
          settleAcceptedTurn(assistantMessage, acceptedExpertResponse);
        }
      } else {
        throw new Error("invalid response envelope");
      }
    } catch (error: unknown) {
      console.error(t("chat.logs.sendMessageFailed"), error);

      const errorRecord = isRecord(error) ? error : undefined;
      const response =
        errorRecord && isRecord(errorRecord.response)
          ? errorRecord.response
          : undefined;
      const responseData =
        response && isRecord(response.data) ? response.data : undefined;
      const detail =
        responseData && isRecord(responseData.detail)
          ? responseData.detail
          : undefined;

      // check whether the request was aborted
      if (
        errorRecord?.name === "AbortError" ||
        errorRecord?.code === "ERR_CANCELED" ||
        chatState.generationStopped
      ) {
        return; // don't show an error message when the request is aborted
      }

      // A newer same-dialogue send owns the key — do not mutate this dialogue's
      // messages or steal focus for a stale failure.
      if (chatState.activeRequestId !== requestKey) {
        return;
      }

      if (isDefinitePreDispatch4xx(error)) {
        discardRejectedLocalDraft();
      }

      // check whether it's a token-expired error
      if (detail?.code === 403) {
        // Modal only when foreground — background must not steal focus on B.
        if (isForeground(sendingDialogueId)) {
          ElMessageBox.alert(
            i18n.global.t("common.sessionExpired"),
            i18n.global.t("common.notice"),
            {
              confirmButtonText: i18n.global.t("request.confirmButtonText"),
              type: "warning",
              callback: () => {
                const UserStore = userStore();
                UserStore.FedLogOut()
                  .finally(() => {
                    // clear all caches and cookies
                    localStorage.clear();
                    sessionStorage.clear();
                    document.cookie.split(";").forEach(function (c) {
                      document.cookie = c
                        .replace(/^ +/, "")
                        .replace(
                          /=.*/,
                          "=;expires=" + new Date().toUTCString() + ";path=/"
                        );
                    });
                    location.href = "/login";
                  })
                  .catch(() => {
                    // The redirect in finally is the authoritative logout fallback.
                  });
              },
            }
          ).catch(() => undefined);
        }
        return;
      }

      // check for a network/timeout error; if so, first verify whether the message was sent successfully
      if (isNetworkError(error) && !chatState.generationStopped) {
        try {
          // wait a short while to give the server time to process the request
          await new Promise((resolve) => setTimeout(resolve, 1000));

          const ownsActiveRequest = () =>
            chatState.activeRequestId === requestKey &&
            !chatState.generationStopped;
          if (!ownsActiveRequest()) return;

          // A new temporary chat, or an existing chat without a persisted
          // pre-request message identity, cannot prove which server turn
          // accepted a transport-uncertain send. Retain the selection instead
          // of guessing from duplicate query text.
          if (!isNewChat && preRequestHistoryIds.size > 0) {
            // Check the captured dialogue directly and accept only a matching
            // row whose persisted identity did not exist before this request.
            const checkRes = await getAnswerCheck({
              dialogue_id: sendingDialogueId,
            });
            if (!ownsActiveRequest()) return;
            if (
              checkRes.code === 200 &&
              checkRes.data &&
              checkRes.data.some(
                (historyRow) =>
                  historyRow.query === currentMessage &&
                  typeof historyRow.id === "string" &&
                  historyRow.id.trim() !== "" &&
                  !preRequestHistoryIds.has(historyRow.id)
              )
            ) {
              // A new history id with the same query is useful to refresh this
              // dialogue, but is not request-specific evidence: another
              // client/session can create the same row while this transport is
              // uncertain. The local request key only owns an abort controller
              // and history rows expose no comparable correlation token, so it
              // must never clear the captured Expert selection here.
              if (isForeground(sendingDialogueId)) {
                await selectChat(sendingDialogueId);
              }
              return;
            }
          }
        } catch (verifyError) {
          console.error("Failed to verify message status:", verifyError);
          // verification failed; continue to show the error
        }
      }

      // only add an error message if this request still owns the dialogue
      if (
        chatState.activeRequestId === requestKey &&
        !chatState.generationStopped
      ) {
        const isTimeout = response?.status === 504;
        const baseMessage = isTimeout
          ? t("chat.timeoutFailed")
          : t("chat.sendFailed");
        const requestID = safeWebRequestID(responseData?.request_id);
        sendingMessages.push({
          role: "assistant",
          content: requestID
            ? `${baseMessage}\n\n${t("chat.requestId")}: ${requestID}`
            : baseMessage,
          steps: [],
          status: "",
          upload_path: "",
          download_path: "",
          instantMessage: true,
          tool_name: "",
          followUpQuestions: [],
          showFollowUpQuestions: false,
          showLog: false,
        });
      }
    } finally {
      // Capture ownership before the first await. Only the request that still
      // owns this dialogue may reconcile a temporary id, update its title, or
      // release lifecycle fields. A stale request must be entirely read-only.
      const ownsLifecycle = chatState.activeRequestId === requestKey;
      if (ownsLifecycle) {
        const wasStopped = chatState.generationStopped;
        const identityResult = identityReconciliation;
        const identityAlreadyReconciled =
          identityResult?.status === "reconciled" &&
          identityResult.serverId === blockingDialogueId;
        // Snapshot the accepted turn so a later refresh can reopen this
        // still-local `new_*` row. Reconciliation may still replace the
        // record with the server dialogue id below.
        if (
          acceptedTurn &&
          isNewChat &&
          isLocalStorageChat(sendingDialogueId) &&
          !identityAlreadyReconciled
        ) {
          writePendingChat(
            sendingDialogueId,
            sendingMessages as unknown as Array<{
              role: string;
              content: string;
              [key: string]: unknown;
            }>,
            {
              title: sendingTitle,
              mode: capturedMode,
            }
          );
        }
        const historyOpts =
          blockingDialogueId !== undefined ? { blockingDialogueId } : undefined;
        const reconciliation =
          identityResult ??
          (await getHistoryQuestionData(sendingDialogueId, historyOpts));
        if (reconciliation?.status === "reconciled") {
          chatState.historyHydration = "ready";
        }

        if (!isNewChat) {
          // for an existing chat, update the sending conversation's title (if it changed)
          if (sendingMessages.length > 0) {
            const userMessage = sendingMessages[sendingMessages.length - 2]; // the second-to-last is the user message
            if (userMessage && userMessage.role === "user") {
              // find the sending conversation in the list and update its title
              const currentChatIndex = chatList.value.findIndex(
                (chat) => chat.dialogue_id === sendingDialogueId
              );
              if (currentChatIndex !== -1) {
                // take the user message content as the title (length-limited)
                const titleContent = chatContentToText(userMessage.content);
                const newTitle =
                  titleContent.length > 50
                    ? titleContent.substring(0, 50) + "..."
                    : titleContent;
                chatList.value[currentChatIndex].title = newTitle;
              }
            }
          }
        }

        // Clear lifecycle fields only for this request — never a newer same-dialogue key
        // and never recreate a rekeyed temp state via getChatState(oldTempId).
        chatState.activeRequestId = "";
        chatState.uploadTransfer = null;
        chatState.generationStopped = false;

        // Clear completed attachments only after the request was accepted. A
        // rejected or transport-uncertain turn keeps the retained files so the
        // user can retry without reselecting them.
        if ((acceptedTurn || wasStopped) && chatState.fileList.length > 0) {
          chatState.fileList = [];
          // close the header after clearing the file list (foreground only)
          if (isForeground(sendingDialogueId)) {
            nextTick(() => {
              if (composerRef.value) {
                composerRef.value.closeHeader();
              }
            }).catch(() => undefined);
          }
        }

        chatState.isSending = false;
        chatState.sendStartedAt = null;
        chatState.completing = false;
        chatState.activeAgentName = "";
        if (isForeground(sendingDialogueId)) {
          await scrollToBottom();
        }
      }
    }
  };

  return { sendMessage };
}
