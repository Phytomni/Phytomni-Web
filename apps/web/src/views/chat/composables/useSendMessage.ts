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
import { createChatRequestKey } from "../utils/chat-request-key";
import { parentRowIdForDialogue } from "../utils/chat-parent-row";

export function useSendMessage(opts: {
  getChatState: (dialogueId: string) => any;
  currentChatId: Ref<string>;
  currentChat: Ref<any>;
  composerRef: Ref<ChatComposerHandle | null>;
  t: (key: string) => string;
  userStore: () => any;
  getHistoryQuestionData: (
    sendingDialogueId?: string,
    options?: { blockingDialogueId?: string }
  ) => Promise<DialogueReconciliationResult | undefined> | DialogueReconciliationResult | undefined;
  chatList: Ref<Chat[]>;
  timestamp: Ref<number>;
  selectChat: (dialogueId: string) => Promise<void> | void;
  scrollToBottom: () => void;
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
    if (!chatState || !chatState.messageInput.trim() || chatState.isSending)
      return;

    const newMessageValue = extractAtValues(chatState.messageInput);
    const currentMessage = newMessageValue.cleanedText;
    if (!currentMessage.trim()) return;

    // Capture parent row, files, mode, history, and request key before any await
    // so an A→B switch during scrollToBottom cannot retarget the payload.
    const parentRowId = parentRowIdForDialogue(
      sendingDialogueId,
      chatList.value
    );
    const capturedFiles = [...chatState.fileList];
    const capturedMode = chatState.mode;
    const capturedHistory = chatState.historyQuestion;
    const capturedMatches = [...newMessageValue.matches];
    const requestKey = createChatRequestKey();

    chatState.isSending = true;
    chatState.generationStopped = false;
    chatState.activeRequestId = requestKey;
    chatState.sendStartedAt = Date.now();
    chatState.activeAgentName =
      capturedMatches.length > 0 ? capturedMatches[0] : "ChatAgent";
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
          (file: any) =>
            `[Attachment: ${file.name} (${formatFileSize(file.size)})]`
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
      writePendingChat(sendingDialogueId, sendingMessages, {
        title: sendingTitle,
        mode: capturedMode,
        onError: () => {
          if (isForeground(sendingDialogueId)) {
            ElMessage.warning(t("chat.pendingWriteFailed"));
          }
        },
      });
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
        capturedMode === "expert"
          ? ""
          : capturedMatches.length > 0
            ? capturedMatches.join(",")
            : ""
      );
      queryData.append("mode", capturedMode);
      if (capturedHistory) {
        queryData.append("history", JSON.stringify(capturedHistory));
      }
      if (capturedFiles.length > 0) {
        capturedFiles.forEach((fileItem: any) => {
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
        await streamMessage({
          dialogueId: sendingDialogueId,
          formData: queryData,
          requestId: requestKey,
          placeholder,
        });
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
        queryData as any,
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
                    // force a view update (foreground only — do not bump shared
                    // timestamp / scroll while the user is on another dialogue)
                    nextTick(() => {
                      if (isForeground(sendingDialogueId)) {
                        timestamp.value = Date.now();
                        scrollToBottom();
                      }
                    });
                  })
                  .catch((error) => {
                    console.error("Failed to read DeepGenomeAgent file:", error);
                    if (assistantMessage) {
                      assistantMessage.content = "Failed to load file, please try again later";
                    }
                    nextTick(() => {
                      if (isForeground(sendingDialogueId)) {
                        timestamp.value = Date.now();
                        scrollToBottom();
                      }
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
        } else {
          // if assistantMessage was not created, create a default message
          console.warn("assistantMessage was not created; using a default message");
          sendingMessages.push({
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
      } else if (
        chatState.activeRequestId === requestKey &&
        !chatState.generationStopped
      ) {
        sendingMessages.push({
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
      if (
        error.response &&
        error.response.data &&
        error.response.data.detail &&
        error.response.data.detail.code === 403
      ) {
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
          });
        }
        return;
      }

      // check for a network/timeout error; if so, first verify whether the message was sent successfully
      if (isNetworkError(error) && !chatState.generationStopped) {
        try {
          // wait a short while to give the server time to process the request
          await new Promise((resolve) => setTimeout(resolve, 1000));

          // for a new chat, check by refreshing the history — foreground only so
          // background recovery cannot refresh chatList while the user is on B.
          if (isNewChat) {
            if (isForeground(sendingDialogueId)) {
              await getHistoryQuestionData(sendingDialogueId);
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
            }
          } else {
            // for an existing chat, check the captured sending dialogue directly
            const checkRes = await getAnswerCheck({
              dialogue_id: sendingDialogueId,
            });
            if (
              checkRes.code === 200 &&
              checkRes.data &&
              checkRes.data.length > 0
            ) {
              // check whether the last message contains the one we just sent
              const lastItem = checkRes.data[checkRes.data.length - 1];
              if (lastItem && lastItem.query === messageContent) {
                if (isForeground(sendingDialogueId)) {
                  await selectChat(sendingDialogueId);
                }
                return;
              }
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
        const isTimeout = error.response?.status === 504;
        sendingMessages.push({
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
      const historyOpts =
        blockingDialogueId !== undefined
          ? { blockingDialogueId }
          : undefined;
      await getHistoryQuestionData(sendingDialogueId, historyOpts);

      if (!isNewChat) {
        // for an existing chat, update the sending conversation's title (if it changed)
        if (sendingMessages.length > 0) {
          const userMessage =
            sendingMessages[sendingMessages.length - 2]; // the second-to-last is the user message
          if (userMessage && userMessage.role === "user") {
            // find the sending conversation in the list and update its title
            const currentChatIndex = chatList.value.findIndex(
              (chat) => chat.dialogue_id === sendingDialogueId
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

      // Clear lifecycle fields only for this request — never a newer same-dialogue key
      // and never recreate a rekeyed temp state via getChatState(oldTempId).
      if (chatState.activeRequestId === requestKey) {
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
            });
          }
        }

        chatState.isSending = false;
        chatState.sendStartedAt = null;
        chatState.completing = false;
        chatState.activeAgentName = "";
      }

      if (isForeground(sendingDialogueId)) {
        await scrollToBottom();
      }
    }
  };

  return { sendMessage };
}
