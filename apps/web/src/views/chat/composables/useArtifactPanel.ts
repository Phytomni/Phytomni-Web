import { computed, watch } from "vue";
import type { Ref } from "vue";
import type { ArtifactTab, ChatMessage, ChatUIState, ChatView } from "../types";
import { artifactKindForMessage } from "../utils/artifact-policy";

function normalizeServerMessageId(id: unknown): string | null {
  if (typeof id !== "string" && typeof id !== "number") return null;
  const normalized = String(id).trim();
  return normalized === "" ? null : normalized;
}

export function useArtifactPanel(opts: {
  currentChatId: Ref<string>;
  currentChat: Ref<ChatView | null>;
  getChatState: (dialogueId: string) => ChatUIState;
}) {
  const { currentChatId, currentChat, getChatState } = opts;

  const artifactOpen = computed(() =>
    currentChatId.value ? getChatState(currentChatId.value).artifactOpen : false
  );
  const activeArtifactMessageId = computed(() =>
    currentChatId.value
      ? getChatState(currentChatId.value).activeArtifactMessageId
      : null
  );
  const artifactTab = computed(
    (): ArtifactTab =>
      currentChatId.value
        ? getChatState(currentChatId.value).artifactTab
        : "content"
  );

  const findEligibleMessage = (messageId: string): ChatMessage | null => {
    const matches = (currentChat.value?.messages ?? []).filter(
      (message) => normalizeServerMessageId(message.id) === messageId
    );
    if (matches.length !== 1) return null;
    return artifactKindForMessage(matches[0]) === null ? null : matches[0];
  };

  const currentArtifactMessage = computed((): ChatMessage | null => {
    if (!artifactOpen.value || activeArtifactMessageId.value === null) {
      return null;
    }
    return findEligibleMessage(activeArtifactMessageId.value);
  });

  const resetArtifact = (state: ChatUIState) => {
    state.artifactOpen = false;
    state.activeArtifactMessageId = null;
    state.artifactTab = "content";
  };

  const openArtifact = (messageId: string) => {
    if (!currentChatId.value) return;
    const normalizedId = normalizeServerMessageId(messageId);
    if (normalizedId === null || findEligibleMessage(normalizedId) === null) {
      return;
    }

    const state = getChatState(currentChatId.value);
    state.activeArtifactMessageId = normalizedId;
    state.artifactOpen = true;
  };

  const closeArtifact = () => {
    if (!currentChatId.value) return;
    resetArtifact(getChatState(currentChatId.value));
  };

  const selectArtifactTab = (tab: ArtifactTab) => {
    if (!currentChatId.value) return;
    getChatState(currentChatId.value).artifactTab = tab;
  };

  const hasAutoOpened = (messageId: string): boolean => {
    if (!currentChatId.value) return false;
    const normalizedId = normalizeServerMessageId(messageId);
    return (
      normalizedId !== null &&
      getChatState(currentChatId.value).autoOpenedArtifactMessageIds.includes(
        normalizedId
      )
    );
  };

  const markAutoOpened = (messageId: string) => {
    if (!currentChatId.value) return;
    const normalizedId = normalizeServerMessageId(messageId);
    if (normalizedId === null) return;

    const seenIds = getChatState(
      currentChatId.value
    ).autoOpenedArtifactMessageIds;
    if (!seenIds.includes(normalizedId)) {
      seenIds.push(normalizedId);
    }
  };

  watch(
    [
      currentChatId,
      artifactOpen,
      activeArtifactMessageId,
      currentArtifactMessage,
    ],
    ([dialogueId, isOpen, messageId, message]) => {
      if (!dialogueId || !isOpen || messageId === null || message !== null)
        return;
      resetArtifact(getChatState(dialogueId));
    },
    { flush: "sync" }
  );

  return {
    artifactOpen,
    activeArtifactMessageId,
    artifactTab,
    currentArtifactMessage,
    openArtifact,
    closeArtifact,
    selectArtifactTab,
    hasAutoOpened,
    markAutoOpened,
  };
}
