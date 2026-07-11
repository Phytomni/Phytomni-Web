import { nextTick } from "vue";
import type { Ref } from "vue";
import type { ChatComposerHandle, ChatMessage, Chat, DialogueReconciliationResult } from "../types";
import { ElMessage, ElMessageBox } from "element-plus";
import i18n from "@/locales";
import {
  extractAtValues,
  formatFileSize,
  isValidJSON,
  convertToTableData,
} from "../utils/format";
import { readServerFile } from "../utils/agent-log";
import {
  writePendingChat,
  isLocalStorageChat,
} from "@/utils/pending-chat";
import { isNetworkError } from "@/utils/network-error";
import { getQueryAbortable, getAnswerCheck } from "@/api/chat";
import { createTransferTracker } from "@/utils/transfer-progress";
import { shouldStream } from "../streaming/sendBranch";
import { useStreamMessage } from "./useStreamMessage";

export function useSendMessage(opts: {
  getChatState: (dialogueId: string) => any;
  currentChatId: Ref<string>;
  currentChat: Ref<any>;
  composerRef: Ref<ChatComposerHandle | null>;
  currentRequestId: Ref<string>;
  isAborted: Ref<boolean>;
  t: (key: string) => string;
  userStore: () => any;
  getHistoryQuestionData: (
    sendingDialogueId?: string,
    options?: { blockingDialogueId?: string }
  ) => Promise<DialogueReconciliationResult | undefined> | DialogueReconciliationResult | undefined;
  updateUrlWithChatId: (dialogueId: string) => void;
  chatList: Ref<Chat[]>;
  timestamp: Ref<number>;
  selectChat: (dialogueId: string) => Promise<void> | void;
  getDialogueIdFromChatId: (chatId?: any) => any;
  getChatIdFromUrl: () => any;
  scrollToBottom: () => void;
}) {
  const {
    getChatState,
    currentChatId,
    currentChat,
    composerRef,
    currentRequestId,
    isAborted,
    t,
    userStore,
    getHistoryQuestionData,
    updateUrlWithChatId,
    chatList,
    timestamp,
    selectChat,
    getDialogueIdFromChatId,
    getChatIdFromUrl,
    scrollToBottom,
  } = opts;

  const sendMessage = async () => {
    if (!currentChatId.value) return;

    const chatState = getChatState(currentChatId.value);
    if (!chatState || !chatState.messageInput.trim() || chatState.isSending)
      return;

    const newMessageValue = extractAtValues(chatState.messageInput);
    const currentMessage = newMessageValue.cleanedText;
    if (!currentMessage.trim()) return;

    chatState.isSending = true;
    isAborted.value = false;
    chatState.sendStartedAt = Date.now();
    chatState.activeAgentName =
      newMessageValue.matches.length > 0
        ? newMessageValue.matches[0]
        : "ChatAgent";
    chatState.completing = false;
    chatState.messageInput = "";

    const isNewChat =
      !currentChat.value?.messages || currentChat.value.messages.length === 0;
    if (isNewChat) currentChat.value = { messages: [] };

    // build the user message, including attached file info
    const userMessage = {
      role: "user",
      content: currentMessage,
      attachedFiles:
        chatState.fileList.length > 0 ? [...chatState.fileList] : undefined,
    };

    // append file info to the message content so it persists in history
    let messageContent = currentMessage;
    if (chatState.fileList.length > 0) {
      const fileInfo = chatState.fileList
        .map((file: any) => `[Attachment: ${file.name} (${formatFileSize(file.size)})]`)
        .join("\n");
      messageContent = `${currentMessage}\n\n${fileInfo}`;
    }

    // update the user message content to include file info
    userMessage.content = messageContent;

    currentChat.value.messages.push(userMessage);

    // Capture sending IDs and messages here so the write+clear below run against
    // a stable snapshot, immune to currentChatId / currentChat rotation during
    // the awaits below (scrollToBottom, getQueryAbortable, and finally
    // getHistoryQuestionData).
    const sendingDialogueId = currentChatId.value;
    const sendingMessages = currentChat.value.messages;
    const sendingTitle = messageContent;
    let blockingDialogueId: string | undefined;

    if (isNewChat && isLocalStorageChat(sendingDialogueId)) {
      writePendingChat(sendingDialogueId, sendingMessages, {
        title: sendingTitle,
        mode: chatState.mode,
        onError: () => ElMessage.warning(t("chat.pendingWriteFailed")),
      });
    }

    await scrollToBottom();

    try {
      const urlChatId = getDialogueIdFromChatId();
      const queryData = new FormData();
      queryData.append("query", messageContent); // use the message content that includes file info
      queryData.append("id", (urlChatId ? Number(urlChatId) : 0).toString());
      queryData.append(
        "tool",
        chatState.mode === "expert"
          ? ""
          : newMessageValue.matches.length > 0
            ? newMessageValue.matches.join(",")
            : ""
      );
      queryData.append("mode", chatState.mode);
      if (chatState.historyQuestion) {
        queryData.append("history", JSON.stringify(chatState.historyQuestion));
      }
      if (chatState.fileList.length > 0) {
        chatState.fileList.forEach((fileItem: any) => {
          queryData.append("files", fileItem.file);
        });
      }

      // generate a request ID
      currentRequestId.value = Date.now().toString();

      // Stream branch: chat-family + instant mode + dark-launch flag. The
      // insertion point is inside the existing try, so returning here still
      // runs the enclosing finally (request-id cleanup, history refresh via
      // coordinator, title update, fileList clear) exactly once — no duplicate
      // cleanup needed, and none is done here.
      const streamFlag = import.meta.env.VITE_STREAM_ENABLED === "true";
      if (shouldStream(chatState.activeAgentName, chatState.mode, streamFlag)) {
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
        };
        currentChat.value.messages.push(placeholder);
        // Bind stream lookups to the captured state object so a post-rekey
        // getChatState(oldTempId) cannot resurrect an empty temp record.
        const getStreamChatState = (id: string) =>
          id === sendingDialogueId ? chatState : getChatState(id);
        const { streamMessage } = useStreamMessage({
          getChatState: getStreamChatState,
          t,
        });
        await streamMessage({
          dialogueId: sendingDialogueId,
          formData: queryData,
          requestId: currentRequestId.value,
          placeholder,
        });
        return;
      }

      const hasFiles = chatState.fileList.length > 0;
      const tracker = hasFiles
        ? createTransferTracker({
            phase: "upload",
            requestId: currentRequestId.value,
          })
        : null;

      const response = await getQueryAbortable(
        queryData as any,
        currentRequestId.value,
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
      if (!isAborted.value) {
        chatState.completing = true;
        await new Promise((resolve) => setTimeout(resolve, 300));
      }

      if (response.data) {
        if (
          typeof response.data.dialogue_id === "string" &&
          response.data.dialogue_id !== ""
        ) {
          blockingDialogueId = response.data.dialogue_id;
        }
        let assistantMessage: ChatMessage | undefined;
        if (response.data.final_answer) {
          assistantMessage = {
            role: "assistant",
            content: response.data.final_answer || "Sorry, I cannot answer this question.",
            steps: response.data.steps || [],
            status: response.data?.status || "",
            upload_path: response.data?.upload_path || "",
            instantMessage: true,
            id: response.data.id,
            followUpQuestions: response.data.follow_up_questions
              ? typeof response.data.follow_up_questions === "string"
                ? JSON.parse(response.data.follow_up_questions)
                : response.data.follow_up_questions
              : [],
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
                followUpQuestions: response.data.follow_up_questions
                  ? typeof response.data.follow_up_questions === "string"
                    ? JSON.parse(response.data.follow_up_questions)
                    : response.data.follow_up_questions
                  : [],
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
              const contentData = isValidJSON(response.data.answer)
                ? JSON.parse(response.data.answer)
                : response.data.answer;
              assistantMessage = {
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
                if (assistantMessage) {
                  assistantMessage.content = "Loading file content...";
                }

                readServerFile(response.data.server_file_path)
                  .then((fileContent) => {
                    if (fileContent && fileContent.trim() && assistantMessage) {
                      assistantMessage.content = fileContent;
                    } else if (assistantMessage) {
                      assistantMessage.content = "File content is empty or failed to load";
                    }
                    // force a view update
                    nextTick(() => {
                      timestamp.value = Date.now();
                      scrollToBottom();
                    });
                  })
                  .catch((error) => {
                    console.error("Failed to read DeepGenomeAgent file:", error);
                    if (assistantMessage) {
                      assistantMessage.content = "Failed to load file, please try again later";
                    }
                    // force a view update
                    nextTick(() => {
                      timestamp.value = Date.now();
                      scrollToBottom();
                    });
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
              const contentData = isValidJSON(response.data.answer)
                ? JSON.parse(response.data.answer)
                : response.data.answer;
              // log the new message's doc_list data
              assistantMessage = {
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

              // sync the reaction state of the new message
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
              assistantMessage = {
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
                followUpQuestions: response.data.follow_up_questions
                  ? typeof response.data.follow_up_questions === "string"
                    ? JSON.parse(response.data.follow_up_questions)
                    : response.data.follow_up_questions
                  : [],
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
                content: response.data?.answer || "Sorry, I cannot answer this question.",
                status: response.data?.status || "",
                upload_path: response.data?.upload_path || "",
                download_path: response.data?.download_path || "",
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

        // ensure assistantMessage was created to avoid pushing undefined
        if (assistantMessage) {
          currentChat.value.messages.push(assistantMessage);
        } else {
          // if assistantMessage was not created, create a default message
          console.warn("assistantMessage was not created; using a default message");
          currentChat.value.messages.push({
            role: "assistant",
            content: response.data?.answer || "Sorry, I cannot answer this question.",
            status: response.data?.status || "",
            upload_path: response.data?.upload_path || "",
            download_path: response.data?.download_path || "",
            instantMessage: true,
            tool_name: response.data?.tool_name || "",
            id: response.data?.id,
            followUpQuestions: [],
            showFollowUpQuestions: false,
            showLog: false,
          });
        }
      } else {
        currentChat.value.messages.push({
          role: "assistant",
          content: "Sorry, I cannot answer this question.",
          steps: [],
          status: "",
          upload_path: "",
          download_path: "",
          instantMessage: true,
          tool_name: response.data?.tool_name || "",
          followUpQuestions: [],
          showFollowUpQuestions: false,
          showLog: false,
        });
      }
    } catch (error: any) {
      console.error(t("chat.logs.sendMessageFailed"), error);

      // check whether the request was aborted
      if (
        error.name === "AbortError" ||
        error.code === "ERR_CANCELED" ||
        isAborted.value
      ) {
        return; // don't show an error message when the request is aborted
      }

      // check whether it's a token-expired error
      if (
        error.response &&
        error.response.data &&
        error.response.data.detail &&
        error.response.data.detail.code === 403
      ) {
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
        });
        return;
      }

      // check for a network/timeout error; if so, first verify whether the message was sent successfully
      if (isNetworkError(error) && !isAborted.value) {
        try {
          // wait a short while to give the server time to process the request
          await new Promise((resolve) => setTimeout(resolve, 1000));

          // for a new chat, check by refreshing the history
          if (isNewChat) {
            await getHistoryQuestionData();
            // if the history has a new chat, the message was sent successfully
            if (chatList.value.length > 0) {
              const newChat = chatList.value[0];
              const checkRes = await getAnswerCheck({
                dialogue_id: newChat.dialogue_id,
              });
              if (
                checkRes.code === 200 &&
                checkRes.data &&
                checkRes.data.length > 0
              ) {
                return;
              }
            }
          } else {
            // for an existing chat, check the current conversation directly
            const urlDialogueId = getChatIdFromUrl();
            if (urlDialogueId) {
              const checkRes = await getAnswerCheck({
                dialogue_id: urlDialogueId,
              });
              if (
                checkRes.code === 200 &&
                checkRes.data &&
                checkRes.data.length > 0
              ) {
                // check whether the last message contains the one we just sent
                const lastItem = checkRes.data[checkRes.data.length - 1];
                if (lastItem && lastItem.query === messageContent) {
                  await selectChat(urlDialogueId);
                  return;
                }
              }
            }
          }
        } catch (verifyError) {
          console.error("Failed to verify message status:", verifyError);
          // verification failed; continue to show the error
        }
      }

      // only add an error message if not aborted
      if (!isAborted.value) {
        const isTimeout = error.response?.status === 504;
        currentChat.value.messages.push({
          role: "assistant",
          content: isTimeout ? t("chat.timeoutFailed") : t("chat.sendFailed"),
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
      // clean up the request ID
      currentRequestId.value = "";
      chatState.uploadTransfer = null;

      const historyOpts =
        blockingDialogueId !== undefined
          ? { blockingDialogueId }
          : undefined;
      await getHistoryQuestionData(sendingDialogueId, historyOpts);

      if (!isNewChat) {
        // for an existing chat, update the current conversation's title (if it changed)
        if (
          currentChat.value?.messages &&
          currentChat.value.messages.length > 0
        ) {
          const userMessage =
            currentChat.value.messages[currentChat.value.messages.length - 2]; // the second-to-last is the user message
          if (userMessage && userMessage.role === "user") {
            // find the current conversation in the list and update its title
            const currentChatIndex = chatList.value.findIndex(
              (chat) => chat.dialogue_id === currentChatId.value
            );
            if (currentChatIndex !== -1) {
              // take the user message content as the title (length-limited)
              const newTitle =
                userMessage.content.length > 50
                  ? userMessage.content.substring(0, 50) + "..."
                  : userMessage.content;
              chatList.value[currentChatIndex].title = newTitle;
            }
          }
        }
      }

      // clear the file list
      if (chatState.fileList.length > 0) {
        chatState.fileList = [];
        // close the header after clearing the file list
        nextTick(() => {
          if (composerRef.value) {
            composerRef.value.closeHeader();
          }
        });
      }

      chatState.isSending = false;
      chatState.sendStartedAt = null;
      chatState.completing = false;
      chatState.activeAgentName = "";

      await scrollToBottom();
    }
  };

  return { sendMessage };
}
