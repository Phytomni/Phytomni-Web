import { nextTick } from "vue";
import type { Ref } from "vue";
import type {
  ChatComposerHandle,
  ChatMessage,
  Chat,
  DialogueReconciliationResult,
  ChatUIState,
  ChatView,
  UploadFile,
} from "../types";
import { ElMessage, ElMessageBox } from "element-plus";
import i18n from "@/locales";
import {
  decodeCitationDocuments,
  decodeTableDataInput,
  formatFileSize,
  convertToTableData,
  optionalStringValue,
  parseAgentAnswer,
} from "../utils/format";
import { readServerFile } from "../utils/agent-log";
import {
  writePendingChat,
  isLocalStorageChat,
  upsertPendingChatListEntry,
} from "@/utils/pending-chat";
import { isNetworkError } from "@/utils/network-error";
import { getQueryAbortable, getAnswerCheck, type QueryData } from "@/api/chat";
import { createTransferTracker } from "@/utils/transfer-progress";
import { shouldStream } from "../streaming/sendBranch";
import { useStreamMessage } from "./useStreamMessage";
import { createChatRequestKey } from "../utils/chat-request-key";
import { parentRowIdForDialogue } from "../utils/chat-parent-row";
import { parseBotProjection } from "../botProjection";
import { decodeA2uiOpenSurface } from "../streaming/a2uiParse";
import { createFetchA2uiTransport } from "../streaming/a2uiAction";
import { getToken } from "@/utils/auth";
import { CANONICAL_AGENT_TOOLS } from "@/constants/agents";
import { isRecord, isSuccessfulDataEnvelope } from "@/api/contracts";
import {
  chatContentToText,
  decodeAgentSteps,
  decodeFollowUpQuestions,
} from "../messageTypes";

const CANONICAL_TOOL_SET = new Set<string>(CANONICAL_AGENT_TOOLS);
const MAX_CONTEXT_MESSAGES = 20;
const SAFE_WEB_REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

type ChatUserStore = {
  FedLogOut: () => Promise<unknown>;
};
type ChatMode = ChatUIState["mode"];

function isCanonicalToolName(value: unknown): value is string {
  return typeof value === "string" && CANONICAL_TOOL_SET.has(value);
}

function safeWebRequestID(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return SAFE_WEB_REQUEST_ID_PATTERN.test(normalized) ? normalized : undefined;
}

function clearCapturedSelectionAfterAcceptance(
  chatState: ChatUIState,
  capturedMode: ChatMode,
  capturedSelectedAgent: string
): void {
  if (
    capturedMode === "expert" &&
    capturedSelectedAgent !== "" &&
    chatState.selectedAgent === capturedSelectedAgent
  ) {
    chatState.selectedAgent = "";
  }
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
  const content = chatContentToText(message.content).trim();
  if (content) return content;
  return (message.blocks ?? [])
    .filter((block) => block.type === "markdown" && block.text)
    .map((block) => block.text?.trim() ?? "")
    .filter(Boolean)
    .join("\n\n");
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
    return content ? [{ role: message.role, content }] : [];
  });
  chatState.historyQuestion = [
    ...prior,
    { role: "user", content: userContent },
    { role: "assistant", content: assistantContent },
  ].slice(-MAX_CONTEXT_MESSAGES);
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
  data: QueryData
): void {
  if (typeof data.task_id === "string" && data.task_id.trim() !== "") {
    message.task_id = data.task_id;
  }
  if (
    typeof data.download_path === "string" &&
    data.download_path.trim() !== ""
  ) {
    message.download_path = data.download_path;
  }
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
  chatList: Ref<Chat[]>;
  timestamp: Ref<number>;
  selectChat: (dialogueId: string) => Promise<void> | void;
  scrollToBottom: () => Promise<void>;
}) {
  const {
    getChatState,
    currentChatId,
    currentChat,
    composerRef,
    t,
    userStore,
    getHistoryQuestionData,
    chatList,
    timestamp,
    selectChat,
    scrollToBottom,
  } = opts;

  const isForeground = (sendingDialogueId: string) =>
    currentChatId.value === sendingDialogueId;

  const sendMessage = async () => {
    if (!currentChatId.value) return;

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
    const currentMessage = chatState.messageInput;
    if (!currentMessage.trim()) return;

    // Capture parent row, files, mode, history, and request key before any await
    // so an A→B switch during scrollToBottom cannot retarget the payload.
    const parentRowId = parentRowIdForDialogue(
      sendingDialogueId,
      chatList.value
    );
    const capturedFiles = [...(chatState.fileList as UploadFile[])];
    const capturedHistory = chatState.historyQuestion;
    const requestKey = createChatRequestKey();

    chatState.isSending = true;
    chatState.generationStopped = false;
    chatState.activeRequestId = requestKey;
    chatState.sendStartedAt = Date.now();
    chatState.activeAgentName =
      capturedMode === "instant" ? "ChatAgent" : capturedSelectedAgent;
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

    // build the user message, including attached file info
    const userMessage = {
      role: "user",
      content: currentMessage,
      attachedFiles: capturedFiles.length > 0 ? [...capturedFiles] : undefined,
    };

    // append file info to the message content so it persists in history
    let messageContent = currentMessage;
    if (capturedFiles.length > 0) {
      const fileInfo = capturedFiles
        .map(
          (file) => `[Attachment: ${file.name} (${formatFileSize(file.size)})]`
        )
        .join("\n");
      messageContent = `${currentMessage}\n\n${fileInfo}`;
    }

    // update the user message content to include file info
    userMessage.content = messageContent;

    const sendingMessages = chatState.renderedChat.messages;
    sendingMessages.push(userMessage);

    const sendingTitle = messageContent;
    let blockingDialogueId: string | undefined;

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
      queryData.append("query", messageContent); // use the message content that includes file info
      queryData.append("id", parentRowId.toString());
      queryData.append(
        "tool",
        capturedMode === "expert" ? capturedSelectedAgent : ""
      );
      queryData.append("mode", capturedMode);
      if (capturedHistory) {
        queryData.append("history", JSON.stringify(capturedHistory));
      }
      if (capturedFiles.length > 0) {
        capturedFiles.forEach((fileItem) => {
          queryData.append("files", fileItem.file);
        });
      }

      // Stream branch: chat-family + instant mode + dark-launch flag. The
      // insertion point is inside the existing try, so returning here still
      // runs the enclosing finally (request-id cleanup, history refresh via
      // coordinator, title update, fileList clear) exactly once — no duplicate
      // cleanup needed, and none is done here.
      const streamFlag = import.meta.env.VITE_STREAM_ENABLED === "true";
      if (shouldStream(chatState.activeAgentName, capturedMode, streamFlag)) {
        const placeholder: ChatMessage = {
          role: "assistant",
          content: "",
          streaming: true,
          blocks: [],
          instantMessage: false,
          tool_name: "ChatAgent",
          followUpQuestions: [],
          showFollowUpQuestions: false,
          showLog: false,
          // Runtime-only Activity identity — reuse the captured request key.
          streamPresentationKey: requestKey,
        };
        sendingMessages.push(placeholder);
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
          placeholder,
        });
        if (
          chatState.activeRequestId === requestKey &&
          streamResult.dialogueId
        ) {
          blockingDialogueId = streamResult.dialogueId;
        }
        if (
          chatState.activeRequestId === requestKey &&
          !chatState.generationStopped &&
          streamResult.completed === true
        ) {
          commitSuccessfulTurn(chatState, userMessage, placeholder);
        }
        return;
      }

      const hasFiles = capturedFiles.length > 0;
      const tracker = hasFiles
        ? createTransferTracker({
            phase: "upload",
            requestId: requestKey,
          })
        : null;

      const response = await getQueryAbortable(
        queryData,
        requestKey,
        tracker
          ? {
              onUploadProgress: (e) => {
                const snap = tracker.update({
                  loaded: e.loaded,
                  total: e.total ?? 0,
                });
                chatState.uploadTransfer = snap;
                if (
                  !snap.indeterminate &&
                  snap.loaded >= snap.total &&
                  snap.total > 0
                ) {
                  chatState.uploadTransfer = null;
                }
              },
            }
          : undefined
      );

      // On response: first fast-animate the progress bar to 100% (CSS 300ms), then swap in the answer.
      if (!chatState.generationStopped) {
        chatState.completing = true;
        await new Promise((resolve) => setTimeout(resolve, 300));
      }

      // The runtime interceptor returns code 200 for decoded success envelopes;
      // the shared guard preserves only the established `{ data }` shape
      // without `code` and rejects explicit non-success envelopes.
      if (isSuccessfulDataEnvelope<QueryData>(response)) {
        const responseData = response.data;
        const botProjection = parseBlockingProjection(responseData);
        const expertSucceeded =
          botProjection?.status === "SUCCEEDED" ||
          (botProjection === undefined &&
            typeof responseData.status === "string" &&
            responseData.status.trim().toUpperCase() === "SUCCEEDED");
        const acceptedExpertResponse = isAcceptedExpertResponse(
          expertSucceeded,
          botProjection
        );
        if (
          capturedMode === "expert" &&
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
              assistantMessage = {
                role: "assistant",
                content:
                  response.data?.answer ||
                  "Sorry, I cannot answer this question.",
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

        if (assistantMessage) {
          attachBlockingLegacyFields(assistantMessage, responseData);
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
          if (capturedMode !== "expert" || acceptedExpertResponse) {
            clearCapturedSelectionAfterAcceptance(
              chatState,
              capturedMode,
              capturedSelectedAgent
            );
          }
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
          attachBlockingLegacyFields(assistantMessage, responseData);
          if (botProjection) {
            assistantMessage.botProjection = botProjection;
            attachBlockingA2ui(assistantMessage, responseData, botProjection);
          }
          sendingMessages.push(assistantMessage);
          commitSuccessfulTurn(chatState, userMessage, assistantMessage);
          if (capturedMode !== "expert" || acceptedExpertResponse) {
            clearCapturedSelectionAfterAcceptance(
              chatState,
              capturedMode,
              capturedSelectedAgent
            );
          }
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
                UserStore.FedLogOut().finally(() => {
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
                  historyRow.query === messageContent &&
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
        const historyOpts =
          blockingDialogueId !== undefined ? { blockingDialogueId } : undefined;
        await getHistoryQuestionData(sendingDialogueId, historyOpts);

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

        // clear the file list
        if (chatState.fileList.length > 0) {
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
