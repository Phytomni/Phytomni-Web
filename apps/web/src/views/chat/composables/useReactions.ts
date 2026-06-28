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

  // get the reaction state
  const getReactionState = (messageId: string) => {
    if (!currentChatId.value) return 0;
    const chatState = getChatState(currentChatId.value);
    return chatState?.reactions?.[messageId] || 0;
  };

  // handle the reaction
  const handleReaction = async (messageId: string, reactionType: number) => {
    if (!currentChatId.value || !messageId) return;

    const chatState = getChatState(currentChatId.value);
    if (!chatState) return;

    const currentReaction = chatState.reactions?.[messageId] || 0;

    // if clicking the current state, cancel it (send 0)
    // if clicking a different state, switch to it
    const newReaction = currentReaction === reactionType ? 0 : reactionType;

    try {
      // call the API
      const formData = new FormData();
      formData.append("id", messageId);
      formData.append("reaction_type", newReaction.toString());

      const response = await getReactionType(formData);

      if (response.code === 200) {
        // update local state
        chatState.reactions = {
          ...chatState.reactions,
          [messageId]: newReaction,
        };

        // show a success message
        if (newReaction === 0) {
          ElMessage.success("已取消");
        } else if (newReaction === 1) {
          ElMessage.success("已点赞");
        } else if (newReaction === 2) {
          ElMessage.success("已点踩");
        }

        // ensure it scrolls to the bottom
        nextTick(() => {
          scrollToBottom();
        });
      } else {
        ElMessage.error("操作失败，请重试");
      }
    } catch (error) {
      console.error("Reaction failed:", error);
      ElMessage.error("操作失败，请重试");
    }

    // ensure it scrolls to the bottom
    nextTick(() => {
      scrollToBottom();
    });
  };

  // get the reaction tooltip
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
