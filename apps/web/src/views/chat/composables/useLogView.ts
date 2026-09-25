import { watch } from "vue";
import type { Ref } from "vue";
import type { AnalystAgentLog } from "@/api/types";
import type { ChatMessage, ChatUIState, ChatView } from "../types";
import { getAnalystAgentLog } from "@/api/chat";

const POSITIVE_DECIMAL_ID = /^[1-9]\d*$/;

export type LogErrorKind = "fetch";

/** UI/cache key and GET path id — positive-decimal only; never coerce. */
export function deriveAnalystLogRowId(
  message: ChatMessage
): string | undefined {
  if (message.id == null) return undefined;
  const s = String(message.id);
  return POSITIVE_DECIMAL_ID.test(s) ? s : undefined;
}

export function analystLogActivityKey(rowId: string): string {
  return `log:${rowId}`;
}

function mergeLogResponse(
  cached: AnalystAgentLog | undefined,
  next: AnalystAgentLog
): AnalystAgentLog {
  if (next.state !== "DEGRADED" || next.text !== "" || !cached?.text) {
    return next;
  }
  return { ...next, text: cached.text };
}

export function useLogView(opts: {
  currentChat: Ref<ChatView | null>;
  currentChatId: Ref<string>;
  getChatState: (dialogueId: string) => ChatUIState;
}) {
  const { currentChat, currentChatId, getChatState } = opts;

  const fetchLogIfNeeded = async (
    rowId: string,
    chatState: ChatUIState,
    force = false
  ) => {
    // Use `in` so a successful empty payload ("") still counts as cached.
    if (!force && (rowId in chatState.logData || chatState.loadingLog[rowId])) {
      return;
    }
    chatState.loadingLog[rowId] = true;
    try {
      const res = await getAnalystAgentLog({ id: rowId });
      // Preserve the bounded DTO; presentation owns state-specific labels.
      if (res.code === 200) {
        chatState.logData[rowId] = mergeLogResponse(
          chatState.logData[rowId],
          res.data
        );
        delete chatState.logErrorKinds[rowId];
      } else {
        console.error("Failed to fetch log:", res);
        chatState.logErrorKinds[rowId] = "fetch";
      }
    } catch (error) {
      console.error("Failed to fetch log:", error);
      chatState.logErrorKinds[rowId] = "fetch";
    } finally {
      chatState.loadingLog[rowId] = false;
    }
  };

  /** One-time legacy open: showLog===true seeds the Activity map once. */
  const ensureLegacyLogActivityInit = () => {
    if (!currentChatId.value) return;
    const messages = currentChat.value?.messages;
    if (!messages) return;
    const chatState = getChatState(currentChatId.value);
    for (const message of messages) {
      if (!message || typeof message !== "object") continue;
      if (message.showLog !== true) continue;
      const rowId = deriveAnalystLogRowId(message);
      if (!rowId) continue;
      const key = analystLogActivityKey(rowId);
      if (!(key in chatState.activityExpandedByMessage)) {
        chatState.activityExpandedByMessage[key] = true;
        fetchLogIfNeeded(rowId, chatState).catch(() => undefined);
      }
    }
  };

  watch(
    () => currentChat.value?.messages,
    () => {
      ensureLegacyLogActivityInit();
    },
    { deep: true, immediate: true }
  );

  const setLogExpanded = async (message: ChatMessage, expanded: boolean) => {
    if (!currentChatId.value) return;

    const rowId = deriveAnalystLogRowId(message);
    if (!rowId) return;

    const chatState = getChatState(currentChatId.value);
    if (!chatState) return;

    chatState.activityExpandedByMessage[analystLogActivityKey(rowId)] =
      expanded;

    if (expanded) {
      const cached = chatState.logData[rowId];
      const forcePending =
        cached?.source === "BOT_RUN" && cached.state === "PENDING";
      await fetchLogIfNeeded(rowId, chatState, forcePending);
    }
  };

  /** @deprecated Prefer setLogExpanded — kept name for call-site clarity during fold. */
  const toggleLogView = async (message: ChatMessage) => {
    const rowId = deriveAnalystLogRowId(message);
    if (!rowId || !currentChatId.value) return;
    const chatState = getChatState(currentChatId.value);
    const key = analystLogActivityKey(rowId);
    const next = chatState.activityExpandedByMessage[key] !== true;
    await setLogExpanded(message, next);
  };

  const retryLog = async (message: ChatMessage) => {
    if (!currentChatId.value) return;
    const rowId = deriveAnalystLogRowId(message);
    if (!rowId) return;

    const chatState = getChatState(currentChatId.value);
    delete chatState.logErrorKinds[rowId];

    await fetchLogIfNeeded(rowId, chatState, true);
  };

  const refreshModernLog = async (message: ChatMessage) => {
    if (!currentChatId.value) return;
    const rowId = deriveAnalystLogRowId(message);
    if (!rowId) return;
    const chatState = getChatState(currentChatId.value);
    if (
      chatState.activityExpandedByMessage[analystLogActivityKey(rowId)] !== true
    ) {
      return;
    }
    const cached = chatState.logData[rowId];
    if (cached && cached.source !== "BOT_RUN") return;
    await fetchLogIfNeeded(rowId, chatState, cached?.source === "BOT_RUN");
  };

  return {
    setLogExpanded,
    toggleLogView,
    retryLog,
    refreshModernLog,
    ensureLegacyLogActivityInit,
  };
}
