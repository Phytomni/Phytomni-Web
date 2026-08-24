import { nextTick } from "vue";
import type { Ref } from "vue";
import type {
  ChatMessage,
  ChatUIState,
  ChatView,
  DialogueReconciliationResult,
} from "../types";
import { ElMessage } from "element-plus";
import i18n from "@/locales";
import { getQuery } from "@/api/chat";
import { normalizePositiveTaskRowId } from "@/api/task";
import type { BotCapabilityByTool } from "./useBotCapabilities";
import { shouldStream } from "../streaming/sendBranch";
import { useStreamMessage } from "./useStreamMessage";
import {
  convertToTableData,
  decodeCitationDocuments,
  decodeTableDataInput,
  optionalStringValue,
  parseAgentAnswer,
} from "../utils/format";
import { readServerFile } from "../utils/agent-log";
import {
  chatContentToText,
  decodeAgentSteps,
  decodeFollowUpQuestions,
} from "../messageTypes";
import {
  createClientTurnId,
  isDefinitePreDispatch4xx,
} from "../utils/client-turn-id";
import {
  completedUploadDisplays,
  toAssetAttachmentRefs,
} from "../utils/asset-attachments";
import { projectHistoryForTransport } from "../utils/chat-history-normalization";

function refreshParentRowId(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  try {
    return Number(normalizePositiveTaskRowId(value));
  } catch {
    return null;
  }
}

function durableRefreshRowId(value: unknown): string | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  try {
    return normalizePositiveTaskRowId(value);
  } catch {
    return null;
  }
}

function refreshToolForMode(
  mode: ChatUIState["mode"],
  toolName: unknown
): string | null {
  if (mode !== "expert") return "";
  if (typeof toolName !== "string") return null;
  const tool = toolName.trim();
  return tool === "" ? null : tool;
}

function snapshotAssistant(message: ChatMessage): ChatMessage {
  return {
    ...message,
    blocks: message.blocks?.map((block) => ({ ...block })),
    followUpQuestions: message.followUpQuestions
      ? [...message.followUpQuestions]
      : undefined,
  };
}

function advertisedStreamAgents(capabilities: BotCapabilityByTool): string[] {
  return Object.values(capabilities).flatMap((capability) =>
    capability?.enabled && capability.stream ? [capability.tool] : []
  );
}

function isConversationGoneRefreshError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || Array.isArray(error)) {
    return false;
  }
  const response = (error as { response?: unknown }).response;
  if (
    typeof response !== "object" ||
    response === null ||
    Array.isArray(response)
  ) {
    return false;
  }
  if ((response as { status?: unknown }).status !== 404) return false;
  const data = (response as { data?: unknown }).data;
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return false;
  }
  return (data as { message?: unknown }).message === "conversation not found";
}

export function useRefreshMessage(opts: {
  currentChat: Ref<ChatView | null>;
  currentChatId: Ref<string>;
  getChatState: (dialogueId: string) => ChatUIState;
  scrollToBottom: () => Promise<void>;
  getHistoryQuestionData: () =>
    | Promise<DialogueReconciliationResult | undefined>
    | DialogueReconciliationResult
    | undefined;
  getDialogueIdFromChatId: () => string | number | null | undefined;
  timestamp: Ref<number>;
  botCapabilitiesByTool: Readonly<Ref<BotCapabilityByTool>>;
}) {
  const {
    currentChat,
    currentChatId,
    getChatState,
    scrollToBottom,
    getHistoryQuestionData,
    getDialogueIdFromChatId,
    timestamp,
    botCapabilitiesByTool,
  } = opts;

  const refreshMessage = async (messageIndex: number) => {
    if (
      !currentChat.value?.messages ||
      messageIndex < 0 ||
      messageIndex >= currentChat.value.messages.length ||
      !currentChatId.value
    ) {
      return;
    }

    const message = currentChat.value.messages[messageIndex];
    if (!message || message.role !== "assistant") {
      return;
    }

    // get the corresponding user message
    const userMessage = currentChat.value.messages[messageIndex - 1];
    if (!userMessage || userMessage.role !== "user") {
      return;
    }

    const messageId = message.id;
    if (!messageId) {
      return;
    }

    // Capture dialogue state + message array before await so a late result
    // updates only that array and never B's DOM when the user has switched away.
    const refreshDialogueId = currentChatId.value;
    const chatState = getChatState(refreshDialogueId);
    const targetMessages = currentChat.value.messages;
    const capturedMode = chatState.mode;
    const isStillActive = () => currentChatId.value === refreshDialogueId;
    const parentRowId = refreshParentRowId(getDialogueIdFromChatId());
    const refreshId = durableRefreshRowId(messageId);
    const refreshTool = refreshToolForMode(capturedMode, message.tool_name);
    if (parentRowId === null || refreshId === null || refreshTool === null) {
      if (isStillActive()) {
        ElMessage.error(
          i18n.global.t(
            parentRowId === null
              ? "chat.refreshConversationGone"
              : "common.refreshFailedRetry"
          )
        );
      }
      return;
    }
    const replacementAttachments =
      chatState.fileList.length > 0
        ? completedUploadDisplays(chatState.fileList)
        : null;
    if (chatState.fileList.length > 0 && replacementAttachments === null) {
      return;
    }
    const attachmentRefs =
      replacementAttachments !== null
        ? toAssetAttachmentRefs(replacementAttachments)
        : toAssetAttachmentRefs(userMessage.attachments ?? []);
    const clientTurnId =
      chatState.refreshTurnIds[messageId] ?? createClientTurnId();
    chatState.refreshTurnIds[messageId] = clientTurnId;

    // set the refresh state - keyed by both messageIndex and messageId
    const refreshKey = `${messageIndex}_${messageId}`;
    chatState.refreshingMessages[refreshKey] = true;

    // set the overall sending state to true to show a loading state
    chatState.isSending = true;

    try {
      const queryData = new FormData();
      queryData.append("query", chatContentToText(userMessage.content));
      queryData.append("id", parentRowId.toString());
      queryData.append("refresh_id", refreshId);
      queryData.append("mode", capturedMode);
      queryData.append("tool", refreshTool);
      queryData.append("client_turn_id", clientTurnId);

      // add the history (if any)
      if (chatState.historyQuestion) {
        queryData.append(
          "history",
          JSON.stringify(projectHistoryForTransport(chatState.historyQuestion))
        );
      }

      queryData.append("attachments", JSON.stringify(attachmentRefs));

      const streamAgent =
        capturedMode === "instant" ? "ChatAgent" : refreshTool;
      const streamAgents = advertisedStreamAgents(botCapabilitiesByTool.value);
      if (
        shouldStream(streamAgent, capturedMode, {
          agents: streamAgents,
        })
      ) {
        const previousAssistant = snapshotAssistant(message);
        const placeholder: ChatMessage = {
          role: "assistant",
          content: "",
          streaming: true,
          blocks: [],
          instantMessage: false,
          id: refreshId,
          tool_name: streamAgent,
          followUpQuestions: [],
          showFollowUpQuestions: false,
          showLog: false,
          streamPresentationKey: clientTurnId,
        };
        targetMessages[messageIndex] = placeholder;
        chatState.activeRequestId = clientTurnId;
        chatState.activeAgentName = streamAgent;
        const getStreamChatState = (id: string) =>
          id === refreshDialogueId ? chatState : getChatState(id);
        const { streamMessage } = useStreamMessage({
          getChatState: getStreamChatState,
          t: (key) => String(i18n.global.t(key)),
        });
        const streamResult = await streamMessage({
          dialogueId: refreshDialogueId,
          formData: queryData,
          requestId: clientTurnId,
          placeholder,
          clientTurnId,
        });
        if (streamResult.completed === true) {
          delete chatState.refreshTurnIds[messageId];
          timestamp.value = Date.now();
          if (isStillActive()) {
            await scrollToBottom();
          }
          return;
        }
        if (streamResult.preDispatch4xx) {
          delete chatState.refreshTurnIds[messageId];
        }
        targetMessages[messageIndex] = previousAssistant;
        if (isStillActive()) {
          ElMessage.error(i18n.global.t("common.refreshFailedRetry"));
        }
        return;
      }

      const response = await getQuery(queryData, {
        suppressErrorToast: true,
      });

      if (response.data) {
        let newAssistantMessage: ChatMessage | undefined;
        if (response.data.final_answer) {
          newAssistantMessage = {
            role: "assistant",
            content:
              response.data.final_answer ||
              "Sorry, I cannot answer this question.",
            steps: decodeAgentSteps(response.data.steps),
            status: response.data?.status || "",
            upload_path: response.data?.upload_path || "",
            instantMessage: true,
            id: response.data.id || messageId, // keep the original id if there is no new one
            tool_name: response.data.tool_name,
            followUpQuestions: decodeFollowUpQuestions(
              response.data.follow_up_questions
            ),
            showFollowUpQuestions: false,
            showLog: false,
          };

          // sync the reaction state of the refreshed message
          if (response.data.id && response.data.reaction_type) {
            chatState.reactions[response.data.id.toString()] = parseInt(
              response.data.reaction_type
            );
          }
        } else {
          if (response.data.tool_name) {
            if (response.data.tool_name === "ChatAgent") {
              newAssistantMessage = {
                role: "assistant",
                content: response.data.answer,
                status: response.data?.status || "",
                upload_path: response.data?.upload_path || "",
                instantMessage: true,
                tool_name: response.data.tool_name,
                id: response.data.id || messageId, // keep the original id if there is no new one
                followUpQuestions: decodeFollowUpQuestions(
                  response.data.follow_up_questions
                ),
                showFollowUpQuestions: false,
                showLog: false,
              };
            } else if (response.data.tool_name === "DeepGenomeAgent") {
              const contentData = parseAgentAnswer(response.data.answer);
              newAssistantMessage = {
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
                if (newAssistantMessage) {
                  newAssistantMessage.content = "Loading file content...";
                }

                readServerFile(response.data.server_file_path)
                  .then((fileContent) => {
                    if (
                      fileContent &&
                      fileContent.trim() &&
                      newAssistantMessage
                    ) {
                      newAssistantMessage.content = fileContent;
                    } else if (newAssistantMessage) {
                      newAssistantMessage.content =
                        "File content is empty or failed to load";
                    }
                    nextTick(() => {
                      timestamp.value = Date.now();
                      if (isStillActive()) {
                        scrollToBottom().catch(() => undefined);
                      }
                    }).catch(() => undefined);
                  })
                  .catch((error) => {
                    console.error(
                      "Failed to read DeepGenomeAgent file:",
                      error
                    );
                    if (newAssistantMessage) {
                      newAssistantMessage.content =
                        "Failed to load file, please try again later";
                    }
                    nextTick(() => {
                      timestamp.value = Date.now();
                      if (isStillActive()) {
                        scrollToBottom().catch(() => undefined);
                      }
                    }).catch(() => undefined);
                  });
              }
            } else if (
              response.data.tool_name === "KnowledgeAgent" ||
              response.data.tool_name === "ReviewAgent" ||
              response.data.tool_name === "BriefGeneAgent"
            ) {
              const contentData = parseAgentAnswer(response.data.answer);
              // log the refreshed message's doc_list data
              newAssistantMessage = {
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

              // sync the reaction state of the refreshed message
              if (response.data.id && response.data.reaction_type) {
                chatState.reactions[response.data.id.toString()] = parseInt(
                  response.data.reaction_type
                );
              }
            } else if (response.data.tool_name === "DataAgent") {
              const contentData = parseAgentAnswer(response.data.answer);
              const tableInput = decodeTableDataInput(contentData);
              const tableData = convertToTableData(tableInput);
              newAssistantMessage = {
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

              // sync the reaction state of the refreshed message
              if (response.data.id && response.data.reaction_type) {
                chatState.reactions[response.data.id.toString()] = parseInt(
                  response.data.reaction_type
                );
              }
            } else if (response.data.tool_name === "AnalystAgent") {
              newAssistantMessage = {
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

              // sync the reaction state of the refreshed message
              if (response.data.id && response.data.reaction_type) {
                chatState.reactions[response.data.id.toString()] = parseInt(
                  response.data.reaction_type
                );
              }
            }
          } else {
            newAssistantMessage = {
              role: "assistant",
              content: response.data.answer,
              status: response.data?.status || "",
              upload_path: response.data?.upload_path || "",
              instantMessage: true,
              tool_name: response.data?.tool_name || "",
              id: response.data.id || messageId, // keep the original id if there is no new one
              followUpQuestions: decodeFollowUpQuestions(
                response.data.follow_up_questions
              ),
              showFollowUpQuestions: false,
              showLog: false,
            };
          }
        }

        // update the captured message array only
        if (newAssistantMessage) {
          targetMessages[messageIndex] = newAssistantMessage;
          // The captured target ID is already durable; every successful
          // replacement settles the logical refresh turn, even if a legacy
          // response omits a replacement ID and keeps the original row.
          delete chatState.refreshTurnIds[messageId];

          // clean up the old refresh state
          if (chatState.refreshingMessages[refreshKey]) {
            delete chatState.refreshingMessages[refreshKey];
          }

          // set the refresh state for the new message - using the new key
          const newRefreshKey = `${messageIndex}_${
            newAssistantMessage.id || "temp"
          }`;
          chatState.refreshingMessages[newRefreshKey] = false;

          if (isStillActive()) {
            await scrollToBottom();
          }
        }
      }
    } catch (error: unknown) {
      console.error("Failed to refresh message:", error);
      if (isDefinitePreDispatch4xx(error)) {
        delete chatState.refreshTurnIds[messageId];
      }
      if (isStillActive()) {
        ElMessage.error(
          i18n.global.t(
            isConversationGoneRefreshError(error)
              ? "chat.refreshConversationGone"
              : "common.refreshFailedRetry"
          )
        );
      }
    } finally {
      if (isStillActive()) {
        nextTick(() => {
          scrollToBottom().catch(() => undefined);
        }).catch(() => undefined);
      }

      // clean up the old refresh state
      if (chatState.refreshingMessages[refreshKey]) {
        delete chatState.refreshingMessages[refreshKey];
      }

      // reset the overall sending state
      if (chatState.activeRequestId === clientTurnId) {
        chatState.activeRequestId = "";
        chatState.activeAgentName = "";
      }
      chatState.isSending = false;
      chatState.uploadTransfer = null;

      // refresh the sidebar history data to show the latest conversation info
      try {
        await getHistoryQuestionData();
      } catch (error) {
        console.error("Failed to refresh sidebar data:", error);
      }
    }
  };

  return { refreshMessage };
}
