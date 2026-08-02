import { watch, type Ref } from "vue";
import { normalizePositiveTaskRowId, getTaskLifecycle } from "@/api/task";
import type { AgentTaskLifecycle } from "@/api/types";
import type { ChatMessage, ChatUIState } from "../types";
import {
  type LifecycleScheduler,
  useAgentRunLifecycle,
} from "./useAgentRunLifecycle";

const BACKGROUND_AGENT_TOOLS = new Set([
  "AnalystAgent",
  "InSilicoResearchAgent",
  "GeneNetworkAgent",
  "DigitalDesignAgent",
]);
const TERMINAL_HISTORY_STATUSES = new Set([
  "SUCCEEDED",
  "FAILED",
  "TIMED_OUT",
  "TIMEOUT",
  "CANCELLED",
  "CANCELED",
]);

function isWatchableMessage(message: ChatMessage): string | null {
  if (!BACKGROUND_AGENT_TOOLS.has(message.tool_name ?? "")) return null;
  if (TERMINAL_HISTORY_STATUSES.has((message.status ?? "").toUpperCase())) {
    return null;
  }
  try {
    return normalizePositiveTaskRowId(message.id ?? "");
  } catch {
    return null;
  }
}

export function useChatAgentRunLifecycle(options: {
  chatStates: Ref<Record<string, ChatUIState>>;
  getChatState: (dialogueId: string) => ChatUIState;
  reloadChat: (dialogueId: string) => Promise<void>;
  fetchLifecycle?: typeof getTaskLifecycle;
  maxConcurrent?: number;
  scheduler?: LifecycleScheduler;
  jitter?: () => number;
  documentRef?: Pick<
    Document,
    "hidden" | "addEventListener" | "removeEventListener"
  >;
}): { disposeDialogue: (dialogueId: string) => void; dispose: () => void } {
  const watchedRows = new Map<string, string>();

  const reloadDialogue = async (
    rowId: string,
    dialogueId: string,
    state: ChatUIState
  ): Promise<void> => {
    if (state.refreshingMessages[rowId]) return;
    state.refreshingMessages[rowId] = true;
    try {
      await options.reloadChat(dialogueId);
    } finally {
      if (options.chatStates.value[dialogueId] === state) {
        delete state.refreshingMessages[rowId];
      }
    }
  };

  const lifecycle = useAgentRunLifecycle({
    scope: "chat-lifecycle",
    fetchLifecycle: options.fetchLifecycle,
    maxConcurrent: options.maxConcurrent,
    scheduler: options.scheduler,
    jitter: options.jitter,
    documentRef: options.documentRef,
    onSnapshot: async (rowId, next) => {
      const dialogueId = watchedRows.get(rowId);
      if (!dialogueId) return;
      const state = options.chatStates.value[dialogueId];
      if (!state) return;

      state.agentRunLifecycles[rowId] = next;
      if (next.terminal) {
        await reloadDialogue(rowId, dialogueId, state);
        watchedRows.delete(rowId);
        lifecycle.unwatchRow(rowId);
        return;
      }
      await reloadDialogue(rowId, dialogueId, state);
    },
  });

  const stopWatchingSnapshots = watch(
    lifecycle.snapshots,
    (snapshots) => {
      for (const [rowId, snapshot] of Object.entries(snapshots)) {
        const dialogueId = watchedRows.get(rowId);
        if (!dialogueId) continue;
        const state = options.chatStates.value[dialogueId];
        if (!state) continue;
        state.agentRunLifecycles[rowId] = snapshot;
        if (snapshot.terminal) {
          void reloadDialogue(rowId, dialogueId, state);
          watchedRows.delete(rowId);
          lifecycle.unwatchRow(rowId);
        }
      }
    },
    { deep: true }
  );

  const synchronize = (): void => {
    const desiredRows = new Map<
      string,
      { dialogueId: string; initial?: AgentTaskLifecycle }
    >();
    for (const [dialogueId, state] of Object.entries(
      options.chatStates.value
    )) {
      if (state.historyHydration !== "ready") continue;
      for (const message of state.renderedChat?.messages ?? []) {
        const rowId = isWatchableMessage(message);
        if (!rowId || state.agentRunLifecycles[rowId]?.terminal) continue;
        if (desiredRows.has(rowId)) continue;
        desiredRows.set(rowId, {
          dialogueId,
          initial: state.agentRunLifecycles[rowId],
        });
      }
    }

    for (const [rowId, dialogueId] of watchedRows) {
      if (desiredRows.get(rowId)?.dialogueId === dialogueId) continue;
      lifecycle.unwatchRow(rowId);
      watchedRows.delete(rowId);
    }
    for (const [rowId, desired] of desiredRows) {
      if (watchedRows.get(rowId) === desired.dialogueId) continue;
      watchedRows.set(rowId, desired.dialogueId);
      lifecycle.watchRow(rowId, desired.initial);
    }
  };

  const stopWatchingStates = watch(options.chatStates, synchronize, {
    deep: true,
    immediate: true,
  });

  const disposeDialogue = (dialogueId: string): void => {
    for (const [rowId, ownerDialogueId] of watchedRows) {
      if (ownerDialogueId !== dialogueId) continue;
      lifecycle.unwatchRow(rowId);
      watchedRows.delete(rowId);
    }
  };

  return {
    disposeDialogue,
    dispose: () => {
      stopWatchingStates();
      stopWatchingSnapshots();
      watchedRows.clear();
      lifecycle.dispose();
    },
  };
}
