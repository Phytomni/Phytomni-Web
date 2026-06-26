import { nextTick } from "vue";
import type { Ref } from "vue";
import type { ChatMessage, Chat } from "../types";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  extractAtValues,
  formatFileSize,
  isValidJSON,
  convertToTableData,
} from "../utils/format";
import { readServerFile } from "../utils/agent-log";
import {
  writePendingChat,
  clearPendingChat,
  isLocalStorageChat,
} from "@/utils/pending-chat";
import { isNetworkError } from "@/utils/network-error";
import { getQueryAbortable, getAnswerCheck } from "@/api/chat";

export function useSendMessage(opts: {
  getChatState: (dialogueId: string) => any;
  currentChatId: Ref<string>;
  currentChat: Ref<any>;
  senderRef: Ref<any>;
  currentRequestId: Ref<string>;
  isAborted: Ref<boolean>;
  t: (key: string) => string;
  userStore: () => any;
  getHistoryQuestionData: () => Promise<any> | any;
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
    senderRef,
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
    chatState.messageInput = "";

    const isNewChat =
      !currentChat.value?.messages || currentChat.value.messages.length === 0;
    if (isNewChat) currentChat.value = { messages: [] };

    // 创建用户消息，包含附件文件信息
    const userMessage = {
      role: "user",
      content: currentMessage,
      attachedFiles:
        chatState.fileList.length > 0 ? [...chatState.fileList] : undefined,
    };

    // 将文件信息添加到消息内容中，确保能保存在历史记录中
    let messageContent = currentMessage;
    if (chatState.fileList.length > 0) {
      const fileInfo = chatState.fileList
        .map((file: any) => `[附件: ${file.name} (${formatFileSize(file.size)})]`)
        .join("\n");
      messageContent = `${currentMessage}\n\n${fileInfo}`;
    }

    // 更新用户消息内容，包含文件信息
    userMessage.content = messageContent;

    currentChat.value.messages.push(userMessage);

    // Capture sending IDs and messages here so the write+clear below run against
    // a stable snapshot, immune to currentChatId / currentChat rotation during
    // the awaits below (scrollToBottom, getQueryAbortable, and finally
    // getHistoryQuestionData).
    const sendingDialogueId = currentChatId.value;
    const sendingMessages = currentChat.value.messages;
    const sendingTitle = messageContent;

    if (isNewChat && isLocalStorageChat(sendingDialogueId)) {
      writePendingChat(sendingDialogueId, sendingMessages, {
        title: sendingTitle,
        onError: () => ElMessage.warning(t("chat.pendingWriteFailed")),
      });
    }

    await scrollToBottom();

    try {
      const urlChatId = getDialogueIdFromChatId();
      const queryData = new FormData();
      queryData.append("query", messageContent); // 使用包含文件信息的消息内容
      queryData.append("id", (urlChatId ? Number(urlChatId) : 0).toString());
      queryData.append(
        "tool",
        newMessageValue.matches.length > 0
          ? newMessageValue.matches.join(",")
          : ""
      );
      if (chatState.historyQuestion) {
        queryData.append("history", JSON.stringify(chatState.historyQuestion));
      }
      if (chatState.fileList.length > 0) {
        chatState.fileList.forEach((fileItem: any) => {
          queryData.append("files", fileItem.file);
        });
      }

      // 生成请求ID
      currentRequestId.value = Date.now().toString();

      const response = await getQueryAbortable(
        queryData as any,
        currentRequestId.value
      );

      if (response.data) {
        let assistantMessage: ChatMessage | undefined;
        if (response.data.final_answer) {
          assistantMessage = {
            role: "assistant",
            content: response.data.final_answer || "抱歉，我无法回答这个问题。",
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

          // 同步新消息的点赞状态
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

              // 同步新消息的点赞状态
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
                server_file_path: response.data.server_file_path, // 添加服务器文件路径
              };

              // 如果有服务器文件路径，异步读取文件内容
              if (response.data.server_file_path) {
                // 先显示加载状态
                if (assistantMessage) {
                  assistantMessage.content = "正在加载文件内容...";
                }

                readServerFile(response.data.server_file_path)
                  .then((fileContent) => {
                    if (fileContent && fileContent.trim() && assistantMessage) {
                      assistantMessage.content = fileContent;
                    } else if (assistantMessage) {
                      assistantMessage.content = "文件内容为空或加载失败";
                    }
                    // 强制更新视图
                    nextTick(() => {
                      timestamp.value = Date.now();
                      scrollToBottom();
                    });
                  })
                  .catch((error) => {
                    console.error("读取DeepGenomeAgent文件失败:", error);
                    if (assistantMessage) {
                      assistantMessage.content = "文件加载失败，请稍后重试";
                    }
                    // 强制更新视图
                    nextTick(() => {
                      timestamp.value = Date.now();
                      scrollToBottom();
                    });
                  });
              }

              // 同步新消息的点赞状态
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
              // 打印新消息的 doc_list 数据
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

              // 同步新消息的点赞状态
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

              // 同步新消息的点赞状态
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

              // 同步新消息的点赞状态
              if (response.data.id && response.data.reaction_type) {
                chatState.reactions[response.data.id.toString()] = parseInt(
                  response.data.reaction_type
                );
              }
            } else {
              // 处理其他未知的工具类型，使用默认格式
              assistantMessage = {
                role: "assistant",
                content: response.data?.answer || "抱歉，我无法回答这个问题。",
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

              // 同步新消息的点赞状态
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

        // 确保 assistantMessage 已创建，避免推送 undefined
        if (assistantMessage) {
          currentChat.value.messages.push(assistantMessage);
        } else {
          // 如果 assistantMessage 未创建，创建默认消息
          console.warn("assistantMessage 未创建，使用默认消息");
          currentChat.value.messages.push({
            role: "assistant",
            content: response.data?.answer || "抱歉，我无法回答这个问题。",
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
          content: "抱歉，我无法回答这个问题。",
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

      // 检查是否是请求被中止
      if (
        error.name === "AbortError" ||
        error.code === "ERR_CANCELED" ||
        isAborted.value
      ) {
        return; // 中止请求时不显示错误消息
      }

      // 检查是否是token过期错误
      if (
        error.response &&
        error.response.data &&
        error.response.data.detail &&
        error.response.data.detail.code === 403
      ) {
        ElMessageBox.alert("登录已过期，请重新登录", "系统提示", {
          confirmButtonText: "我知道了",
          type: "warning",
          callback: () => {
            const UserStore = userStore();
            UserStore.FedLogOut().finally(() => {
              // 清除所有缓存和cookie
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

      // 检查是否是网络错误或超时错误，如果是，先验证消息是否已成功发送
      if (isNetworkError(error) && !isAborted.value) {
        try {
          // 等待一小段时间，让服务器有时间处理请求
          await new Promise((resolve) => setTimeout(resolve, 1000));

          // 如果是新对话，通过刷新历史记录来检查
          if (isNewChat) {
            await getHistoryQuestionData();
            // 如果历史记录中有新对话，说明消息已成功发送
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
            // 如果是已有对话，直接检查当前对话
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
                // 检查最后一条消息是否包含我们刚发送的消息
                const lastItem = checkRes.data[checkRes.data.length - 1];
                if (lastItem && lastItem.query === messageContent) {
                  await selectChat(urlDialogueId);
                  return;
                }
              }
            }
          }
        } catch (verifyError) {
          console.error("验证消息状态失败:", verifyError);
          // 验证失败，继续显示错误
        }
      }

      // 只有在未被中止的情况下才添加错误消息
      if (!isAborted.value) {
        currentChat.value.messages.push({
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
      }
    } finally {
      // 清理请求ID
      currentRequestId.value = "";

      // 无论是否是新对话，都刷新侧边栏历史记录数据
      await getHistoryQuestionData();

      // Clear the pending record using the captured sendingDialogueId. Using
      // currentChatId.value would clear the wrong key if the user switched
      // chats during the await above (chatStates parallel-chat model).
      if (isLocalStorageChat(sendingDialogueId)) {
        clearPendingChat(sendingDialogueId);
      }

      if (isNewChat) {
        // 如果是新对话，选择新创建的对话
        if (chatList.value.length > 0) {
          const newChat = chatList.value[0];
          currentChatId.value = newChat.dialogue_id;
          updateUrlWithChatId(newChat.dialogue_id);
        }
      } else {
        // 如果是已存在的对话，更新当前对话的标题（如果发生了变化）
        if (
          currentChat.value?.messages &&
          currentChat.value.messages.length > 0
        ) {
          const userMessage =
            currentChat.value.messages[currentChat.value.messages.length - 2]; // 倒数第二条是用户消息
          if (userMessage && userMessage.role === "user") {
            // 查找当前对话在列表中的位置并更新标题
            const currentChatIndex = chatList.value.findIndex(
              (chat) => chat.dialogue_id === currentChatId.value
            );
            if (currentChatIndex !== -1) {
              // 截取用户消息内容作为标题（限制长度）
              const newTitle =
                userMessage.content.length > 50
                  ? userMessage.content.substring(0, 50) + "..."
                  : userMessage.content;
              chatList.value[currentChatIndex].title = newTitle;
            }
          }
        }
      }

      // 清空文件列表
      if (chatState.fileList.length > 0) {
        chatState.fileList = [];
        // 确保文件列表清空后关闭header
        nextTick(() => {
          if (senderRef.value) {
            senderRef.value.closeHeader();
          }
        });
      }

      chatState.isSending = false;

      await scrollToBottom();
    }
  };

  return { sendMessage };
}
