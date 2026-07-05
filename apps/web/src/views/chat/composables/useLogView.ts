import { nextTick } from "vue";
import type { Ref, WritableComputedRef } from "vue";
import type { ChatMessage } from "../types";
import { ElMessage } from "element-plus";
import i18n from "@/locales";
import { getAnalystAgentLog, updateAnalystAgentLog } from "@/api/chat";

export function useLogView(opts: {
  isSending: WritableComputedRef<boolean>;
  currentChat: Ref<any>;
  currentChatId: Ref<string>;
  getChatState: (dialogueId: string) => any;
  scrollToBottom: () => void;
}) {
  const { isSending, currentChat, currentChatId, getChatState, scrollToBottom } = opts;

  const toggleLogView = async (messageId: string) => {
    // block the action while sending or refreshing
    if (isSending.value) return;

    if (!currentChat.value?.messages || !messageId || !currentChatId.value)
      return;

    const message = currentChat.value.messages.find(
      (msg: ChatMessage) => msg.id === messageId
    );
    if (!message) return;

    // toggle the display state
    message.showLog = !message.showLog;

    const chatState = getChatState(currentChatId.value);
    if (!chatState) return;

    // load the log data if showing the log and it isn't loaded yet
    if (
      message.showLog &&
      !chatState.logData[messageId] &&
      !chatState.loadingLog[messageId]
    ) {
      chatState.loadingLog[messageId] = true;
      try {
        const res = await getAnalystAgentLog({ id: messageId });
        if (res.code === 200 && res.data) {
          // handle the new log data format
          let parsedData;

          // check whether the data is a string (the new log format)
          if (typeof res.data === "string") {
            // use the string data directly; no JSON parsing needed
            parsedData = res.data;
          } else {
            // try parsing JSON (backward compatibility)
            try {
              parsedData = JSON.parse(res.data);
            } catch (parseError) {
              console.error("JSON parse failed:", parseError);
              parsedData = res.data;
            }
          }

          chatState.logData[messageId] = parsedData;

          // ensure it scrolls to the bottom
          nextTick(() => {
            scrollToBottom();
          });
        } else {
          console.error("Failed to fetch log:", res);
        }
      } catch (error) {
        console.error("Failed to fetch log:", error);
      } finally {
        chatState.loadingLog[messageId] = false;
      }
    }

    // ensure it scrolls to the bottom
    nextTick(() => {
      scrollToBottom();
    });
  };

  const updateLog = async (messageId: string) => {
    if (!currentChatId.value || !messageId) return;

    const chatState = getChatState(currentChatId.value);
    if (!chatState) return;

    // set the updating state
    chatState.updatingLog[messageId] = true;

    try {
      // get the compute_resource value from the current message
      let computeResource = "analyst-agents-small"; // default value

      if (currentChat.value?.messages) {
        const message = currentChat.value.messages.find(
          (msg: ChatMessage) => msg.id === messageId
        );
        if (message && message.compute_resource) {
          computeResource = message.compute_resource;
        }
      }

      const formData = new FormData();
      formData.append("task_id", messageId);
      formData.append("compute_resource", computeResource);

      const response = await updateAnalystAgentLog(formData);

      if (response.code === 200) {
        ElMessage.success(i18n.global.t("chat.logUpdatedSuccess"));

        // reload the log data
        if (currentChat.value?.messages) {
          const message = currentChat.value.messages.find(
            (msg: ChatMessage) => msg.id === messageId
          );
          if (message && message.showLog) {
            // re-fetch the log data
            chatState.loadingLog[messageId] = true;
            try {
              const logRes = await getAnalystAgentLog({ id: messageId });
              if (logRes.code === 200 && logRes.data) {
                let parsedData;

                // check whether the data is a string (the new log format)
                if (typeof logRes.data === "string") {
                  // use the string data directly; no JSON parsing needed
                  parsedData = logRes.data;
                } else {
                  // try parsing JSON (backward compatibility)
                  try {
                    parsedData = JSON.parse(logRes.data);
                  } catch (parseError) {
                    console.error("JSON parse failed:", parseError);
                    parsedData = logRes.data;
                  }
                }

                chatState.logData[messageId] = parsedData;

                // ensure it scrolls to the bottom
                nextTick(() => {
                  scrollToBottom();
                });
              }
            } catch (error) {
              console.error("Failed to re-fetch log:", error);
            } finally {
              chatState.loadingLog[messageId] = false;
            }
          }
        }
      } else {
        ElMessage.error(i18n.global.t("chat.logUpdateFailed"));
      }
    } catch (error) {
      console.error("Failed to update log:", error);
      ElMessage.error(i18n.global.t("chat.logUpdateFailedRetry"));
    } finally {
      chatState.updatingLog[messageId] = false;

      // ensure it scrolls to the bottom
      nextTick(() => {
        scrollToBottom();
      });
    }
  };

  return { toggleLogView, updateLog };
}
