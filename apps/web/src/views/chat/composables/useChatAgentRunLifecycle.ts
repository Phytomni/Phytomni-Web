import { watch, type Ref } from "vue";
import { normalizePositiveTaskRowId, getTaskLifecycle } from "@/api/task";
import type { AgentTaskLifecycle } from "@/api/types";
import type { ChatMessage, ChatUIState } from "../types";
import type { ChatReloadResult } from "./useSelectChat";
import { isPollableWaitTool } from "../utils/async-agent-policy";
import {
  type LifecycleScheduler,
  useAgentRunLifecycle,
} from "./useAgentRunLifecycle";

const TERMINAL_HISTORY_STATUSES = new Set([
  "SUCCEEDED",
  "FAILED",
  "TIMED_OUT",
  "TIMEOUT",
  "CANCELLED",
  "CANCELED",
]);

const RELOAD_RETRY_DELAYS_MS = [1000, 2000] as const;
const MAX_RELOAD_ATTEMPTS = RELOAD_RETRY_DELAYS_MS.length + 1;
type ReloadTimer = ReturnType<LifecycleScheduler["setTimeout"]>;

type ReloadWork = {
  dialogueId: string;
  state: ChatUIState;
  signature: string;
  terminal: boolean;
  attempts: number;
  timer?: ReloadTimer;
};

function needsHistoryHydration(
  next: AgentTaskLifecycle,
  previous?: AgentTaskLifecycle
): boolean {
  if (next.terminal) return true;
  const previousSummary = previous?.artifact_summary;
  return (
    next.report_revision > (previous?.report_revision ?? 0) ||
    (next.artifact_summary.has_report && !previousSummary?.has_report) ||
    next.artifact_summary.image_count > (previousSummary?.image_count ?? 0) ||
    next.artifact_summary.output_directory_count >
      (previousSummary?.output_directory_count ?? 0)
  );
}

function lifecycleReloadSignature(next: AgentTaskLifecycle): string {
  return [
    next.phase,
    next.terminal ? "1" : "0",
    String(next.child_task_count),
    String(next.report_revision),
    String(next.artifact_summary.image_count),
    String(next.artifact_summary.output_directory_count),
    next.artifact_summary.has_report ? "1" : "0",
  ].join("|");
}

function isWatchableMessage(message: ChatMessage): string | null {
  if (!isPollableWaitTool(message.tool_name)) return null;
  const deliveryPending = message.delivery?.status === "pending";
  if (
    TERMINAL_HISTORY_STATUSES.has((message.status ?? "").toUpperCase()) &&
    !deliveryPending
  ) {
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
  reloadChat: (dialogueId: string) => Promise<ChatReloadResult>;
  fetchLifecycle?: typeof getTaskLifecycle;
  maxConcurrent?: number;
  scheduler?: LifecycleScheduler;
  jitter?: () => number;
  documentRef?: Pick<
    Document,
    "hidden" | "addEventListener" | "removeEventListener"
  >;
}): { disposeDialogue: (dialogueId: string) => void; dispose: () => void } {
  const scheduler: LifecycleScheduler = options.scheduler ?? {
    setTimeout: (callback, delay) => setTimeout(callback, delay),
    clearTimeout: (timer) => clearTimeout(timer),
  };
  const watchedRows = new Map<string, string>();
  const reloadWorkByRow = new Map<string, ReloadWork>();
  const activeReloadRows = new Set<string>();
  let disposed = false;

  const clearReloadTimer = (work: ReloadWork): void => {
    if (work.timer === undefined) return;
    scheduler.clearTimeout(work.timer);
    work.timer = undefined;
  };

  const cancelReloadWork = (rowId: string): void => {
    const work = reloadWorkByRow.get(rowId);
    if (!work) return;
    clearReloadTimer(work);
    if (options.chatStates.value[work.dialogueId] === work.state) {
      delete work.state.refreshingMessages[rowId];
    }
    reloadWorkByRow.delete(rowId);
  };

  const ownsReloadWork = (rowId: string, work: ReloadWork): boolean =>
    !disposed &&
    reloadWorkByRow.get(rowId) === work &&
    watchedRows.get(rowId) === work.dialogueId &&
    options.chatStates.value[work.dialogueId] === work.state;

  const runReloadWork = async (
    rowId: string,
    work: ReloadWork
  ): Promise<void> => {
    if (!ownsReloadWork(rowId, work) || activeReloadRows.has(rowId)) return;

    activeReloadRows.add(rowId);
    work.attempts += 1;
    work.state.refreshingMessages[rowId] = true;
    let outcome: ChatReloadResult;
    try {
      outcome = await options.reloadChat(work.dialogueId);
    } catch {
      outcome = "failed";
    } finally {
      if (ownsReloadWork(rowId, work)) {
        delete work.state.refreshingMessages[rowId];
      }
      activeReloadRows.delete(rowId);
    }

    const currentWork = reloadWorkByRow.get(rowId);
    if (currentWork !== work) {
      if (currentWork && ownsReloadWork(rowId, currentWork)) {
        void runReloadWork(rowId, currentWork);
      }
      return;
    }
    if (!ownsReloadWork(rowId, work)) {
      cancelReloadWork(rowId);
      return;
    }

    const retryDelay = RELOAD_RETRY_DELAYS_MS[work.attempts - 1];
    if (
      outcome === "failed" &&
      work.attempts < MAX_RELOAD_ATTEMPTS &&
      retryDelay !== undefined
    ) {
      work.timer = scheduler.setTimeout(() => {
        work.timer = undefined;
        void runReloadWork(rowId, work);
      }, retryDelay);
      return;
    }

    reloadWorkByRow.delete(rowId);
    if (!work.terminal) return;
    const snapshot = work.state.agentRunLifecycles[rowId];
    if (
      watchedRows.get(rowId) !== work.dialogueId ||
      options.chatStates.value[work.dialogueId] !== work.state ||
      snapshot?.terminal !== true ||
      lifecycleReloadSignature(snapshot) !== work.signature
    ) {
      return;
    }
    watchedRows.delete(rowId);
    lifecycle.unwatchRow(rowId);
  };

  const requestReload = (
    rowId: string,
    dialogueId: string,
    state: ChatUIState,
    snapshot: AgentTaskLifecycle
  ): void => {
    if (disposed) return;
    const signature = lifecycleReloadSignature(snapshot);
    const previousWork = reloadWorkByRow.get(rowId);
    if (
      previousWork?.signature === signature &&
      previousWork.dialogueId === dialogueId &&
      previousWork.state === state
    ) {
      return;
    }
    if (previousWork) clearReloadTimer(previousWork);

    const work: ReloadWork = {
      dialogueId,
      state,
      signature,
      terminal: snapshot.terminal,
      attempts: 0,
    };
    reloadWorkByRow.set(rowId, work);
    if (!activeReloadRows.has(rowId)) void runReloadWork(rowId, work);
  };

  const lifecycle = useAgentRunLifecycle({
    scope: "chat-lifecycle",
    fetchLifecycle: options.fetchLifecycle,
    maxConcurrent: options.maxConcurrent,
    scheduler,
    jitter: options.jitter,
    documentRef: options.documentRef,
    onSnapshot: (rowId, next, previous) => {
      const dialogueId = watchedRows.get(rowId);
      if (!dialogueId) return;
      const state = options.chatStates.value[dialogueId];
      if (!state) return;

      state.agentRunLifecycles[rowId] = next;
      if (needsHistoryHydration(next, previous)) {
        requestReload(rowId, dialogueId, state, next);
      }
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
          requestReload(rowId, dialogueId, state, snapshot);
        }
      }
    },
    { deep: true }
  );

  const synchronize = (): void => {
    const desiredRows = new Map<
      string,
      {
        dialogueId: string;
        state: ChatUIState;
        initial?: AgentTaskLifecycle;
      }
    >();
    for (const [dialogueId, state] of Object.entries(
      options.chatStates.value
    )) {
      if (state.historyHydration !== "ready") continue;
      for (const message of state.renderedChat?.messages ?? []) {
        const rowId = isWatchableMessage(message);
        if (!rowId) continue;
        const snapshot = state.agentRunLifecycles[rowId];
        const reloadWork = reloadWorkByRow.get(rowId);
        if (
          snapshot?.terminal &&
          (!reloadWork?.terminal || reloadWork.state !== state)
        ) {
          continue;
        }
        if (desiredRows.has(rowId)) continue;
        desiredRows.set(rowId, {
          dialogueId,
          state,
          initial: state.agentRunLifecycles[rowId],
        });
      }
    }

    for (const [rowId, dialogueId] of watchedRows) {
      const desired = desiredRows.get(rowId);
      if (desired?.dialogueId === dialogueId) continue;
      const reloadWork = reloadWorkByRow.get(rowId);
      if (
        desired &&
        reloadWork?.dialogueId === dialogueId &&
        reloadWork.state === desired.state
      ) {
        clearReloadTimer(reloadWork);
        const migratedWork: ReloadWork = {
          dialogueId: desired.dialogueId,
          state: desired.state,
          signature: reloadWork.signature,
          terminal: reloadWork.terminal,
          attempts: 0,
        };
        reloadWorkByRow.set(rowId, migratedWork);
        watchedRows.set(rowId, desired.dialogueId);
        if (!activeReloadRows.has(rowId)) {
          void runReloadWork(rowId, migratedWork);
        }
        continue;
      }
      lifecycle.unwatchRow(rowId);
      watchedRows.delete(rowId);
      cancelReloadWork(rowId);
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
      cancelReloadWork(rowId);
    }
    for (const [rowId, work] of reloadWorkByRow) {
      if (work.dialogueId === dialogueId) cancelReloadWork(rowId);
    }
  };

  return {
    disposeDialogue,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      stopWatchingStates();
      stopWatchingSnapshots();
      for (const rowId of [...reloadWorkByRow.keys()]) {
        cancelReloadWork(rowId);
      }
      watchedRows.clear();
      lifecycle.dispose();
    },
  };
}
