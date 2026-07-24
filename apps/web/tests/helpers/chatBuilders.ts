import type { Chat, ChatMessage, ChatUIState } from "@/views/chat/types";

export function buildChatState(
  overrides: Partial<ChatUIState> = {}
): ChatUIState {
  return {
    isSending: false,
    messageInput: "",
    fileList: [],
    historyQuestion: null,
    historyHydration: "new",
    historyErrorKind: null,
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

export function buildChat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: 1,
    dialogue_id: "fixture-dialogue",
    title: "Fixture chat",
    date: "2026-06-16T12:00:00.000Z",
    isFavorite: false,
    ...overrides,
  };
}
