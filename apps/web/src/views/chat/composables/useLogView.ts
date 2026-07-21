import { nextTick, watch } from "vue";
import type { Ref, WritableComputedRef } from "vue";
import type { ChatMessage, ChatUIState, ChatView } from "../types";
import { ElMessage } from "element-plus";
import i18n from "@/locales";
import { getAnalystAgentLog, updateAnalystAgentLog } from "@/api/chat";

const POSITIVE_DECIMAL_ID = /^[1-9]\d*$/;

export type LogErrorKind = "fetch" | "update";

/** UI/cache key and GET path id — positive-decimal only; never coerce. */
export function deriveAnalystLogRowId(
  message: ChatMessage
): string | undefined {
  if (message.id == null) return undefined;
  const s = String(message.id);
  return POSITIVE_DECIMAL_ID.test(s) ? s : undefined;
}

/** PATCH-only id — non-null and trim-nonempty; never falls back to row id. */
export function deriveAnalystLogTaskId(
  message: ChatMessage
): string | undefined {
  if (message.task_id == null) return undefined;
  const trimmed = String(message.task_id).trim();
  return trimmed !== "" ? trimmed : undefined;
}

export function analystLogActivityKey(rowId: string): string {
  return `log:${rowId}`;
}

function parseLogPayload(data: unknown): unknown {
  if (typeof data !== "string") return data;
  try {
    return JSON.parse(data);
  } catch (parseError) {
    console.error("JSON parse failed:", parseError);
    return data;
  }
}

export function useLogView(opts: {
  isSending: WritableComputedRef<boolean>;
  currentChat: Ref<ChatView | null>;
  currentChatId: Ref<string>;
  getChatState: (dialogueId: string) => ChatUIState;
  scrollToBottom: () => Promise<void>;
}) {
  const {
    isSending,
    currentChat,
    currentChatId,
    getChatState,
    scrollToBottom,
  } = opts;

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
      // code===200 is success even when TaskLog is empty/falsy (show no-data).
      if (res.code === 200) {
        chatState.logData[rowId] =
          res.data == null || res.data === "" ? "" : parseLogPayload(res.data);
        delete chatState.logErrorKinds[rowId];
        nextTick(() => {
          scrollToBottom().catch(() => undefined);
        }).catch(() => undefined);
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
    if (isSending.value) return;
    if (!currentChatId.value) return;

    const rowId = deriveAnalystLogRowId(message);
    if (!rowId) return;

    const chatState = getChatState(currentChatId.value);
    if (!chatState) return;

    chatState.activityExpandedByMessage[analystLogActivityKey(rowId)] =
      expanded;

    if (expanded) {
      await fetchLogIfNeeded(rowId, chatState);
    }

    nextTick(() => {
      scrollToBottom().catch(() => undefined);
    }).catch(() => undefined);
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

  const updateLog = async (message: ChatMessage) => {
    if (!currentChatId.value) return;

    const rowId = deriveAnalystLogRowId(message);
    const taskId = deriveAnalystLogTaskId(message);
    if (!rowId || !taskId) return;

    const chatState = getChatState(currentChatId.value);
    if (!chatState) return;

    chatState.updatingLog[rowId] = true;

    try {
      let computeResource = "analyst-agents-small";
      if (message.compute_resource) {
        computeResource = message.compute_resource;
      }

      const formData = new FormData();
      formData.append("task_id", taskId);
      formData.append("compute_resource", computeResource);

      const response = await updateAnalystAgentLog(formData);

      if (response.code === 200) {
        ElMessage.success(i18n.global.t("chat.logUpdatedSuccess"));
        delete chatState.logErrorKinds[rowId];

        const key = analystLogActivityKey(rowId);
        if (chatState.activityExpandedByMessage[key] === true) {
          await fetchLogIfNeeded(rowId, chatState, true);
        }
      } else {
        chatState.logErrorKinds[rowId] = "update";
        ElMessage.error(i18n.global.t("chat.logUpdateFailed"));
      }
    } catch (error) {
      console.error("Failed to update log:", error);
      chatState.logErrorKinds[rowId] = "update";
      ElMessage.error(i18n.global.t("chat.logUpdateFailedRetry"));
    } finally {
      chatState.updatingLog[rowId] = false;

      nextTick(() => {
        scrollToBottom().catch(() => undefined);
      }).catch(() => undefined);
    }
  };

  const retryLog = async (message: ChatMessage) => {
    if (!currentChatId.value) return;
    const rowId = deriveAnalystLogRowId(message);
    if (!rowId) return;

    const chatState = getChatState(currentChatId.value);
    const kind = chatState.logErrorKinds[rowId];
    delete chatState.logErrorKinds[rowId];

    if (kind === "update") {
      await updateLog(message);
      return;
    }
    await fetchLogIfNeeded(rowId, chatState, true);
  };

  return {
    setLogExpanded,
    toggleLogView,
    updateLog,
    retryLog,
    ensureLegacyLogActivityInit,
  };
}
