import { computed, watch } from "vue";
import type { Ref } from "vue";
import { ElMessage } from "element-plus";
import { saveAs } from "file-saver";
import {
  getConversationArtifactDownloadURL,
  getConversationArtifactFile,
} from "@/api/chat";
import i18n from "@/locales";
import {
  removeDownloadTransfer,
  upsertDownloadTransfer,
} from "@/utils/download-transfers";
import { createTransferTracker } from "@/utils/transfer-progress";
import type { ArtifactTab, ChatMessage, ChatUIState, ChatView } from "../types";
import type { ConversationArtifactLink } from "@/api/types";
import {
  artifactIdentityForMessage,
  artifactPresentationForMessage,
} from "../utils/artifact-policy";
import { useResultArchiveDelivery } from "./useResultArchiveDelivery";

let artifactDownloadSequence = 0;

function normalizeServerMessageId(id: unknown): string | null {
  if (typeof id !== "string" && typeof id !== "number") return null;
  const normalized = String(id).trim();
  return normalized === "" ? null : normalized;
}

function isCanceledRequest(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const record = error as Record<string, unknown>;
  return record.code === "ERR_CANCELED" || record.name === "CanceledError";
}

export function useArtifactPanel(opts: {
  currentChatId: Ref<string>;
  currentChat: Ref<ChatView | null>;
  getChatState: (dialogueId: string) => ChatUIState;
}) {
  const { currentChatId, currentChat, getChatState } = opts;
  const resultArchiveDelivery = useResultArchiveDelivery({ getChatState });

  const artifactOpen = computed(() =>
    currentChatId.value ? getChatState(currentChatId.value).artifactOpen : false
  );
  const activeArtifactIdentity = computed(() =>
    currentChatId.value
      ? getChatState(currentChatId.value).activeArtifactIdentity
      : null
  );
  const artifactTab = computed((): ArtifactTab =>
    currentChatId.value
      ? getChatState(currentChatId.value).artifactTab
      : "content"
  );

  const findEligibleMessage = (identity: string): ChatMessage | null => {
    const matches = (currentChat.value?.messages ?? []).filter(
      (message) =>
        artifactIdentityForMessage(message) === identity ||
        (artifactPresentationForMessage(message) === null &&
          normalizeServerMessageId(message.id) === identity)
    );
    if (matches.length !== 1) return null;
    const message = matches[0];
    return artifactPresentationForMessage(message) === null &&
      (message.artifacts?.length ?? 0) === 0
      ? null
      : message;
  };

  const currentArtifactMessage = computed((): ChatMessage | null => {
    if (!artifactOpen.value || activeArtifactIdentity.value === null) {
      return null;
    }
    return findEligibleMessage(activeArtifactIdentity.value);
  });
  const currentArtifactLinks = computed(
    (): readonly ConversationArtifactLink[] =>
      currentArtifactMessage.value?.artifacts ?? []
  );

  const downloadArtifact = async (artifact: ConversationArtifactLink) => {
    const selected = currentArtifactLinks.value.find(
      (item) => item.id === artifact.id
    );
    if (!selected) return;
    const requestId = `conversation-artifact-${Date.now()}-${++artifactDownloadSequence}`;
    const tracker = createTransferTracker({ phase: "download", requestId });
    try {
      const messageId = normalizeServerMessageId(
        currentArtifactMessage.value?.id
      );
      const dialogueId = currentChatId.value;
      if (messageId === null || dialogueId === "") return;

      const signed = await getConversationArtifactDownloadURL({
        dialogue_id: dialogueId,
        message_id: messageId,
        artifact_id: selected.id,
      });
      if (signed.code !== 200 || !signed.data) {
        throw new Error("Artifact signing failed");
      }
      const response = await getConversationArtifactFile(signed.data, {
        requestId,
        onDownloadProgress: (event) => {
          upsertDownloadTransfer(tracker.update(event));
        },
      });
      saveAs(response.data, selected.name);
    } catch (error) {
      if (isCanceledRequest(error)) {
        ElMessage.info(i18n.global.t("chat.downloadCancelled"));
        return;
      }
      ElMessage.error(i18n.global.t("chat.downloadError"));
    } finally {
      removeDownloadTransfer(requestId);
    }
  };

  const downloadResultArchive = async (artifact: ConversationArtifactLink) => {
    const messageId = normalizeServerMessageId(
      currentArtifactMessage.value?.id
    );
    const dialogueId = currentChatId.value;
    if (messageId === null || dialogueId === "") return;
    await resultArchiveDelivery.downloadResultArchive({
      dialogueId,
      messageId,
      artifact,
    });
  };

  const retryResultArchive = async (
    onPending: (delivery: import("@/api/types").AgentResultDelivery) => void
  ) => {
    const messageId = normalizeServerMessageId(
      currentArtifactMessage.value?.id
    );
    const dialogueId = currentChatId.value;
    if (messageId === null || dialogueId === "") return;
    await resultArchiveDelivery.retryResultArchive({
      dialogueId,
      messageId,
      onPending,
    });
  };

  const resetArtifact = (state: ChatUIState) => {
    state.artifactOpen = false;
    state.activeArtifactIdentity = null;
    state.artifactTab = "content";
  };

  const openArtifact = (identity: string) => {
    if (!currentChatId.value) return;
    const normalizedIdentity = identity.trim();
    if (
      normalizedIdentity === "" ||
      findEligibleMessage(normalizedIdentity) === null
    ) {
      return;
    }

    const state = getChatState(currentChatId.value);
    state.activeArtifactIdentity = normalizedIdentity;
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

  const isHandled = (
    identity: string,
    dialogueId = currentChatId.value
  ): boolean => {
    if (!dialogueId) return false;
    const normalizedIdentity = identity.trim();
    return (
      normalizedIdentity !== "" &&
      getChatState(dialogueId).handledArtifactIdentities.includes(
        normalizedIdentity
      )
    );
  };

  const markHandled = (identity: string, dialogueId = currentChatId.value) => {
    if (!dialogueId) return;
    const normalizedIdentity = identity.trim();
    if (normalizedIdentity === "") return;

    const handled = getChatState(dialogueId).handledArtifactIdentities;
    if (!handled.includes(normalizedIdentity)) {
      handled.push(normalizedIdentity);
    }
  };

  watch(
    [
      currentChatId,
      artifactOpen,
      activeArtifactIdentity,
      currentArtifactMessage,
    ],
    ([dialogueId, isOpen, identity, message]) => {
      if (!dialogueId || !isOpen || identity === null || message !== null)
        return;
      resetArtifact(getChatState(dialogueId));
    },
    { flush: "sync" }
  );

  return {
    artifactOpen,
    activeArtifactIdentity,
    artifactTab,
    currentArtifactMessage,
    currentArtifactLinks,
    downloadArtifact,
    downloadResultArchive,
    retryResultArchive,
    openArtifact,
    closeArtifact,
    selectArtifactTab,
    isHandled,
    markHandled,
  };
}
