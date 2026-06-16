import { nextTick } from "vue";
import type { Ref, WritableComputedRef } from "vue";
import type { ChatMessage } from "../types";
import { ElMessage } from "element-plus";
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
    // 如果正在发送或刷新，阻止操作
    if (isSending.value) return;

    if (!currentChat.value?.messages || !messageId || !currentChatId.value)
      return;

    const message = currentChat.value.messages.find(
      (msg: ChatMessage) => msg.id === messageId
    );
    if (!message) return;

    // 切换显示状态
    message.showLog = !message.showLog;

    const chatState = getChatState(currentChatId.value);
    if (!chatState) return;

    // 如果显示日志且还没有加载数据，则加载日志数据
    if (
      message.showLog &&
      !chatState.logData[messageId] &&
      !chatState.loadingLog[messageId]
    ) {
      chatState.loadingLog[messageId] = true;
      try {
        const res = await getAnalystAgentLog({ id: messageId });
        if (res.code === 200 && res.data) {
          // 处理新的日志数据格式
          let parsedData;

          // 检查数据是否为字符串格式（新的日志格式）
          if (typeof res.data === "string") {
            // 直接使用字符串数据，不需要JSON解析
            parsedData = res.data;
          } else {
            // 尝试解析JSON数据（向后兼容）
            try {
              parsedData = JSON.parse(res.data);
            } catch (parseError) {
              console.error("JSON解析失败:", parseError);
              parsedData = res.data;
            }
          }

          chatState.logData[messageId] = parsedData;

          // 确保滚动到底部
          nextTick(() => {
            scrollToBottom();
          });
        } else {
          console.error("获取日志失败:", res);
        }
      } catch (error) {
        console.error("获取日志失败:", error);
      } finally {
        chatState.loadingLog[messageId] = false;
      }
    }

    // 确保滚动到底部
    nextTick(() => {
      scrollToBottom();
    });
  };

  const updateLog = async (messageId: string) => {
    if (!currentChatId.value || !messageId) return;

    const chatState = getChatState(currentChatId.value);
    if (!chatState) return;

    // 设置更新状态
    chatState.updatingLog[messageId] = true;

    try {
      // 从当前消息中获取 compute_resource 值
      let computeResource = "analyst-agents-small"; // 默认值

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
        ElMessage.success("日志更新成功");

        // 重新加载日志数据
        if (currentChat.value?.messages) {
          const message = currentChat.value.messages.find(
            (msg: ChatMessage) => msg.id === messageId
          );
          if (message && message.showLog) {
            // 重新获取日志数据
            chatState.loadingLog[messageId] = true;
            try {
              const logRes = await getAnalystAgentLog({ id: messageId });
              if (logRes.code === 200 && logRes.data) {
                let parsedData;

                // 检查数据是否为字符串格式（新的日志格式）
                if (typeof logRes.data === "string") {
                  // 直接使用字符串数据，不需要JSON解析
                  parsedData = logRes.data;
                } else {
                  // 尝试解析JSON数据（向后兼容）
                  try {
                    parsedData = JSON.parse(logRes.data);
                  } catch (parseError) {
                    console.error("JSON解析失败:", parseError);
                    parsedData = logRes.data;
                  }
                }

                chatState.logData[messageId] = parsedData;

                // 确保滚动到底部
                nextTick(() => {
                  scrollToBottom();
                });
              }
            } catch (error) {
              console.error("重新获取日志失败:", error);
            } finally {
              chatState.loadingLog[messageId] = false;
            }
          }
        }
      } else {
        ElMessage.error("日志更新失败");
      }
    } catch (error) {
      console.error("更新日志失败:", error);
      ElMessage.error("日志更新失败，请重试");
    } finally {
      chatState.updatingLog[messageId] = false;

      // 确保滚动到底部
      nextTick(() => {
        scrollToBottom();
      });
    }
  };

  return { toggleLogView, updateLog };
}
