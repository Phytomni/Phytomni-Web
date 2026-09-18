import { nextTick, toRaw } from "vue";
import type { Ref } from "vue";
import { ElMessage } from "element-plus";
import type { AssetAttachmentRef } from "@/api/types";
import type { ConversationHistoryV2 } from "@/api/types";
import type {
  Chat,
  ChatMessage,
  ChatResponse,
  ChatUIState,
  ContentBlock,
} from "../types";
import { normalizeChatContextNotice } from "../types";
import { parseMessageWithFiles } from "../utils/message-parse";
import {
  convertToTableData,
  decodeCitationDocuments,
  decodeTableMessagePresentation,
  decodeTableDataInput,
  optionalStringValue,
  parseAgentAnswer,
} from "../utils/format";
import { readServerFile } from "../utils/agent-log";
import { getAnswerCheck, getConversationHistoryV2 } from "@/api/chat";
import { normalizePositiveTaskRowId } from "@/api/task";
import i18n from "@/locales";
import { lockUnverifiedHistoryA2ui } from "../streaming/a2uiReducer";
import { decodeA2uiOpenSurface } from "../streaming/a2uiParse";
import { decodeAgentSteps, decodeFollowUpQuestions } from "../messageTypes";
import {
  normalizeHistoryRows,
  resolveHistoryQuestion,
} from "../utils/chat-history-normalization";
import { accountScopeForUsername } from "../upload/hash";
import type { UploadRecoveryStore } from "../upload/store";
import {
  displayAttachmentRefs,
  isSafeAssetId,
  type AttachmentMetadata,
} from "../utils/asset-attachments";
import { isPollableWaitTool } from "../utils/async-agent-policy";
import { artifactPresentationForMessage } from "../utils/artifact-policy";
import { executionReportProjection } from "../utils/report-presentation";
import {
  applyExecutionEvent,
  createExecutionRunState,
  decodeExecutionEvent,
  decodeExecutionProjection,
  hydrateExecutionProjection,
} from "../streaming/executionEvents";
import { canonicalAgentToolFromIdentity } from "@/constants/agents";

export type ChatReloadResult = "applied" | "failed" | "superseded";

export function historyAssistantMetadata(
  item: Pick<
    ChatResponse,
    | "artifacts"
    | "delivery"
    | "projection"
    | "context_rebuilt"
    | "context_degraded"
    | "bot_run_id"
    | "execution_id"
  > & { created_at?: string }
): Pick<
  ChatMessage,
  | "artifacts"
  | "delivery"
  | "botProjection"
  | "contextNotice"
  | "botRunId"
  | "executionId"
  | "created_at"
> {
  const metadata: Pick<
    ChatMessage,
    | "artifacts"
    | "delivery"
    | "botProjection"
    | "contextNotice"
    | "botRunId"
    | "executionId"
    | "created_at"
  > = {};
  if (Array.isArray(item.artifacts)) {
    metadata.artifacts = item.artifacts.map((artifact) => ({ ...artifact }));
  }
  if (item.delivery) metadata.delivery = { ...item.delivery };
  if (item.projection) metadata.botProjection = item.projection;
  const contextNotice = normalizeChatContextNotice(item);
  if (contextNotice) metadata.contextNotice = contextNotice;
  if (typeof item.bot_run_id === "string" && item.bot_run_id) {
    metadata.botRunId = item.bot_run_id;
  }
  if (typeof item.execution_id === "string" && item.execution_id) {
    metadata.executionId = item.execution_id;
  }
  if (typeof item.created_at === "string" && item.created_at) {
    metadata.created_at = item.created_at;
  }
  return metadata;
}

function isActiveResultArchiveV1(item: Partial<ChatResponse>): boolean {
  if (item.result_archive_v1 === true || item.delivery != null) return true;
  if (typeof item.answer !== "string" || item.answer.trim() === "") {
    return false;
  }
  try {
    const answer = JSON.parse(item.answer) as unknown;
    return (
      typeof answer === "object" &&
      answer !== null &&
      !Array.isArray(answer) &&
      (answer as Record<string, unknown>).result_archive_v1 === true
    );
  } catch {
    return false;
  }
}

function withoutActiveArchiveLegacyFields(
  item: Partial<ChatResponse>
): Partial<ChatResponse> {
  if (!isActiveResultArchiveV1(item)) return item;
  const safeItem = { ...item };
  delete safeItem.upload_path;
  delete safeItem.download_path;
  delete safeItem.server_file_path;
  return safeItem;
}

function stripActiveArchiveLegacyFields(message: ChatMessage): void {
  delete message.upload_path;
  delete message.download_path;
  delete message.server_file_path;
  delete message.original;
}

function isSuccessfulHistoryStatus(status: unknown): boolean {
  return (
    String(status ?? "")
      .trim()
      .toUpperCase() === "SUCCEEDED"
  );
}

function blankBackgroundAssistantRow(item: Partial<ChatResponse>): boolean {
  if (typeof item.answer !== "string" || item.answer.trim()) return false;
  if (typeof item.execution_id === "string" && item.execution_id.trim()) {
    return true;
  }
  if (
    isSuccessfulHistoryStatus(item.status) &&
    !item.projection &&
    !item.delivery
  ) {
    return false;
  }
  if (!isPollableWaitTool(item.tool_name)) return false;
  try {
    normalizePositiveTaskRowId(item.id ?? "");
    return true;
  } catch {
    return false;
  }
}

function historyA2uiBlocks(
  item: Partial<ChatResponse>
): ContentBlock[] | undefined {
  const decoded = decodeA2uiOpenSurface(item.a2ui);
  if (!decoded.ok) return undefined;
  return [
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
}

function isOpenA2uiBlock(block: ContentBlock): boolean {
  const status = block.a2ui?.state.status;
  return (
    status === "ready" ||
    status === "submitting" ||
    status === "temporarily_rejected"
  );
}

function mergeLiveA2uiMessages(
  messages: ChatMessage[],
  liveMessages: readonly ChatMessage[] | undefined,
  dialogueId: string
): ChatMessage[] {
  if (!liveMessages?.length) return messages;

  const liveByMessageId = new Map<string, ChatMessage>();
  for (const message of liveMessages) {
    if (message.role !== "assistant" || message.id === undefined) continue;
    liveByMessageId.set(String(message.id), message);
  }
  if (!liveByMessageId.size) return messages;

  const mergedIds = new Set<string>();
  const nextMessages = messages.map((message) => {
    const messageId = message.id === undefined ? "" : String(message.id);
    const liveMessage = messageId ? liveByMessageId.get(messageId) : undefined;
    if (!liveMessage) return message;
    mergedIds.add(messageId);
    const liveRevision = liveMessage.contentRevision ?? 0;
    const historyRevision = message.contentRevision ?? 0;
    const liveOffset = liveMessage.contentOffset ?? 0;
    const historyOffset = message.contentOffset ?? 0;
    const liveContentIsNewer =
      liveRevision > historyRevision ||
      (liveRevision === historyRevision && liveOffset > historyOffset);
    const liveTableIsAtLeastAsNew =
      liveMessage.tableHeaders !== undefined &&
      message.tableHeaders === undefined &&
      (liveRevision > historyRevision ||
        (liveRevision === historyRevision && liveOffset >= historyOffset));
    const liveA2uiIsOpen =
      liveMessage.a2uiRuntime?.dialogueId === dialogueId &&
      String(liveMessage.a2uiRuntime.messageId) === messageId &&
      liveMessage.blocks?.some(isOpenA2uiBlock);
    return {
      ...message,
      ...(liveContentIsNewer || liveTableIsAtLeastAsNew
        ? {
            content: liveMessage.content,
            contentRevision: liveMessage.contentRevision,
            contentOffset: liveMessage.contentOffset,
            contentLength: liveMessage.contentLength,
            status: liveMessage.status,
            executionRun: liveMessage.executionRun,
            tableHeaders: liveMessage.tableHeaders,
            original: liveMessage.original,
          }
        : {}),
      ...(liveMessage.doc_list?.length
        ? { doc_list: liveMessage.doc_list }
        : {}),
      ...(liveA2uiIsOpen
        ? {
            blocks: liveMessage.blocks,
            a2uiRuntime: liveMessage.a2uiRuntime,
            streaming: liveMessage.streaming,
            streamPresentationKey: liveMessage.streamPresentationKey,
          }
        : {}),
    };
  });

  for (const [messageId, liveMessage] of liveByMessageId) {
    if (!mergedIds.has(messageId)) nextMessages.push({ ...liveMessage });
  }
  return nextMessages;
}

export function useSelectChat(opts: {
  getChatState: (dialogueId: string) => ChatUIState;
  ownsChatState: (dialogueId: string, state: ChatUIState) => boolean;
  currentChatId: Ref<string>;
  scrollToBottom: () => Promise<void>;
  updateUrlWithChatId: (dialogueId: string) => void;
  chatList: Ref<Chat[]>;
  timestamp: Ref<number>;
  username?: Ref<string> | (() => string);
  attachmentStore?: UploadRecoveryStore;
  /** Test/compatibility seam; undefined uses V2, null deliberately skips it. */
  historyV2Client?: typeof getConversationHistoryV2 | null;
}) {
  const {
    getChatState,
    ownsChatState,
    currentChatId,
    scrollToBottom,
    updateUrlWithChatId,
    chatList,
    timestamp,
  } = opts;
  const usernameValue = () =>
    typeof opts.username === "function"
      ? opts.username()
      : (opts.username?.value ?? "");
  const loadAttachmentMetadata = async (): Promise<
    ReadonlyMap<string, AttachmentMetadata>
  > => {
    if (!opts.attachmentStore || !opts.username) return new Map();
    try {
      const scope = await accountScopeForUsername(usernameValue());
      const records = await opts.attachmentStore.list(scope);
      return new Map(
        records
          .filter((record) => record.status === "completed" && record.assetId)
          .map((record) => [
            record.assetId as string,
            {
              name: record.name,
              size: record.size,
              type: record.type,
            },
          ])
      );
    } catch {
      return new Map();
    }
  };
  const hydrationGenerations = new Map<string, number>();
  const degradedHistoryWarnings = new Set<string>();

  const beginHydration = (dialogueId: string) => {
    const generation = (hydrationGenerations.get(dialogueId) || 0) + 1;
    hydrationGenerations.set(dialogueId, generation);
    return generation;
  };

  type HydrationMode = { force: boolean; foreground: boolean };

  const hydrateChat = async (
    dialogueId: string,
    mode: HydrationMode
  ): Promise<ChatReloadResult> => {
    // Capture dialogue + state before await so a late response never writes
    // another dialogue's renderedChat or steals foreground URL/scroll.
    const capturedDialogueId = dialogueId;
    const chatState = getChatState(capturedDialogueId);
    if (mode.foreground) currentChatId.value = capturedDialogueId;
    const chat = chatList.value.find(
      (c: Chat) => c.dialogue_id === capturedDialogueId
    );

    // A live rendered owner already contains message-scoped stream/runtime
    // state. Re-selecting it must not rehydrate stale history over that tree or
    // supersede a material background hydration that is already in flight.
    if (!mode.force && chatState.renderedChat) {
      const ownsLiveRenderedState = () =>
        ownsChatState(capturedDialogueId, chatState);
      if (
        chatState.renderedChat.messages.length > 0 &&
        ownsLiveRenderedState()
      ) {
        if (mode.foreground) await scrollToBottom();
      }
      if (
        mode.foreground &&
        ownsLiveRenderedState() &&
        currentChatId.value === capturedDialogueId
      ) {
        updateUrlWithChatId(capturedDialogueId);
      }
      return "applied";
    }

    // Only a hydration that issues a history request supersedes an older one.
    const hydrationGeneration = beginHydration(capturedDialogueId);
    const isCurrentHydration = () =>
      hydrationGenerations.get(capturedDialogueId) === hydrationGeneration &&
      ownsChatState(capturedDialogueId, chatState);

    const previousHistoryHydration = chatState.historyHydration;
    if (!mode.force) chatState.historyHydration = "loading";
    chatState.historyErrorKind = null;
    if (!mode.force) {
      chatState.historyQuestion = null;
      chatState.renderedChat = null;
      chatState.reactions = {};
    }

    const retainReloadedTreeOnFailure = () => {
      if (!mode.force) return;
      chatState.historyHydration = previousHistoryHydration;
    };

    let orderedHistory: ConversationHistoryV2 | null = null;
    const historyV2Client =
      opts.historyV2Client === undefined
        ? getConversationHistoryV2
        : opts.historyV2Client;
    if (historyV2Client) {
      try {
        const response = await historyV2Client({
          dialogue_id: capturedDialogueId,
        });
        if (response.code === 200 && response.data.messages.length > 0) {
          orderedHistory = response.data;
        }
      } catch {
        // Explicit compatibility fallback: legacy conversations predate the V2
        // ordered timeline and continue through the unchanged legacy decoder.
      }
    }

    if (!isCurrentHydration()) return "superseded";
    if (orderedHistory) {
      const messages: ChatMessage[] = orderedHistory.messages
        .filter(
          (item) =>
            (item.type === "user" || item.type === "assistant") &&
            (item.role === "user" || item.role === "assistant")
        )
        .map((item) => {
          const table =
            item.role === "assistant"
              ? decodeTableMessagePresentation(item.content)
              : undefined;
          return {
            role: item.role,
            content: table?.content ?? item.content,
            id: item.message_id,
            status: item.status,
            executionId: item.execution_id,
            messageIndex: item.message_index,
            sourceMessageId: item.source_message_id,
            parentMessageId: item.parent_message_id,
            messageType: item.type,
            visibility: item.visibility,
            contentRevision: item.content_revision,
            contentOffset: item.content_offset,
            contentLength: item.content_length,
            doc_list: decodeCitationDocuments(item.references),
            ...(table ?? {}),
            instantMessage: false,
            showLog: false,
          };
        });
      const assistantByExecution = new Map(
        messages
          .filter(
            (message) => message.role === "assistant" && message.executionId
          )
          .map((message) => [message.executionId as string, message])
      );
      const executionRuns = { ...chatState.executionRuns };
      for (const execution of orderedHistory.executions) {
        let run = createExecutionRunState(execution.execution_id, 2);
        for (const rawEvent of execution.events) {
          const decoded = decodeExecutionEvent(rawEvent);
          if (decoded.ok) run = applyExecutionEvent(run, decoded.value);
        }
        if (execution.projection) {
          const decoded = decodeExecutionProjection(execution.projection);
          if (decoded.ok) run = hydrateExecutionProjection(run, decoded.value);
        }
        const assistant = assistantByExecution.get(execution.execution_id);
        run = {
          ...run,
          latestSeq: Math.max(run.latestSeq, execution.event_cursor),
          outputRevision: Math.max(
            run.outputRevision,
            execution.content_revision,
            assistant?.contentRevision ?? 0
          ),
          outputOffset: Math.max(
            run.outputOffset,
            execution.content_offset,
            assistant?.contentOffset ?? 0
          ),
          outputText:
            typeof assistant?.original === "string"
              ? assistant.original
              : typeof assistant?.content === "string"
                ? assistant.content
                : run.outputText,
          trackingHealth: execution.tracking_health,
          delivery: execution.stale ? "stale" : run.delivery,
        };
        if (assistant) {
          const toolName = canonicalAgentToolFromIdentity(
            run.selectedAgentId,
            run.agentSlug
          );
          assistant.executionRun = run;
          if (toolName) assistant.tool_name = toolName;
          const botProjection = toolName
            ? executionReportProjection(run, toolName, run.outputText)
            : undefined;
          if (botProjection) assistant.botProjection = botProjection;
          if (run.routeReasonCode) {
            assistant.route_reason_code = run.routeReasonCode;
          }
        }
        executionRuns[execution.execution_id] = run;
      }
      chatState.executionRuns = executionRuns;
      const latestExecutionId = [...messages]
        .reverse()
        .find(
          (message) =>
            message.role === "assistant" &&
            message.executionId &&
            executionRuns[message.executionId]
        )?.executionId;
      if (latestExecutionId) {
        chatState.selectedExecutionRunId = latestExecutionId;
      }
      chatState.historyQuestion = messages.map((message) => ({
        role: message.role,
        content: message.content,
      }));
      const mergedMessages = mergeLiveA2uiMessages(
        messages,
        chatState.renderedChat?.messages,
        capturedDialogueId
      );
      chatState.renderedChat = { ...chat, messages: mergedMessages };
      chatState.historyHydration = "ready";
      chatState.historyErrorKind = null;
      if (
        mode.foreground &&
        isCurrentHydration() &&
        currentChatId.value === capturedDialogueId
      ) {
        await scrollToBottom();
        if (
          isCurrentHydration() &&
          currentChatId.value === capturedDialogueId
        ) {
          updateUrlWithChatId(capturedDialogueId);
        }
      }
      return "applied";
    }

    let res;
    try {
      // call getAnswerCheck to get the conversation records
      res = await getAnswerCheck({ dialogue_id: capturedDialogueId });
    } catch {
      if (!isCurrentHydration()) return "superseded";
      retainReloadedTreeOnFailure();
      if (!mode.force) chatState.historyHydration = "error";
      chatState.historyErrorKind = "request";
      if (
        mode.foreground &&
        isCurrentHydration() &&
        currentChatId.value === capturedDialogueId
      ) {
        updateUrlWithChatId(capturedDialogueId);
      }
      return "failed";
    }

    if (!isCurrentHydration()) return "superseded";

    if (res.code !== 200) {
      retainReloadedTreeOnFailure();
      if (!mode.force) chatState.historyHydration = "error";
      chatState.historyErrorKind = "request";
      if (
        mode.foreground &&
        isCurrentHydration() &&
        currentChatId.value === capturedDialogueId
      ) {
        updateUrlWithChatId(capturedDialogueId);
      }
      return "failed";
    }

    try {
      if (!Array.isArray(res.data)) {
        throw new TypeError("History response data must be an array");
      }

      // process the returned data into message format
      const messages: ChatMessage[] = [];
      const historyMessages: ChatMessage[] = [];
      const nextReactions: Record<string, number> = {};
      const historyRows = normalizeHistoryRows(res.data);
      const attachmentMetadata = await loadAttachmentMetadata();
      if (!isCurrentHydration()) return "superseded";
      // Reconstruct the per-conversation routing mode from the persisted parent
      // row so refreshes/threads in this conversation route correctly. Default
      // to "instant" for legacy rows that predate the mode column.
      const nextMode = historyRows[0]?.mode === "expert" ? "expert" : "instant";

      // iterate the returned array and convert to message format
      if (historyRows.length > 0) {
        historyRows.forEach((row, rowIndex) => {
          const resultArchiveV1 = isActiveResultArchiveV1(
            row as Partial<ChatResponse>
          );
          const rowMessageStart = messages.length;
          const item = withoutActiveArchiveLegacyFields(
            row as Partial<ChatResponse>
          );
          const a2uiBlocks = historyA2uiBlocks(item);
          const assistantMetadata = historyAssistantMetadata(item);
          // sync the reaction state returned by the server
          if (item.id && item.reaction_type) {
            nextReactions[item.id.toString()] = parseInt(item.reaction_type);
          }

          // Add the user message, including a legacy title-only parent row.
          // Child rows must not inherit the sidebar title when their own query
          // is absent, or one historical question would be duplicated before
          // every child answer.
          const question = resolveHistoryQuestion(
            row,
            rowIndex === 0 ? chat?.title || "" : ""
          );
          if (question) {
            const hasStructuredAttachments =
              Object.prototype.hasOwnProperty.call(item, "attachments");
            if (hasStructuredAttachments && Array.isArray(item.attachments)) {
              const refs = item.attachments.filter(
                (attachment): attachment is AssetAttachmentRef =>
                  typeof attachment === "object" &&
                  attachment !== null &&
                  !Array.isArray(attachment) &&
                  isSafeAssetId(
                    (attachment as unknown as Record<string, unknown>).asset_id
                  )
              );
              const attachments = displayAttachmentRefs(
                refs,
                attachmentMetadata,
                i18n.global.t("chat.upload.completedFile")
              );
              messages.push({
                role: "user",
                content: question,
                attachments,
              });
              historyMessages.push({
                role: "user",
                content: question,
                attachments,
              });
            } else {
              // Only pre-structured rows use the legacy marker parser. New
              // rows keep literal user-authored marker text unchanged.
              const { content, attachedFiles } =
                parseMessageWithFiles(question);
              messages.push({
                role: "user",
                content,
                attachedFiles,
              });
              historyMessages.push({
                role: "user",
                content,
              });
            }
          }

          const isBlankBackground = blankBackgroundAssistantRow(item);
          if (isBlankBackground) {
            messages.push({
              role: "assistant",
              ...assistantMetadata,
              content: "",
              status: item.status || "",
              upload_path: item.upload_path || "",
              download_path: item.download_path || "",
              id: String(item.id),
              task_id: item.task_id,
              tool_name: item.tool_name,
              followUpQuestions: decodeFollowUpQuestions(
                item.follow_up_questions
              ),
              showFollowUpQuestions: true,
              showLog: false,
              instantMessage: false,
              compute_resource: item.compute_resource || "",
            });
          }

          if (
            a2uiBlocks &&
            !isBlankBackground &&
            (typeof item.answer !== "string" || item.answer.trim() === "")
          ) {
            messages.push({
              role: "assistant",
              ...assistantMetadata,
              content: "",
              status: item.status || "INPUT_REQUIRED",
              id: String(item.id),
              tool_name: item.tool_name,
              followUpQuestions: decodeFollowUpQuestions(
                item.follow_up_questions
              ),
              showFollowUpQuestions: false,
              showLog: false,
              instantMessage: false,
              blocks: a2uiBlocks,
            });
          }

          // Add the assistant message only when the persisted value is usable.
          if (typeof item.answer === "string" && item.answer.trim()) {
            try {
              const answerData = parseAgentAnswer(item.answer);
              const finalAnswer = optionalStringValue(
                answerData,
                "final_answer"
              );
              if (finalAnswer) {
                messages.push({
                  role: "assistant",
                  ...assistantMetadata,
                  content: finalAnswer,
                  steps: decodeAgentSteps(answerData.steps),
                  status: item?.status || "",
                  upload_path: item?.upload_path || "",
                  download_path: item?.download_path || "",
                  id: item.id,
                  tool_name: item.tool_name,
                  followUpQuestions: decodeFollowUpQuestions(
                    item.follow_up_questions
                  ),
                  showFollowUpQuestions: true, // history messages show follow-up questions by default
                  showLog: false,
                  instantMessage: false,
                });
                historyMessages.push({
                  role: "assistant",
                  content: finalAnswer,
                });
              } else {
                if (item.tool_name === "ChatAgent") {
                  messages.push({
                    role: "assistant",
                    ...assistantMetadata,
                    content: item.answer,
                    steps: [],
                    status: item?.status || "",
                    upload_path: item?.upload_path || "",
                    download_path: item?.download_path || "",
                    id: item.id,
                    tool_name: item.tool_name,
                    followUpQuestions: decodeFollowUpQuestions(
                      item.follow_up_questions
                    ),
                    showFollowUpQuestions: true, // history messages show follow-up questions by default
                    showLog: false,
                    instantMessage: false,
                  });
                  historyMessages.push({
                    role: "assistant",
                    content: item.answer,
                  });
                } else if (
                  item.tool_name === "KnowledgeAgent" ||
                  item.tool_name === "ReviewAgent" ||
                  item.tool_name === "BriefGeneAgent"
                ) {
                  const contentData = parseAgentAnswer(item.answer);
                  // log the doc_list data
                  messages.push({
                    role: "assistant",
                    ...assistantMetadata,
                    content:
                      optionalStringValue(contentData, "content") ||
                      item.answer,
                    doc_list: decodeCitationDocuments(contentData.doc_list),
                    status: item?.status || "",
                    upload_path: item?.upload_path || "",
                    download_path: item?.download_path || "",
                    id: item.id,
                    tool_name: item.tool_name,
                    followUpQuestions: decodeFollowUpQuestions(
                      item.follow_up_questions
                    ),
                    showFollowUpQuestions: true, // history messages show follow-up questions by default
                    showLog: false,
                    instantMessage: false,
                  });
                  historyMessages.push({
                    role: "assistant",
                    content: item.answer,
                  });
                } else if (item.tool_name === "DataAgent") {
                  const contentData = parseAgentAnswer(item.answer);
                  const tableInput = decodeTableDataInput(contentData);
                  const tableData = convertToTableData(tableInput);
                  messages.push({
                    role: "assistant",
                    ...assistantMetadata,
                    content: tableData,
                    tableHeaders: tableInput.headers.map((header: string) => ({
                      prop: header.replace(/\s+/g, "_").toLowerCase(),
                      label: header,
                    })),
                    tableCaption: tableInput.title,
                    status: item?.status || "",
                    upload_path: item?.upload_path || "",
                    download_path: item?.download_path || "",
                    original: item.answer,
                    id: item.id,
                    tool_name: item.tool_name,
                    followUpQuestions: decodeFollowUpQuestions(
                      item.follow_up_questions
                    ),
                    showFollowUpQuestions: true, // history messages show follow-up questions by default
                    showLog: false,
                    instantMessage: false,
                  });
                  historyMessages.push({
                    role: "assistant",
                    content: item.answer,
                  });
                } else if (item.tool_name === "AnalystAgent") {
                  messages.push({
                    role: "assistant",
                    ...assistantMetadata,
                    content: item.answer,
                    status: item?.status || "",
                    upload_path: item?.upload_path || "",
                    download_path: item?.download_path || "",
                    id: item.id,
                    task_id: item.task_id,
                    tool_name: item.tool_name,
                    followUpQuestions: decodeFollowUpQuestions(
                      item.follow_up_questions
                    ),
                    showFollowUpQuestions: true, // history messages show follow-up questions by default
                    showLog: false,
                    instantMessage: false,
                    compute_resource: item?.compute_resource || "",
                  });
                  historyMessages.push({
                    role: "assistant",
                    content: item.answer,
                  });
                } else if (item.tool_name === "DeepGenomeAgent") {
                  const contentData = parseAgentAnswer(item.answer);

                  // create the message object
                  const deepGenomeMessage = {
                    role: "assistant",
                    ...assistantMetadata,
                    content:
                      optionalStringValue(contentData, "content") ||
                      item.answer,
                    doc_list: decodeCitationDocuments(contentData.doc_list),
                    status: item?.status || "",
                    upload_path: item?.upload_path || "",
                    id: item.id,
                    task_id: item.task_id,
                    tool_name: item.tool_name,
                    followUpQuestions: decodeFollowUpQuestions(
                      item.follow_up_questions
                    ),
                    showFollowUpQuestions: true, // history messages show follow-up questions by default
                    instantMessage: false,
                    server_file_path: item.server_file_path, // add the server file path
                  };
                  const ownsDeepGenomeMessage = () =>
                    ownsChatState(capturedDialogueId, chatState) &&
                    (chatState.renderedChat?.messages.some(
                      (message) => toRaw(message) === deepGenomeMessage
                    ) ??
                      false);

                  // if there is a server file path, read the file content asynchronously
                  if (item.server_file_path) {
                    // show a loading state first
                    deepGenomeMessage.content = "Loading file content...";

                    readServerFile(item.server_file_path)
                      .then((fileContent) => {
                        if (!ownsDeepGenomeMessage()) return;
                        if (fileContent && fileContent.trim()) {
                          deepGenomeMessage.content = fileContent;
                        } else {
                          deepGenomeMessage.content =
                            "File content is empty or failed to load";
                        }
                        // force a view update; scroll only if still foreground
                        nextTick(() => {
                          if (!ownsDeepGenomeMessage()) return;
                          timestamp.value = Date.now();
                          if (
                            ownsDeepGenomeMessage() &&
                            currentChatId.value === capturedDialogueId
                          ) {
                            scrollToBottom().catch(() => undefined);
                          }
                        }).catch(() => undefined);
                      })
                      .catch((error) => {
                        if (!ownsDeepGenomeMessage()) return;
                        console.error(
                          "Failed to read DeepGenomeAgent file:",
                          error
                        );
                        deepGenomeMessage.content =
                          "Failed to load file, please try again later";
                        nextTick(() => {
                          if (!ownsDeepGenomeMessage()) return;
                          timestamp.value = Date.now();
                          if (
                            ownsDeepGenomeMessage() &&
                            currentChatId.value === capturedDialogueId
                          ) {
                            scrollToBottom().catch(() => undefined);
                          }
                        }).catch(() => undefined);
                      });
                  }

                  messages.push(deepGenomeMessage);
                  historyMessages.push({
                    role: "assistant",
                    content: item.answer,
                  });
                } else {
                  messages.push({
                    role: "assistant",
                    ...assistantMetadata,
                    content: item.answer,
                    status: item?.status || "",
                    upload_path: item?.upload_path || "",
                    download_path: item?.download_path || "",
                    id: item?.id || "",
                    task_id: item.task_id,
                    tool_name: item?.tool_name || "",
                    followUpQuestions: decodeFollowUpQuestions(
                      item.follow_up_questions
                    ),
                    showFollowUpQuestions: true, // history messages show follow-up questions by default
                    instantMessage: false,
                  });
                  historyMessages.push({
                    role: "assistant",
                    content: item.answer,
                  });
                }
              }
            } catch {
              messages.push({
                role: "assistant",
                ...assistantMetadata,
                content: item.answer,
                steps: [],
                status: item?.status || "",
                upload_path: item?.upload_path || "",
                download_path: item?.download_path || "",
                id: item?.id || "",
                task_id: item.task_id,
                tool_name: item.tool_name || "",
                followUpQuestions: decodeFollowUpQuestions(
                  item.follow_up_questions
                ),
                showFollowUpQuestions: true, // history messages show follow-up questions by default
                showLog: false,
                instantMessage: false,
              });
              historyMessages.push({
                role: "assistant",
                content: item.answer,
              });
              timestamp.value = Date.now();
            }
            if (a2uiBlocks) {
              const rowAssistant = messages
                .slice(rowMessageStart)
                .reverse()
                .find((message) => message.role === "assistant");
              if (rowAssistant) rowAssistant.blocks = a2uiBlocks;
            }

            const contextNotice = normalizeChatContextNotice(item);
            const lastMessage = messages.at(-1);
            if (contextNotice && lastMessage?.role === "assistant") {
              lastMessage.contextNotice = contextNotice;
            }
            if (
              lastMessage?.role === "assistant" &&
              typeof item.route_reason_code === "string" &&
              item.route_reason_code
            ) {
              lastMessage.route_reason_code = item.route_reason_code;
            }
            if (resultArchiveV1) {
              messages
                .slice(rowMessageStart)
                .filter((message) => message.role === "assistant")
                .forEach(stripActiveArchiveLegacyFields);
            }
          }
        });
      }

      // A degraded context does not invalidate the saved answer. Warn once per
      // hydrated assistant row, while keeping context_rebuilt non-interrupting.
      for (const item of historyRows) {
        if (item.context_degraded !== true || item.id === undefined) continue;
        const messageId = String(item.id);
        if (
          !messages.some(
            (message) =>
              message.role === "assistant" &&
              String(message.id ?? "") === messageId &&
              message.contextNotice?.degraded === true
          )
        ) {
          continue;
        }
        const warningKey = `${capturedDialogueId}\u0000${messageId}`;
        if (degradedHistoryWarnings.has(warningKey)) continue;
        degradedHistoryWarnings.add(warningKey);
        ElMessage.warning(i18n.global.t("chat.contextDegraded"));
      }

      chatState.mode = nextMode;
      chatState.reactions = nextReactions;
      chatState.historyQuestion = historyMessages;
      const historyMessagesWithLockedA2ui = lockUnverifiedHistoryA2ui(messages);
      const liveMessages = chatState.renderedChat?.messages;
      const mergedMessages = mergeLiveA2uiMessages(
        historyMessagesWithLockedA2ui,
        liveMessages,
        capturedDialogueId
      );
      const handledIdentities = new Set(chatState.handledArtifactIdentities);
      for (const message of mergedMessages) {
        const presentation = artifactPresentationForMessage(message);
        if (!presentation) continue;
        handledIdentities.add(presentation.identity);

        // A live merge may add a stream key to an already hydrated row. Seed
        // the durable fallback identity too, so the same report cannot reclaim
        // focus when the runtime key is later replaced by the row/run identity.
        if (message.streamPresentationKey) {
          const withoutStreamKey = artifactPresentationForMessage({
            ...message,
            streamPresentationKey: undefined,
          });
          if (withoutStreamKey) {
            handledIdentities.add(withoutStreamKey.identity);
          }
        }
      }
      chatState.handledArtifactIdentities = [...handledIdentities];
      // Populate only this dialogue's rendered owner — never the live current ref
      chatState.renderedChat = {
        ...chat,
        messages: mergedMessages,
      };
      chatState.historyHydration =
        messages.length > 0 ? "ready" : "history-empty";

      // Foreground shell effects only while this dialogue is still selected
      if (
        mode.foreground &&
        isCurrentHydration() &&
        currentChatId.value === capturedDialogueId
      ) {
        if (messages.length > 0) {
          await scrollToBottom();
        }
        if (
          isCurrentHydration() &&
          currentChatId.value === capturedDialogueId
        ) {
          updateUrlWithChatId(capturedDialogueId);
        }
      }
      return "applied";
    } catch {
      if (!isCurrentHydration()) return "superseded";
      retainReloadedTreeOnFailure();
      if (!mode.force) chatState.historyHydration = "error";
      chatState.historyErrorKind = "decode";
      if (
        mode.foreground &&
        isCurrentHydration() &&
        currentChatId.value === capturedDialogueId
      ) {
        updateUrlWithChatId(capturedDialogueId);
      }
      return "failed";
    }
  };

  const selectChat = async (dialogueId: string): Promise<void> => {
    await hydrateChat(dialogueId, { force: false, foreground: true });
  };
  const reloadChat = (dialogueId: string): Promise<ChatReloadResult> =>
    hydrateChat(dialogueId, { force: true, foreground: false });

  return { selectChat, reloadChat };
}
