import { ref, computed } from "vue";
import type { Ref } from "vue";
import type { UploadFile } from "../types";

export function useChatStates() {
  // 所有对话的状态管理
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
        reactions: Record<string, number>; // 添加点赞点踩状态
        updatingLog: Record<string, boolean>; // 添加更新日志状态
      }
    >
  >({});

  // 获取或创建对话状态
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
        reactions: {}, // 初始化点赞点踩状态
        updatingLog: {}, // 初始化更新日志状态
      };
    }
    return chatStates.value[dialogueId];
  };

  // 当前选中的对话
  const currentChatId = ref("");
  const currentChat: Ref<any> = ref(null);

  // 输入框内容 - 现在基于当前对话
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

  // 发送消息的加载状态 - 现在基于当前对话
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

  // 文件列表 - 现在基于当前对话
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

  // 复制状态 - 现在基于当前对话
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

  // 日志状态管理 - 现在基于当前对话
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

  // 刷新状态管理 - 现在基于当前对话
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

  // 历史问题 - 现在基于当前对话
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

  // 更新日志状态管理 - 现在基于当前对话
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
