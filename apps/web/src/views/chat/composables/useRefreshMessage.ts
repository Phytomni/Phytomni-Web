import { nextTick } from "vue";
import type { Ref } from "vue";
import type { ChatMessage, ChatUIState, ChatView } from "../types";
import { ElMessage } from "element-plus";
import i18n from "@/locales";
import { getQuery } from "@/api/chat";
import { createTransferTracker } from "@/utils/transfer-progress";
import { isValidJSON, convertToTableData } from "../utils/format";
import { readServerFile } from "../utils/agent-log";
import { chatContentToText, decodeAgentSteps } from "../messageTypes";

export function useRefreshMessage(opts: {
  currentChat: Ref<ChatView | null>;
  currentChatId: Ref<string>;
  getChatState: (dialogueId: string) => ChatUIState;
  scrollToBottom: () => void;
  getHistoryQuestionData: () => Promise<any> | any;
  getDialogueIdFromChatId: (chatId?: any) => any;
  timestamp: Ref<number>;
}) {
  const {
    currentChat,
    currentChatId,
    getChatState,
    scrollToBottom,
    getHistoryQuestionData,
    getDialogueIdFromChatId,
    timestamp,
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

    // set the refresh state - keyed by both messageIndex and messageId
    const refreshKey = `${messageIndex}_${messageId}`;
    chatState.refreshingMessages[refreshKey] = true;

    // set the overall sending state to true to show a loading state
    chatState.isSending = true;

    const isStillActive = () => currentChatId.value === refreshDialogueId;

    try {
      const urlChatId = getDialogueIdFromChatId();
      const queryData = new FormData();
      queryData.append("query", chatContentToText(userMessage.content));
      queryData.append("id", (urlChatId ? Number(urlChatId) : 0).toString());
      queryData.append("refresh_id", messageId);
      queryData.append("mode", chatState.mode);

      // add the tool param (if any)
      if (message.tool_name) {
        queryData.append("tool", message.tool_name);
      }

      // add the history (if any)
      if (chatState.historyQuestion) {
        queryData.append("history", JSON.stringify(chatState.historyQuestion));
      }

      // add files (if any)
      if (chatState.fileList.length > 0) {
        chatState.fileList.forEach((fileItem: any) => {
          queryData.append("files", fileItem.file);
        });
      }

      const hasFiles = chatState.fileList.length > 0;
      const tracker = hasFiles
        ? createTransferTracker({
            phase: "upload",
            requestId: Date.now().toString(),
          })
        : null;

      const response = await getQuery(
        queryData as any,
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
            followUpQuestions: response.data.follow_up_questions
              ? typeof response.data.follow_up_questions === "string"
                ? JSON.parse(response.data.follow_up_questions)
                : response.data.follow_up_questions
              : [],
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
                followUpQuestions: response.data.follow_up_questions
                  ? typeof response.data.follow_up_questions === "string"
                    ? JSON.parse(response.data.follow_up_questions)
                    : response.data.follow_up_questions
                  : [],
                showFollowUpQuestions: false,
                showLog: false,
              };
            } else if (response.data.tool_name === "DeepGenomeAgent") {
              const contentData = isValidJSON(response.data.answer)
                ? JSON.parse(response.data.answer)
                : response.data.answer;
              newAssistantMessage = {
                role: "assistant",
                content: contentData?.content || response.data.answer,
                doc_list: contentData?.doc_list,
                status: response.data?.status || "",
                upload_path: response.data?.upload_path || "",
                instantMessage: true,
                tool_name: response.data.tool_name,
                id: response.data.id,
                followUpQuestions: response.data.follow_up_questions
                  ? typeof response.data.follow_up_questions === "string"
                    ? JSON.parse(response.data.follow_up_questions)
                    : response.data.follow_up_questions
                  : [],
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
                        scrollToBottom();
                      }
                    });
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
                        scrollToBottom();
                      }
                    });
                  });
              }
            } else if (
              response.data.tool_name === "KnowledgeAgent" ||
              response.data.tool_name === "ReviewAgent" ||
              response.data.tool_name === "BriefGeneAgent"
            ) {
              const contentData = isValidJSON(response.data.answer)
                ? JSON.parse(response.data.answer)
                : response.data.answer;
              // log the refreshed message's doc_list data
              newAssistantMessage = {
                role: "assistant",
                content: contentData.content,
                doc_list: contentData.doc_list,
                status: response.data?.status || "",
                upload_path: response.data?.upload_path || "",
                instantMessage: true,
                tool_name: response.data.tool_name,
                id: response.data.id,
                followUpQuestions: response.data.follow_up_questions
                  ? typeof response.data.follow_up_questions === "string"
                    ? JSON.parse(response.data.follow_up_questions)
                    : response.data.follow_up_questions
                  : [],
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
              const contentData = isValidJSON(response.data.answer)
                ? JSON.parse(response.data.answer)
                : response.data.answer;
              const tableData = convertToTableData(contentData);
              newAssistantMessage = {
                role: "assistant",
                content: tableData,
                tableHeaders: contentData.headers.map((header: string) => ({
                  prop: header.replace(/\s+/g, "_").toLowerCase(),
                  label: header,
                })),
                status: response.data?.status || "",
                upload_path: response.data?.upload_path || "",
                instantMessage: true,
                original: response.data.answer,
                tool_name: response.data.tool_name,
                id: response.data.id,
                followUpQuestions: response.data.follow_up_questions
                  ? typeof response.data.follow_up_questions === "string"
                    ? JSON.parse(response.data.follow_up_questions)
                    : response.data.follow_up_questions
                  : [],
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
                followUpQuestions: response.data.follow_up_questions
                  ? typeof response.data.follow_up_questions === "string"
                    ? JSON.parse(response.data.follow_up_questions)
                    : response.data.follow_up_questions
                  : [],
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
              followUpQuestions: response.data.follow_up_questions
                ? typeof response.data.follow_up_questions === "string"
                  ? JSON.parse(response.data.follow_up_questions)
                  : response.data.follow_up_questions
                : [],
              showFollowUpQuestions: false,
              showLog: false,
            };
          }
        }

        // update the captured message array only
        if (newAssistantMessage) {
          targetMessages[messageIndex] = newAssistantMessage;

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
    } catch (error: any) {
      console.error("Failed to refresh message:", error);
      if (isStillActive()) {
        ElMessage.error(i18n.global.t("common.refreshFailedRetry"));
      }
    } finally {
      if (isStillActive()) {
        nextTick(() => {
          scrollToBottom();
        });
      }

      // clean up the old refresh state
      if (chatState.refreshingMessages[refreshKey]) {
        delete chatState.refreshingMessages[refreshKey];
      }

      // reset the overall sending state
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
