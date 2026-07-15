import { nextTick } from "vue";
import type { Ref } from "vue";
import type { Chat, ChatMessage, ChatResponse, ChatUIState } from "../types";
import { parseMessageWithFiles } from "../utils/message-parse";
import { isValidJSON, convertToTableData } from "../utils/format";
import { readServerFile } from "../utils/agent-log";
import { getAnswerCheck } from "@/api/chat";
import { lockUnverifiedHistoryA2ui } from "../streaming/a2uiReducer";

export function useSelectChat(opts: {
  getChatState: (dialogueId: string) => ChatUIState;
  currentChatId: Ref<string>;
  scrollToBottom: () => void;
  updateUrlWithChatId: (dialogueId: string) => void;
  chatList: Ref<Chat[]>;
  timestamp: Ref<number>;
}) {
  const {
    getChatState,
    currentChatId,
    scrollToBottom,
    updateUrlWithChatId,
    chatList,
    timestamp,
  } = opts;

  const selectChat = async (dialogueId: string) => {
    // Capture dialogue + state before await so a late response never writes
    // another dialogue's renderedChat or steals foreground URL/scroll.
    const capturedDialogueId = dialogueId;
    const chatState = getChatState(capturedDialogueId);
    currentChatId.value = capturedDialogueId;
    const chat = chatList.value.find(
      (c: Chat) => c.dialogue_id === capturedDialogueId
    );

    // A live rendered owner already contains message-scoped stream/runtime
    // state. Re-selecting it must not rehydrate stale history over that tree.
    if (chatState.renderedChat) {
      if (chatState.renderedChat.messages.length > 0) {
        await scrollToBottom();
      }
      updateUrlWithChatId(capturedDialogueId);
      return;
    }

    // call getAnswerCheck to get the conversation records
    const res = await getAnswerCheck({ dialogue_id: capturedDialogueId });

    if (res.code === 200) {
      // process the returned data into message format
      const messages: ChatMessage[] = [];
      const historyMessages: ChatMessage[] = [];
      // Reconstruct the per-conversation routing mode from the persisted parent
      // row so refreshes/threads in this conversation route correctly. Default
      // to "instant" for legacy rows that predate the mode column.
      chatState.mode =
        (res.data[0] && res.data[0].mode === "expert") ? "expert" : "instant";
      chatState.historyQuestion = null;

      // initialize reaction state
      chatState.reactions = {};

      // iterate the returned array and convert to message format
      if (res.data && Array.isArray(res.data)) {
        res.data.forEach((item: ChatResponse) => {
          // sync the reaction state returned by the server
          if (item.id && item.reaction_type) {
            chatState.reactions[item.id.toString()] = parseInt(
              item.reaction_type
            );
          }

          // add the user message
          if (item.query) {
            // parse the message content and extract file info
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

          // add the assistant message
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
                  showFollowUpQuestions: true, // history messages show follow-up questions by default
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
                  const contentData = isValidJSON(item.answer)
                    ? JSON.parse(item.answer)
                    : item.answer;
                  // log the doc_list data
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
                    showFollowUpQuestions: true, // history messages show follow-up questions by default
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
                  const contentData = isValidJSON(item.answer)
                    ? JSON.parse(item.answer)
                    : item.answer;

                  // create the message object
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
                    showFollowUpQuestions: true, // history messages show follow-up questions by default
                    instantMessage: false,
                    server_file_path: item.server_file_path, // add the server file path
                  };

                  // if there is a server file path, read the file content asynchronously
                  if (item.server_file_path) {
                    // show a loading state first
                    deepGenomeMessage.content = "Loading file content...";

                    readServerFile(item.server_file_path)
                      .then((fileContent) => {
                        if (fileContent && fileContent.trim()) {
                          deepGenomeMessage.content = fileContent;
                        } else {
                          deepGenomeMessage.content = "File content is empty or failed to load";
                        }
                        // force a view update; scroll only if still foreground
                        nextTick(() => {
                          timestamp.value = Date.now();
                          if (currentChatId.value === capturedDialogueId) {
                            scrollToBottom();
                          }
                        });
                      })
                      .catch((error) => {
                        console.error("Failed to read DeepGenomeAgent file:", error);
                        deepGenomeMessage.content = "Failed to load file, please try again later";
                        nextTick(() => {
                          timestamp.value = Date.now();
                          if (currentChatId.value === capturedDialogueId) {
                            scrollToBottom();
                          }
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
                    showFollowUpQuestions: true, // history messages show follow-up questions by default
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
          }
        });
      }

      chatState.historyQuestion = historyMessages;
      // Populate only this dialogue's rendered owner — never the live current ref
      chatState.renderedChat = {
        ...chat,
        messages: lockUnverifiedHistoryA2ui(messages),
      };

      // Foreground shell effects only while this dialogue is still selected
      if (currentChatId.value === capturedDialogueId) {
        if (messages.length > 0) {
          await scrollToBottom();
        }
        updateUrlWithChatId(capturedDialogueId);
      }
      return;
    }
    if (currentChatId.value === capturedDialogueId) {
      updateUrlWithChatId(capturedDialogueId);
    }
  };

  return { selectChat };
}
