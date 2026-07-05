import { nextTick } from "vue";
import type { Ref } from "vue";
import { ElMessage } from "element-plus";
import i18n from "@/locales";
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
          ElMessage.success(i18n.global.t("chat.cancelled"));
        } else if (newReaction === 1) {
          ElMessage.success(i18n.global.t("chat.liked"));
        } else if (newReaction === 2) {
          ElMessage.success(i18n.global.t("chat.disliked"));
        }

        // ensure it scrolls to the bottom
        nextTick(() => {
          scrollToBottom();
        });
      } else {
        ElMessage.error(i18n.global.t("common.opFailedRetry"));
      }
    } catch (error) {
      console.error("Reaction failed:", error);
      ElMessage.error(i18n.global.t("common.opFailedRetry"));
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
      return currentReaction === 1 ? "Undo like" : "Like";
    } else if (reactionType === 2) {
      return currentReaction === 2 ? "Undo dislike" : "Dislike";
    }
    return "";
  };

  return { getReactionState, handleReaction, getReactionTooltip };
}
