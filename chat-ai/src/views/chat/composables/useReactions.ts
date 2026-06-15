import { nextTick } from "vue";
import type { Ref } from "vue";
import { ElMessage } from "element-plus";
import { getReactionType } from "@/api/chat";

export function useReactions(opts: {
  currentChatId: Ref<string>;
  getChatState: (dialogueId: string) => any;
  scrollToBottom: () => void;
}) {
  const { currentChatId, getChatState, scrollToBottom } = opts;

  // 获取点赞点踩状态
  const getReactionState = (messageId: string) => {
    if (!currentChatId.value) return 0;
    const chatState = getChatState(currentChatId.value);
    return chatState?.reactions?.[messageId] || 0;
  };

  // 处理点赞点踩
  const handleReaction = async (messageId: string, reactionType: number) => {
    if (!currentChatId.value || !messageId) return;

    const chatState = getChatState(currentChatId.value);
    if (!chatState) return;

    const currentReaction = chatState.reactions?.[messageId] || 0;

    // 如果点击的是当前状态，则取消（传值0）
    // 如果点击的是不同状态，则切换到新状态
    const newReaction = currentReaction === reactionType ? 0 : reactionType;

    try {
      // 调用API
      const formData = new FormData();
      formData.append("id", messageId);
      formData.append("reaction_type", newReaction.toString());

      const response = await getReactionType(formData);

      if (response.code === 200) {
        // 更新本地状态
        chatState.reactions = {
          ...chatState.reactions,
          [messageId]: newReaction,
        };

        // 显示成功提示
        if (newReaction === 0) {
          ElMessage.success("已取消");
        } else if (newReaction === 1) {
          ElMessage.success("已点赞");
        } else if (newReaction === 2) {
          ElMessage.success("已点踩");
        }

        // 确保滚动到底部
        nextTick(() => {
          scrollToBottom();
        });
      } else {
        ElMessage.error("操作失败，请重试");
      }
    } catch (error) {
      console.error("点赞点踩失败:", error);
      ElMessage.error("操作失败，请重试");
    }

    // 确保滚动到底部
    nextTick(() => {
      scrollToBottom();
    });
  };

  // 获取点赞点踩提示
  const getReactionTooltip = (messageId: string, reactionType: number) => {
    const currentReaction = getReactionState(messageId);
    if (reactionType === 1) {
      return currentReaction === 1 ? "取消点赞" : "点赞";
    } else if (reactionType === 2) {
      return currentReaction === 2 ? "取消点踩" : "点踩";
    }
    return "";
  };

  return { getReactionState, handleReaction, getReactionTooltip };
}
