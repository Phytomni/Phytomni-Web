import { ref, computed } from "vue";
import type { UploadFile, ChatUIState, ChatView } from "../types";
import type { RekeyChatStateOutcome } from "../types";

function createDefaultChatUIState(): ChatUIState {
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
    a2uiActionSender: null,
    a2uiRunId: "",
    uploadTransfer: null,
    selectedAgent: "",
    renderedChat: null,
    activeRequestId: "",
    generationStopped: false,
    activityExpandedByMessage: {},
  };
}

export function useChatStates() {
  // state management for all conversations
  const chatStates = ref<Record<string, ChatUIState>>({});

  // get or create the conversation state
  const getChatState = (dialogueId: string): ChatUIState => {
    if (!chatStates.value[dialogueId]) {
      chatStates.value[dialogueId] = createDefaultChatUIState();
    }
    return chatStates.value[dialogueId];
  };

  // the currently selected conversation
  const currentChatId = ref("");

  // Writable view of chatStates[currentChatId].renderedChat — not a second owner
  const currentChat = computed<ChatView | null>({
    get: () => {
      if (!currentChatId.value) return null;
      return getChatState(currentChatId.value).renderedChat;
    },
    set: (value: ChatView | null) => {
      if (!currentChatId.value) return;
      getChatState(currentChatId.value).renderedChat = value;
    },
  });

  // input content - now based on the current conversation
  const messageInput = computed({
    get: () => {
      if (!currentChatId.value) return "";
      const chatState = getChatState(currentChatId.value);
      return chatState ? chatState.messageInput : "";
    },
    set: (value: string) => {
      if (!currentChatId.value) return;
      const chatState = getChatState(currentChatId.value);
      if (chatState) {
        chatState.messageInput = value;
      }
    },
  });

  // message-sending loading state - now based on the current conversation
  const isSending = computed({
    get: () => {
      if (!currentChatId.value) return false;
      const chatState = getChatState(currentChatId.value);
      return chatState ? chatState.isSending : false;
    },
    set: (value: boolean) => {
      if (!currentChatId.value) return;
      const chatState = getChatState(currentChatId.value);
      if (chatState) {
        chatState.isSending = value;
      }
    },
  });

  // routing mode - per the current conversation (locked after the first send)
  const chatMode = computed({
    get: (): "instant" | "expert" => {
      if (!currentChatId.value) return "instant";
      return getChatState(currentChatId.value).mode;
    },
    set: (value: "instant" | "expert") => {
      if (!currentChatId.value) return;
      getChatState(currentChatId.value).mode = value;
    },
  });

  // selected Composer Agent — per the current conversation
  const selectedAgent = computed({
    get: (): string => {
      if (!currentChatId.value) return "";
      return getChatState(currentChatId.value).selectedAgent;
    },
    set: (value: string) => {
      if (!currentChatId.value) return;
      getChatState(currentChatId.value).selectedAgent = value;
    },
  });

  // file list - now based on the current conversation
  const fileList = computed({
    get: () => {
      if (!currentChatId.value) return [];
      const chatState = getChatState(currentChatId.value);
      return chatState ? chatState.fileList : [];
    },
    set: (value: UploadFile[]) => {
      if (!currentChatId.value) return;
      const chatState = getChatState(currentChatId.value);
      if (chatState) {
        chatState.fileList = value;
      }
    },
  });

  // upload transfer progress - now based on the current conversation
  const uploadTransfer = computed({
    get: () => {
      if (!currentChatId.value) return null;
      return getChatState(currentChatId.value).uploadTransfer;
    },
    set: (value: ChatUIState["uploadTransfer"]) => {
      if (!currentChatId.value) return;
      getChatState(currentChatId.value).uploadTransfer = value;
    },
  });

  // copy state - now based on the current conversation
  const copyVisible = computed({
    get: () => {
      if (!currentChatId.value) return 0;
      const chatState = getChatState(currentChatId.value);
      return chatState ? chatState.copyVisible : 0;
    },
    set: (value: number) => {
      if (!currentChatId.value) return;
      const chatState = getChatState(currentChatId.value);
      if (chatState) {
        chatState.copyVisible = value;
      }
    },
  });

  const copyTimeRef = computed({
    get: () => {
      if (!currentChatId.value) return undefined;
      const chatState = getChatState(currentChatId.value);
      return chatState ? chatState.copyTimeRef : undefined;
    },
    set: (value: ReturnType<typeof setTimeout> | undefined) => {
      if (!currentChatId.value) return;
      const chatState = getChatState(currentChatId.value);
      if (chatState) {
        chatState.copyTimeRef = value;
      }
    },
  });

  // log state management - now based on the current conversation
  const logData = computed({
    get: () => {
      if (!currentChatId.value) return {};
      const chatState = getChatState(currentChatId.value);
      return chatState ? chatState.logData : {};
    },
    set: (value: Record<string, any>) => {
      if (!currentChatId.value) return;
      const chatState = getChatState(currentChatId.value);
      if (chatState) {
        chatState.logData = value;
      }
    },
  });

  const loadingLog = computed({
    get: () => {
      if (!currentChatId.value) return {};
      const chatState = getChatState(currentChatId.value);
      return chatState ? chatState.loadingLog : {};
    },
    set: (value: Record<string, boolean>) => {
      if (!currentChatId.value) return;
      const chatState = getChatState(currentChatId.value);
      if (chatState) {
        chatState.loadingLog = value;
      }
    },
  });

  // refresh state management - now based on the current conversation
  const refreshingMessages = computed({
    get: () => {
      if (!currentChatId.value) return {};
      const chatState = getChatState(currentChatId.value);
      return chatState ? chatState.refreshingMessages : {};
    },
    set: (value: Record<string, boolean>) => {
      if (!currentChatId.value) return;
      const chatState = getChatState(currentChatId.value);
      if (chatState) {
        chatState.refreshingMessages = value;
      }
    },
  });

  // history question - now based on the current conversation
  const historyQuestion = computed({
    get: () => {
      if (!currentChatId.value) return null;
      const chatState = getChatState(currentChatId.value);
      return chatState ? chatState.historyQuestion : null;
    },
    set: (value: any) => {
      if (!currentChatId.value) return;
      const chatState = getChatState(currentChatId.value);
      if (chatState) {
        chatState.historyQuestion = value;
      }
    },
  });

  // log-updating state management - now based on the current conversation
  const updatingLog = computed({
    get: () => {
      if (!currentChatId.value) return {};
      const chatState = getChatState(currentChatId.value);
      return chatState ? chatState.updatingLog : {};
    },
    set: (value: Record<string, boolean>) => {
      if (!currentChatId.value) return;
      const chatState = getChatState(currentChatId.value);
      if (chatState) {
        chatState.updatingLog = value;
      }
    },
  });

  const rekeyChatState = (
    fromDialogueId: string,
    toDialogueId: string
  ): RekeyChatStateOutcome => {
    if (fromDialogueId === toDialogueId) {
      return { outcome: "same-id" };
    }
    const source = chatStates.value[fromDialogueId];
    if (!source) {
      return { outcome: "source-absent" };
    }
    if (chatStates.value[toDialogueId]) {
      return { outcome: "target-collision" };
    }
    chatStates.value[toDialogueId] = source;
    delete chatStates.value[fromDialogueId];
    return { outcome: "moved" };
  };

  return {
    chatStates,
    getChatState,
    rekeyChatState,
    currentChatId,
    currentChat,
    messageInput,
    isSending,
    chatMode,
    selectedAgent,
    fileList,
    uploadTransfer,
    copyVisible,
    copyTimeRef,
    logData,
    loadingLog,
    refreshingMessages,
    historyQuestion,
    updatingLog,
  };
}
