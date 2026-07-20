import { nextTick } from "vue";
import type { Ref } from "vue";
import { ElMessage } from "element-plus";
import i18n from "@/locales";
import { getReactionType } from "@/api/chat";
import type { ChatUIState } from "../types";

export function useReactions(opts: {
  currentChatId: Ref<string>;
  getChatState: (dialogueId: string) => ChatUIState;
  scrollToBottom: () => void;
}) {
  const { currentChatId, getChatState, scrollToBottom } = opts;
  const reactionRequestSeq = new Map<string, number>();

  // get the reaction state
  const getReactionState = (messageId: string) => {
    if (!currentChatId.value) return 0;
    const chatState = getChatState(currentChatId.value);
    return chatState?.reactions?.[messageId] || 0;
  };

  // handle the reaction
  const handleReaction = async (messageId: string, reactionType: number) => {
    if (!currentChatId.value || !messageId) return;

    const dialogueId = currentChatId.value;
    const chatState = getChatState(dialogueId);
    if (!chatState) return;

    const currentReaction = chatState.reactions?.[messageId] || 0;

    // if clicking the current state, cancel it (send 0)
    // if clicking a different state, switch to it
    const newReaction = currentReaction === reactionType ? 0 : reactionType;
    const requestKey = `${dialogueId}:${messageId}`;
    const requestSeq = (reactionRequestSeq.get(requestKey) ?? 0) + 1;
    reactionRequestSeq.set(requestKey, requestSeq);
    const isLatestRequest = () =>
      reactionRequestSeq.get(requestKey) === requestSeq;

    try {
      // call the API
      const formData = new FormData();
      formData.append("id", messageId);
      formData.append("reaction_type", newReaction.toString());

      const response = await getReactionType(formData);

      if (!isLatestRequest()) return;

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
      } else {
        ElMessage.error(i18n.global.t("common.opFailedRetry"));
      }
    } catch (error) {
      if (!isLatestRequest()) return;
      console.error("Reaction failed:", error);
      ElMessage.error(i18n.global.t("common.opFailedRetry"));
    }

    // ensure it scrolls to the bottom
    nextTick(scrollToBottom);
  };

  // Locale-reactive labels; reaction values/API unchanged.
  const getReactionTooltip = (messageId: string, reactionType: number) => {
    const currentReaction = getReactionState(messageId);
    if (reactionType === 1) {
      return currentReaction === 1
        ? String(i18n.global.t("chat.actions.undoLike"))
        : String(i18n.global.t("chat.actions.like"));
    } else if (reactionType === 2) {
      return currentReaction === 2
        ? String(i18n.global.t("chat.actions.undoDislike"))
        : String(i18n.global.t("chat.actions.dislike"));
    }
    return "";
  };

  return { getReactionState, handleReaction, getReactionTooltip };
}
