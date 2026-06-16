import { nextTick } from "vue";
import type { Ref } from "vue";
import type { ChatMessage } from "../types";
import { ElMessage } from "element-plus";
import { getQuery } from "@/api/chat";
import { isValidJSON, convertToTableData } from "../utils/format";
import { readServerFile } from "../utils/agent-log";

export function useRefreshMessage(opts: {
  currentChat: Ref<any>;
  currentChatId: Ref<string>;
  getChatState: (dialogueId: string) => any;
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

    // 获取对应的用户消息
    const userMessage = currentChat.value.messages[messageIndex - 1];
    if (!userMessage || userMessage.role !== "user") {
      return;
    }

    const messageId = message.id;
    if (!messageId) {
      return;
    }

    const chatState = getChatState(currentChatId.value);
    if (!chatState) {
      return;
    }

    // 设置刷新状态 - 同时使用messageIndex和messageId作为键值
    const refreshKey = `${messageIndex}_${messageId}`;
    chatState.refreshingMessages[refreshKey] = true;

    // 设置整体发送状态为true，显示加载状态
    chatState.isSending = true;

    try {
      const urlChatId = getDialogueIdFromChatId();
      const queryData = new FormData();
      queryData.append("query", userMessage.content);
      queryData.append("id", (urlChatId ? Number(urlChatId) : 0).toString());
      queryData.append("refresh_id", messageId);

      // 添加工具参数（如果有的话）
      if (message.tool_name) {
        queryData.append("tool", message.tool_name);
      }

      // 添加历史记录（如果有的话）
      if (chatState.historyQuestion) {
        queryData.append("history", JSON.stringify(chatState.historyQuestion));
      }

      // 添加文件（如果有的话）
      if (chatState.fileList.length > 0) {
        chatState.fileList.forEach((fileItem: any) => {
          queryData.append("files", fileItem.file);
        });
      }

      const response = await getQuery(queryData as any);

      if (response.data) {
        let newAssistantMessage: ChatMessage | undefined;
        if (response.data.final_answer) {
          newAssistantMessage = {
            role: "assistant",
            content: response.data.final_answer || "抱歉，我无法回答这个问题。",
            steps: response.data.steps || [],
            status: response.data?.status || "",
            upload_path: response.data?.upload_path || "",
            instantMessage: true,
            id: response.data.id || messageId, // 如果没有新ID，保留原ID
            tool_name: response.data.tool_name,
            followUpQuestions: response.data.follow_up_questions
              ? typeof response.data.follow_up_questions === "string"
                ? JSON.parse(response.data.follow_up_questions)
                : response.data.follow_up_questions
              : [],
            showFollowUpQuestions: false,
            showLog: false,
          };

          // 同步刷新后消息的点赞状态
          if (response.data.id && response.data.reaction_type) {
            chatState.reactions[response.data.id.toString()] = parseInt(
              response.data.reaction_type
            );
          }
        } else {
          if (response.data.tool_name) {
            if (
              response.data.tool_name === "ChatAgents" ||
              response.data.tool_name === "ChatAgent"
            ) {
              newAssistantMessage = {
                role: "assistant",
                content: response.data.answer,
                status: response.data?.status || "",
                upload_path: response.data?.upload_path || "",
                instantMessage: true,
                tool_name: response.data.tool_name,
                id: response.data.id || messageId, // 如果没有新ID，保留原ID
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
                server_file_path: response.data.server_file_path, // 添加服务器文件路径
              };

              // 如果有服务器文件路径，异步读取文件内容
              if (response.data.server_file_path) {
                // 先显示加载状态
                if (newAssistantMessage) {
                  newAssistantMessage.content = "正在加载文件内容...";
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
                      newAssistantMessage.content = "文件内容为空或加载失败";
                    }
                    // 强制更新视图
                    nextTick(() => {
                      timestamp.value = Date.now();
                      scrollToBottom();
                    });
                  })
                  .catch((error) => {
                    console.error("读取DeepGenomeAgent文件失败:", error);
                    if (newAssistantMessage) {
                      newAssistantMessage.content = "文件加载失败，请稍后重试";
                    }
                    // 强制更新视图
                    nextTick(() => {
                      timestamp.value = Date.now();
                      scrollToBottom();
                    });
                  });
              }
            } else if (
              response.data.tool_name === "KnowledgeAgents" ||
              response.data.tool_name === "ReviewAgent" ||
              response.data.tool_name === "KnowledgeAgent" ||
              response.data.tool_name === "ReviewAgent" ||
              response.data.tool_name === "BriefReviewAgent"
            ) {
              const contentData = isValidJSON(response.data.answer)
                ? JSON.parse(response.data.answer)
                : response.data.answer;
              // 打印刷新消息的 doc_list 数据
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

              // 同步刷新后消息的点赞状态
              if (response.data.id && response.data.reaction_type) {
                chatState.reactions[response.data.id.toString()] = parseInt(
                  response.data.reaction_type
                );
              }
            } else if (
              response.data.tool_name === "DatabaseAgents" ||
              response.data.tool_name === "DataAgent"
            ) {
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

              // 同步刷新后消息的点赞状态
              if (response.data.id && response.data.reaction_type) {
                chatState.reactions[response.data.id.toString()] = parseInt(
                  response.data.reaction_type
                );
              }
            } else if (response.data.tool_name === "AnalysisAgents") {
              newAssistantMessage = {
                role: "assistant",
                content: "任务执行中，请等待",
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

              // 同步刷新后消息的点赞状态
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

              // 同步刷新后消息的点赞状态
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
              id: response.data.id || messageId, // 如果没有新ID，保留原ID
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

        // 更新消息
        if (newAssistantMessage) {
          currentChat.value.messages[messageIndex] = newAssistantMessage;

          // 清理旧的刷新状态
          if (chatState.refreshingMessages[refreshKey]) {
            delete chatState.refreshingMessages[refreshKey];
          }

          // 为新消息设置刷新状态 - 使用新的键值
          const newRefreshKey = `${messageIndex}_${
            newAssistantMessage.id || "temp"
          }`;
          chatState.refreshingMessages[newRefreshKey] = false;

          // 自动滚动到最新消息
          await scrollToBottom();
        }
      }
    } catch (error: any) {
      console.error("刷新消息失败:", error);
      ElMessage.error("刷新失败，请重试");
    } finally {
      // 确保滚动到底部
      nextTick(() => {
        scrollToBottom();
      });

      // 清理旧的刷新状态
      if (chatState.refreshingMessages[refreshKey]) {
        delete chatState.refreshingMessages[refreshKey];
      }

      // 重置整体发送状态
      chatState.isSending = false;

      // 刷新侧边栏历史记录数据，确保显示最新的对话信息
      try {
        await getHistoryQuestionData();
      } catch (error) {
        console.error("刷新侧边栏数据失败:", error);
      }
    }
  };

  return { refreshMessage };
}
