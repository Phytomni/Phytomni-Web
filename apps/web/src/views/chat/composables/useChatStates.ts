import { ref, computed } from "vue";
import type { Ref } from "vue";
import type { UploadFile } from "../types";

export function useChatStates() {
  // state management for all conversations
  const chatStates = ref<
    Record<
      string,
      {
        isSending: boolean;
        messageInput: string;
        fileList: UploadFile[];
        historyQuestion: any;
        copyVisible: number;
        copyTimeRef: ReturnType<typeof setTimeout> | undefined;
        logData: Record<string, any>;
        loadingLog: Record<string, boolean>;
        refreshingMessages: Record<string, boolean>;
        reactions: Record<string, number>; // reaction (like/dislike) state
        updatingLog: Record<string, boolean>; // log-updating state
        sendStartedAt: number | null; // start of this send; null = not sending
        activeAgentName: string; // canonical agent name for this send (selects τ + ETA copy)
        completing: boolean; // true = trigger the 99→100 fast progress animation
      }
    >
  >({});

  // get or create the conversation state
  const getChatState = (dialogueId: string) => {
    if (!chatStates.value[dialogueId]) {
      chatStates.value[dialogueId] = {
        isSending: false,
        messageInput: "",
        fileList: [],
        historyQuestion: null,
        copyVisible: 0,
        copyTimeRef: undefined,
        logData: {},
        loadingLog: {},
        refreshingMessages: {},
        reactions: {}, // initialize reaction state
        updatingLog: {}, // initialize log-updating state
        sendStartedAt: null,
        activeAgentName: "",
        completing: false,
      };
    }
    return chatStates.value[dialogueId];
  };

  // the currently selected conversation
  const currentChatId = ref("");
  const currentChat: Ref<any> = ref(null);

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

  return {
    chatStates,
    getChatState,
    currentChatId,
    currentChat,
    messageInput,
    isSending,
    fileList,
    copyVisible,
    copyTimeRef,
    logData,
    loadingLog,
    refreshingMessages,
    historyQuestion,
    updatingLog,
  };
}
