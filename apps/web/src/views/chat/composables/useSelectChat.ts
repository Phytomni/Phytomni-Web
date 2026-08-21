import { nextTick, toRaw } from "vue";
import type { Ref } from "vue";
import { ElMessage } from "element-plus";
import type { AssetAttachmentRef } from "@/api/types";
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
  decodeTableDataInput,
  optionalStringValue,
  parseAgentAnswer,
} from "../utils/format";
import { readServerFile } from "../utils/agent-log";
import { getAnswerCheck } from "@/api/chat";
import { normalizePositiveTaskRowId } from "@/api/task";
import {
  isLocalStorageChat,
  isValidPendingRecord,
  safeParse,
} from "@/utils/pending-chat";
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
import { isPollableChatAgentTool } from "../utils/async-agent-policy";
import { artifactPresentationForMessage } from "../utils/artifact-policy";
import { STREAM_CAPABLE_AGENTS } from "../streaming/sendBranch";
import { useStreamMessage } from "./useStreamMessage";

const STREAM_FAMILY_TOOLS: ReadonlySet<string> = new Set(STREAM_CAPABLE_AGENTS);
const kickedStreamResumes = new WeakMap<ChatUIState, Set<string>>();

function isStreamFamilyTool(tool: unknown): boolean {
  return typeof tool === "string" && STREAM_FAMILY_TOOLS.has(tool);
}

function isNonTerminalStreamStatus(status: unknown): boolean {
  const normalized = String(status ?? "")
    .trim()
    .toUpperCase();
  return (
    normalized === "RUNNING" ||
    normalized === "SUBMITTING" ||
    normalized === "PENDING"
  );
}

function shouldHydrateStreamResume(item: Partial<ChatResponse>): boolean {
  return (
    isStreamFamilyTool(item.tool_name) && isNonTerminalStreamStatus(item.status)
  );
}

function takeStreamResumeSlot(
  chatState: ChatUIState,
  messageId: string
): boolean {
  let ids = kickedStreamResumes.get(chatState);
  if (!ids) {
    ids = new Set();
    kickedStreamResumes.set(chatState, ids);
  }
  if (ids.has(messageId)) return false;
  ids.add(messageId);
  return true;
}

export type ChatReloadResult = "applied" | "failed" | "superseded";

export function historyAssistantMetadata(
  item: Pick<
    ChatResponse,
    "artifacts" | "delivery" | "context_rebuilt" | "context_degraded"
  > & { created_at?: string }
): Pick<
  ChatMessage,
  "artifacts" | "delivery" | "contextNotice" | "created_at"
> {
  const metadata: Pick<
    ChatMessage,
    "artifacts" | "delivery" | "contextNotice" | "created_at"
  > = {};
  if (Array.isArray(item.artifacts)) {
    metadata.artifacts = item.artifacts.map((artifact) => ({ ...artifact }));
  }
  if (item.delivery) metadata.delivery = { ...item.delivery };
  const contextNotice = normalizeChatContextNotice(item);
  if (contextNotice) metadata.contextNotice = contextNotice;
  if (typeof item.created_at === "string" && item.created_at.trim()) {
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
  if (!isPollableChatAgentTool(item.tool_name)) return false;
  if (isSuccessfulHistoryStatus(item.status)) return false;
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
    if (
      message.role !== "assistant" ||
      !message.a2uiRuntime ||
      message.a2uiRuntime.dialogueId !== dialogueId ||
      String(message.a2uiRuntime.messageId) !== String(message.id ?? "") ||
      !message.blocks?.some(isOpenA2uiBlock)
    ) {
      continue;
    }
    liveByMessageId.set(String(message.id), message);
  }
  if (!liveByMessageId.size) return messages;

  const mergedIds = new Set<string>();
  const nextMessages = messages.map((message) => {
    const messageId = message.id === undefined ? "" : String(message.id);
    const liveMessage = messageId ? liveByMessageId.get(messageId) : undefined;
    if (!liveMessage) return message;
    mergedIds.add(messageId);
    return {
      ...message,
      blocks: liveMessage.blocks,
      a2uiRuntime: liveMessage.a2uiRuntime,
      streaming: liveMessage.streaming,
      streamPresentationKey: liveMessage.streamPresentationKey,
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
  const { resumeStreamMessage } = useStreamMessage({
    getChatState,
    t: (key) => String(i18n.global.t(key)),
  });
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

    // `new_*` rows are local-only. The messages API looks up a server parent by
    // dialogue_id and returns [] for that prefix, which would paint
    // history-empty over a conversation the sidebar still lists after refresh.
    if (isLocalStorageChat(capturedDialogueId)) {
      const pending = safeParse(
        localStorage.getItem(`pending_chat_${capturedDialogueId}`)
      );
      if (isValidPendingRecord(pending)) {
        const messages = pending.messages.map((message) => ({
          ...message,
        })) as ChatMessage[];
        if (pending.mode === "expert" || pending.mode === "instant") {
          chatState.mode = pending.mode;
        }
        const pendingTitle =
          typeof pending.title === "string" ? pending.title.trim() : "";
        chatState.historyErrorKind = null;
        chatState.historyQuestion = messages.map((message) => ({
          role: message.role,
          content: typeof message.content === "string" ? message.content : "",
        }));
        chatState.renderedChat = {
          ...chat,
          dialogue_id: capturedDialogueId,
          ...(chat?.title || pendingTitle
            ? { title: chat?.title || pendingTitle }
            : {}),
          messages,
        };
        chatState.historyHydration =
          messages.length > 0 ? "ready" : "history-empty";
        if (mode.foreground && currentChatId.value === capturedDialogueId) {
          if (messages.length > 0) await scrollToBottom();
          updateUrlWithChatId(capturedDialogueId);
        }
        return "applied";
      }

      if (mode.force) {
        return "applied";
      }
      chatState.historyErrorKind = null;
      chatState.historyQuestion = [];
      chatState.renderedChat = {
        ...chat,
        dialogue_id: capturedDialogueId,
        messages: [],
      };
      chatState.historyHydration = "history-empty";
      if (mode.foreground && currentChatId.value === capturedDialogueId) {
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

          const emptyAnswer =
            typeof item.answer !== "string" || item.answer.trim() === "";
          const hydrateStreamResume = shouldHydrateStreamResume(item);
          const isBlankBackground = blankBackgroundAssistantRow(item);
          if (hydrateStreamResume && emptyAnswer && item.id !== undefined) {
            messages.push({
              role: "assistant",
              ...assistantMetadata,
              content: "",
              status: item.status || "",
              id: String(item.id),
              tool_name: item.tool_name,
              streaming: true,
              blocks: [],
              followUpQuestions: decodeFollowUpQuestions(
                item.follow_up_questions
              ),
              showFollowUpQuestions: false,
              showLog: false,
              instantMessage: false,
            });
          }
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
            !(hydrateStreamResume && emptyAnswer) &&
            emptyAnswer
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

          if (hydrateStreamResume && item.id !== undefined) {
            const rowAssistant = messages
              .slice(rowMessageStart)
              .reverse()
              .find((message) => message.role === "assistant");
            if (rowAssistant) {
              rowAssistant.streaming = true;
              rowAssistant.id = String(item.id);
              if (!rowAssistant.blocks) rowAssistant.blocks = [];
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

      for (const message of mergedMessages) {
        if (message.role !== "assistant" || !message.streaming) continue;
        if (!isStreamFamilyTool(message.tool_name)) continue;
        const messageId = String(message.id ?? "").trim();
        if (!messageId || !takeStreamResumeSlot(chatState, messageId)) {
          continue;
        }
        resumeStreamMessage({
          dialogueId: capturedDialogueId,
          messageId,
          placeholder: message,
          lastEventId: message.streamSeq,
          requestId: `resume:${messageId}`,
        }).catch(() => undefined);
      }

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
