import { nextTick, toRaw } from "vue";
import type { Ref } from "vue";
import { ElMessage } from "element-plus";
import type { Chat, ChatMessage, ChatResponse, ChatUIState } from "../types";
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
import i18n from "@/locales";
import { lockUnverifiedHistoryA2ui } from "../streaming/a2uiReducer";
import { decodeAgentSteps, decodeFollowUpQuestions } from "../messageTypes";
import {
  normalizeHistoryRows,
  resolveHistoryQuestion,
} from "../utils/chat-history-normalization";

export function historyAssistantMetadata(
  item: Pick<ChatResponse, "artifacts" | "context_rebuilt" | "context_degraded">
): Pick<ChatMessage, "artifacts" | "contextNotice"> {
  const metadata: Pick<ChatMessage, "artifacts" | "contextNotice"> = {};
  if (Array.isArray(item.artifacts)) {
    metadata.artifacts = item.artifacts.map((artifact) => ({ ...artifact }));
  }
  const contextNotice = normalizeChatContextNotice(item);
  if (contextNotice) metadata.contextNotice = contextNotice;
  return metadata;
}

export function useSelectChat(opts: {
  getChatState: (dialogueId: string) => ChatUIState;
  currentChatId: Ref<string>;
  scrollToBottom: () => Promise<void>;
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
  const hydrationGenerations = new Map<string, number>();
  const degradedHistoryWarnings = new Set<string>();

  const beginHydration = (dialogueId: string) => {
    const generation = (hydrationGenerations.get(dialogueId) || 0) + 1;
    hydrationGenerations.set(dialogueId, generation);
    return generation;
  };

  const selectChat = async (dialogueId: string) => {
    // Capture dialogue + state before await so a late response never writes
    // another dialogue's renderedChat or steals foreground URL/scroll.
    const capturedDialogueId = dialogueId;
    const chatState = getChatState(capturedDialogueId);
    // A newer selection of this same dialogue supersedes any older fetch.
    const hydrationGeneration = beginHydration(capturedDialogueId);
    const isCurrentHydration = () =>
      hydrationGenerations.get(capturedDialogueId) === hydrationGeneration;
    currentChatId.value = capturedDialogueId;
    const chat = chatList.value.find(
      (c: Chat) => c.dialogue_id === capturedDialogueId
    );

    // A live rendered owner already contains message-scoped stream/runtime
    // state. Re-selecting it must not rehydrate stale history over that tree.
    if (chatState.renderedChat) {
      if (chatState.renderedChat.messages.length > 0 && isCurrentHydration()) {
        await scrollToBottom();
      }
      if (isCurrentHydration() && currentChatId.value === capturedDialogueId) {
        updateUrlWithChatId(capturedDialogueId);
      }
      return;
    }

    chatState.historyHydration = "loading";
    chatState.historyErrorKind = null;
    chatState.historyQuestion = null;
    chatState.renderedChat = null;
    chatState.reactions = {};

    let res;
    try {
      // call getAnswerCheck to get the conversation records
      res = await getAnswerCheck({ dialogue_id: capturedDialogueId });
    } catch {
      if (!isCurrentHydration()) return;
      chatState.historyHydration = "error";
      chatState.historyErrorKind = "request";
      if (isCurrentHydration() && currentChatId.value === capturedDialogueId) {
        updateUrlWithChatId(capturedDialogueId);
      }
      return;
    }

    if (!isCurrentHydration()) return;

    if (res.code !== 200) {
      chatState.historyHydration = "error";
      chatState.historyErrorKind = "request";
      if (isCurrentHydration() && currentChatId.value === capturedDialogueId) {
        updateUrlWithChatId(capturedDialogueId);
      }
      return;
    }

    try {
      if (!Array.isArray(res.data)) {
        throw new TypeError("History response data must be an array");
      }

      // process the returned data into message format
      const messages: ChatMessage[] = [];
      const historyMessages: ChatMessage[] = [];
      const historyRows = normalizeHistoryRows(res.data);
      // Reconstruct the per-conversation routing mode from the persisted parent
      // row so refreshes/threads in this conversation route correctly. Default
      // to "instant" for legacy rows that predate the mode column.
      chatState.mode = historyRows[0]?.mode === "expert" ? "expert" : "instant";

      // iterate the returned array and convert to message format
      if (historyRows.length > 0) {
        historyRows.forEach((row, rowIndex) => {
          const item: Partial<ChatResponse> = row;
          const assistantMetadata = historyAssistantMetadata(item);
          // sync the reaction state returned by the server
          if (item.id && item.reaction_type) {
            chatState.reactions[item.id.toString()] = parseInt(
              item.reaction_type
            );
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
            // parse the message content and extract file info
            const { content, attachedFiles } = parseMessageWithFiles(question);

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

          // add the assistant message only when the persisted value is usable
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
                    chatState.renderedChat?.messages.some(
                      (message) => toRaw(message) === deepGenomeMessage
                    ) ?? false;

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
            const contextNotice = normalizeChatContextNotice(item);
            const lastMessage = messages.at(-1);
            if (contextNotice && lastMessage?.role === "assistant") {
              lastMessage.contextNotice = contextNotice;
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

      chatState.historyQuestion = historyMessages;
      // Populate only this dialogue's rendered owner — never the live current ref
      chatState.renderedChat = {
        ...chat,
        messages: lockUnverifiedHistoryA2ui(messages),
      };
      chatState.historyHydration =
        messages.length > 0 ? "ready" : "history-empty";

      // Foreground shell effects only while this dialogue is still selected
      if (isCurrentHydration() && currentChatId.value === capturedDialogueId) {
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
      return;
    } catch {
      if (!isCurrentHydration()) return;
      chatState.historyHydration = "error";
      chatState.historyErrorKind = "decode";
      if (isCurrentHydration() && currentChatId.value === capturedDialogueId) {
        updateUrlWithChatId(capturedDialogueId);
      }
    }
  };

  return { selectChat };
}
