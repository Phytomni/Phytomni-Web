import { nextTick } from "vue";
import type { Ref } from "vue";
import type { Chat, ChatMessage, ChatResponse } from "../types";
import { parseMessageWithFiles } from "../utils/message-parse";
import { isValidJSON, convertToTableData } from "../utils/format";
import { readServerFile } from "../utils/agent-log";
import { getAnswerCheck } from "@/api/chat";

export function useSelectChat(opts: {
  getChatState: (dialogueId: string) => any;
  currentChatId: Ref<string>;
  currentChat: Ref<any>;
  scrollToBottom: () => void;
  updateUrlWithChatId: (dialogueId: string) => void;
  chatList: Ref<Chat[]>;
  timestamp: Ref<number>;
}) {
  const {
    getChatState,
    currentChatId,
    currentChat,
    scrollToBottom,
    updateUrlWithChatId,
    chatList,
    timestamp,
  } = opts;

  const selectChat = async (dialogueId: string) => {
    currentChatId.value = dialogueId;
    const chat = chatList.value.find((c: Chat) => c.dialogue_id === dialogueId);

    // 确保对话状态存在
    getChatState(dialogueId);

    // 在这里调用 getAnswerCheck 接口 获取对话记录
    const res = await getAnswerCheck({ dialogue_id: dialogueId });

    if (res.code === 200) {
      // 处理返回的数据，转换为消息格式
      const messages: ChatMessage[] = [];
      const historyMessages: ChatMessage[] = [];
      const chatState = getChatState(dialogueId);
      if (!chatState) return;
      chatState.historyQuestion = null;

      // 初始化点赞点踩状态
      chatState.reactions = {};

      // 遍历返回的数组，转换为消息格式
      if (res.data && Array.isArray(res.data)) {
        res.data.forEach((item: ChatResponse) => {
          // 同步服务器返回的点赞点踩状态
          if (item.id && item.reaction_type) {
            chatState.reactions[item.id.toString()] = parseInt(
              item.reaction_type
            );
          }

          // 添加用户消息
          if (item.query) {
            // 解析消息内容，提取文件信息
            const { content, attachedFiles } = parseMessageWithFiles(item.query);

            messages.push({
              role: "user",
              content: content,
              attachedFiles: attachedFiles,
            });
            historyMessages.push({
              role: "user",
              content: content,
            });
          }

          // 添加助手消息
          if (item.answer) {
            try {
              const answerData = isValidJSON(item.answer)
                ? JSON.parse(item.answer)
                : item.answer;
              if (answerData.final_answer) {
                messages.push({
                  role: "assistant",
                  content: answerData.final_answer,
                  steps: answerData.steps || [],
                  status: item?.status || "",
                  upload_path: item?.upload_path || "",
                  download_path: item?.download_path || "",
                  id: item.id,
                  tool_name: item.tool_name,
                  followUpQuestions: item.follow_up_questions
                    ? typeof item.follow_up_questions === "string"
                      ? JSON.parse(item.follow_up_questions)
                      : item.follow_up_questions
                    : [],
                  showFollowUpQuestions: true, // 历史消息默认显示后续问题
                  showLog: false,
                  instantMessage: false,
                });
                historyMessages.push({
                  role: "assistant",
                  content: answerData.final_answer,
                });
              } else {
                if (item.tool_name === "ChatAgent") {
                  messages.push({
                    role: "assistant",
                    content: item.answer,
                    steps: [],
                    status: item?.status || "",
                    upload_path: item?.upload_path || "",
                    download_path: item?.download_path || "",
                    id: item.id,
                    tool_name: item.tool_name,
                    followUpQuestions: item.follow_up_questions
                      ? typeof item.follow_up_questions === "string"
                        ? JSON.parse(item.follow_up_questions)
                        : item.follow_up_questions
                      : [],
                    showFollowUpQuestions: true, // 历史消息默认显示后续问题
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
                  const contentData = isValidJSON(item.answer)
                    ? JSON.parse(item.answer)
                    : item.answer;
                  // 打印 doc_list 数据
                  messages.push({
                    role: "assistant",
                    content: contentData.content,
                    doc_list: contentData.doc_list,
                    status: item?.status || "",
                    upload_path: item?.upload_path || "",
                    download_path: item?.download_path || "",
                    id: item.id,
                    tool_name: item.tool_name,
                    followUpQuestions: item.follow_up_questions
                      ? typeof item.follow_up_questions === "string"
                        ? JSON.parse(item.follow_up_questions)
                        : item.follow_up_questions
                      : [],
                    showFollowUpQuestions: true, // 历史消息默认显示后续问题
                    showLog: false,
                    instantMessage: false,
                  });
                  historyMessages.push({
                    role: "assistant",
                    content: item.answer,
                  });
                } else if (item.tool_name === "DataAgent") {
                  const contentData = isValidJSON(item.answer)
                    ? JSON.parse(item.answer)
                    : item.answer;
                  const tableData = convertToTableData(contentData);
                  messages.push({
                    role: "assistant",
                    content: tableData,
                    tableHeaders: contentData.headers.map((header: string) => ({
                      prop: header.replace(/\s+/g, "_").toLowerCase(),
                      label: header,
                    })),
                    status: item?.status || "",
                    upload_path: item?.upload_path || "",
                    download_path: item?.download_path || "",
                    original: item.answer,
                    id: item.id,
                    tool_name: item.tool_name,
                    followUpQuestions: item.follow_up_questions
                      ? typeof item.follow_up_questions === "string"
                        ? JSON.parse(item.follow_up_questions)
                        : item.follow_up_questions
                      : [],
                    showFollowUpQuestions: true, // 历史消息默认显示后续问题
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
                    content: item.answer,
                    status: item?.status || "",
                    upload_path: item?.upload_path || "",
                    download_path: item?.download_path || "",
                    id: item.id,
                    task_id: item.task_id,
                    tool_name: item.tool_name,
                    followUpQuestions: item.follow_up_questions
                      ? typeof item.follow_up_questions === "string"
                        ? JSON.parse(item.follow_up_questions)
                        : item.follow_up_questions
                      : [],
                    showFollowUpQuestions: true, // 历史消息默认显示后续问题
                    showLog: false,
                    instantMessage: false,
                    compute_resource: item?.compute_resource || "",
                  });
                  historyMessages.push({
                    role: "assistant",
                    content: item.answer,
                  });
                } else if (item.tool_name === "DeepGenomeAgent") {
                  const contentData = isValidJSON(item.answer)
                    ? JSON.parse(item.answer)
                    : item.answer;

                  // 创建消息对象
                  const deepGenomeMessage = {
                    role: "assistant",
                    content: contentData?.content || item.answer,
                    doc_list: contentData?.doc_list,
                    status: item?.status || "",
                    upload_path: item?.upload_path || "",
                    id: item.id,
                    task_id: item.task_id,
                    tool_name: item.tool_name,
                    followUpQuestions: item.follow_up_questions
                      ? typeof item.follow_up_questions === "string"
                        ? JSON.parse(item.follow_up_questions)
                        : item.follow_up_questions
                      : [],
                    showFollowUpQuestions: true, // 历史消息默认显示后续问题
                    instantMessage: false,
                    server_file_path: item.server_file_path, // 添加服务器文件路径
                  };

                  // 如果有服务器文件路径，异步读取文件内容
                  if (item.server_file_path) {
                    // 先显示加载状态
                    deepGenomeMessage.content = "正在加载文件内容...";

                    readServerFile(item.server_file_path)
                      .then((fileContent) => {
                        if (fileContent && fileContent.trim()) {
                          deepGenomeMessage.content = fileContent;
                        } else {
                          deepGenomeMessage.content = "文件内容为空或加载失败";
                        }
                        // 强制更新视图
                        nextTick(() => {
                          timestamp.value = Date.now();
                          scrollToBottom();
                        });
                      })
                      .catch((error) => {
                        console.error("读取DeepGenomeAgent文件失败:", error);
                        deepGenomeMessage.content = "文件加载失败，请稍后重试";
                        // 强制更新视图
                        nextTick(() => {
                          timestamp.value = Date.now();
                          scrollToBottom();
                        });
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
                    content: item.answer,
                    status: item?.status || "",
                    upload_path: item?.upload_path || "",
                    download_path: item?.download_path || "",
                    id: item?.id || "",
                    task_id: item.task_id,
                    tool_name: item?.tool_name || "",
                    followUpQuestions: item.follow_up_questions
                      ? typeof item.follow_up_questions === "string"
                        ? JSON.parse(item.follow_up_questions)
                        : item.follow_up_questions
                      : [],
                    showFollowUpQuestions: true, // 历史消息默认显示后续问题
                    instantMessage: false,
                  });
                  historyMessages.push({
                    role: "assistant",
                    content: item.answer,
                  });
                }
              }
            } catch (e) {
              messages.push({
                role: "assistant",
                content: item.answer,
                steps: [],
                status: item?.status || "",
                upload_path: item?.upload_path || "",
                download_path: item?.download_path || "",
                id: item?.id || "",
                task_id: item.task_id,
                tool_name: item.tool_name || "",
                followUpQuestions: item.follow_up_questions
                  ? typeof item.follow_up_questions === "string"
                    ? JSON.parse(item.follow_up_questions)
                    : item.follow_up_questions
                  : [],
                showFollowUpQuestions: true, // 历史消息默认显示后续问题
                showLog: false,
                instantMessage: false,
              });
              historyMessages.push({
                role: "assistant",
                content: item.answer,
              });
              timestamp.value = Date.now();
            }
          }
        });
      }

      chatState.historyQuestion = historyMessages;
      // 更新当前对话的消息
      currentChat.value = {
        ...chat,
        messages: messages,
      };

      // 自动滚动到最新对话
      if (messages.length > 0) {
        await scrollToBottom();
      }
    }
    updateUrlWithChatId(dialogueId);
  };

  return { selectChat };
}
