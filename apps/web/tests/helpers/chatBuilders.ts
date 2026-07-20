import type { ChatMessage, ChatUIState } from "@/views/chat/types";

export function buildChatState(
  overrides: Partial<ChatUIState> = {}
): ChatUIState {
  return {
    isSending: false,
    messageInput: "",
    fileList: [],
    historyQuestion: null,
    copyVisible: 0,
    copyTimeRef: undefined,
    logData: {},
    loadingLog: {},
    refreshingMessages: {},
    reactions: {},
    updatingLog: {},
    logErrorKinds: {},
    sendStartedAt: null,
    activeAgentName: "",
    completing: false,
    mode: "instant",
    isStreaming: false,
    streamingMessageId: null,
    uploadTransfer: null,
    selectedAgent: "",
    renderedChat: null,
    activeRequestId: "",
    generationStopped: false,
    activityExpandedByMessage: {},
    artifactOpen: false,
    activeArtifactMessageId: null,
    artifactTab: "content",
    autoOpenedArtifactMessageIds: [],
    ...overrides,
  };
}

export function buildChatMessage(
  overrides: Partial<ChatMessage> = {}
): ChatMessage {
  return {
    role: "assistant",
    content: "fixture answer",
    blocks: [],
    ...overrides,
  };
}
