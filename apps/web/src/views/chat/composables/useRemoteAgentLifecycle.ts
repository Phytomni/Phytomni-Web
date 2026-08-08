import { computed, ref, watch, type ComputedRef, type Ref } from "vue";
import { getAnswerCheck } from "@/api/chat";
import type { AgentTaskLifecycle } from "@/api/types";
import type { RemoteAgentTool } from "@/constants/agents";
import type { BotRunProjection } from "@/views/chat/botProjection";
import type {
  BotRemoteAgentRunState,
  RemoteAgentRunIdentity,
} from "./useBotRemoteAgentRun";
import { useAgentRunLifecycle } from "./useAgentRunLifecycle";
import { findRemoteAgentHistorySnapshot } from "./remoteAgentHistory";

const SAFE_ROW_ID = /^[1-9]\d{0,18}$/u;
const ACTIVE_PHASES = new Set(["submitting", "running", "input_required"]);
const TERMINAL_HISTORY_RETRY_DELAYS_MS = [1000, 2000] as const;

type HistoryReconciliationIdentity = {
  rowId: string;
  runId: string;
  dialogueId: string;
  generation: number;
  historyEpoch: number;
};

type TerminalHistoryWork = HistoryReconciliationIdentity & {
  attempts: number;
  timer?: ReturnType<typeof setTimeout>;
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

export interface RemoteAgentLifecycleRun {
  state: Ref<BotRemoteAgentRunState>;
  hydrate: (
    projection: BotRunProjection,
    identity?: Partial<RemoteAgentRunIdentity>
  ) => void;
}

export interface RemoteAgentLifecycleController {
  snapshot: ComputedRef<AgentTaskLifecycle | null>;
  reset: () => void;
  dispose: () => void;
}

function positiveRowId(value: unknown): string | null {
  if (typeof value !== "string" || !SAFE_ROW_ID.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? value : null;
}

export function useRemoteAgentLifecycle(options: {
  tool: RemoteAgentTool;
  run: RemoteAgentLifecycleRun;
  dialogueId: string;
}): RemoteAgentLifecycleController {
  const trackedRowId = ref<string | null>(null);
  let trackedRunId: string | null = null;
  let trackedDialogueId: string | null = null;
  let generation = 0;
  let historyEpoch = 0;
  let disposed = false;
  let terminalHistoryWork: TerminalHistoryWork | null = null;

  const ownsHistoryWork = (
    identity: HistoryReconciliationIdentity
  ): boolean => {
    const state = options.run.state.value;
    return (
      !disposed &&
      generation === identity.generation &&
      historyEpoch === identity.historyEpoch &&
      trackedRowId.value === identity.rowId &&
      trackedRunId === identity.runId &&
      trackedDialogueId === identity.dialogueId &&
      positiveRowId(state.messageId) === identity.rowId &&
      state.projection?.runId === identity.runId &&
      (state.dialogueId ?? options.dialogueId) === identity.dialogueId
    );
  };

  const captureHistoryIdentity = (
    rowId: string
  ): HistoryReconciliationIdentity | null => {
    const runId = options.run.state.value.projection?.runId;
    if (!runId) return null;
    const dialogueId = options.run.state.value.dialogueId ?? options.dialogueId;
    const identity = {
      rowId,
      runId,
      dialogueId,
      generation,
      historyEpoch,
    };
    return ownsHistoryWork(identity) ? identity : null;
  };

  const beginHistoryReconciliation = (
    rowId: string
  ): HistoryReconciliationIdentity | null => {
    historyEpoch += 1;
    return captureHistoryIdentity(rowId);
  };

  const reconcileHistoryAttempt = async (
    identity: HistoryReconciliationIdentity
  ): Promise<boolean> => {
    if (!ownsHistoryWork(identity)) return false;
    const response = await getAnswerCheck({
      dialogue_id: identity.dialogueId,
    });
    if (!ownsHistoryWork(identity)) return false;
    if (response.code !== 200 || !Array.isArray(response.data)) return false;
    const snapshot = findRemoteAgentHistorySnapshot(
      response.data,
      options.tool,
      identity.runId,
      identity.rowId,
      identity.dialogueId
    );
    if (!snapshot || !ownsHistoryWork(identity)) return false;
    const runIdentity: Partial<RemoteAgentRunIdentity> = {
      dialogueId: identity.dialogueId,
      messageId: identity.rowId,
    };
    if (snapshot.artifactLinks !== undefined) {
      runIdentity.artifactLinks = snapshot.artifactLinks;
    }
    if (!ownsHistoryWork(identity)) return false;
    options.run.hydrate(snapshot.projection, runIdentity);
    return true;
  };

  const reconcileHistory = async (rowId: string): Promise<void> => {
    if (terminalHistoryWork) return;
    const identity = beginHistoryReconciliation(rowId);
    if (!identity) return;
    await reconcileHistoryAttempt(identity);
  };

  const clearTerminalHistoryWork = (work?: TerminalHistoryWork): void => {
    if (!terminalHistoryWork || (work && terminalHistoryWork !== work)) return;
    if (terminalHistoryWork.timer !== undefined) {
      clearTimeout(terminalHistoryWork.timer);
    }
    terminalHistoryWork = null;
  };

  const runTerminalHistoryWork = async (
    work: TerminalHistoryWork
  ): Promise<void> => {
    if (terminalHistoryWork !== work || !ownsHistoryWork(work)) {
      clearTerminalHistoryWork(work);
      return;
    }
    work.attempts += 1;
    let hydrated = false;
    try {
      hydrated = await reconcileHistoryAttempt(work);
    } catch {
      hydrated = false;
    }
    if (terminalHistoryWork !== work || !ownsHistoryWork(work)) {
      clearTerminalHistoryWork(work);
      return;
    }
    if (hydrated) {
      clearTerminalHistoryWork(work);
      return;
    }
    const delay = TERMINAL_HISTORY_RETRY_DELAYS_MS[work.attempts - 1];
    if (delay === undefined) {
      clearTerminalHistoryWork(work);
      return;
    }
    work.timer = setTimeout(() => {
      work.timer = undefined;
      void runTerminalHistoryWork(work);
    }, delay);
  };

  const reconcileTerminalHistory = (rowId: string): void => {
    if (
      terminalHistoryWork?.rowId === rowId &&
      ownsHistoryWork(terminalHistoryWork)
    ) {
      return;
    }
    clearTerminalHistoryWork();
    const identity = beginHistoryReconciliation(rowId);
    if (!identity) return;
    const work: TerminalHistoryWork = { ...identity, attempts: 0 };
    terminalHistoryWork = work;
    void runTerminalHistoryWork(work);
  };

  const lifecycle = useAgentRunLifecycle({
    scope: `remote-${options.tool}`,
    onSnapshot: (rowId, next, previous) => {
      if (next.terminal) {
        reconcileTerminalHistory(rowId);
        return;
      }
      if (needsHistoryHydration(next, previous)) {
        return reconcileHistory(rowId);
      }
    },
  });

  const stopTracking = (): void => {
    generation += 1;
    historyEpoch += 1;
    clearTerminalHistoryWork();
    const rowId = trackedRowId.value;
    trackedRowId.value = null;
    trackedRunId = null;
    trackedDialogueId = null;
    if (rowId) lifecycle.unwatchRow(rowId);
  };

  const stopWatch = watch(
    () =>
      [
        options.run.state.value.messageId,
        options.run.state.value.phase,
        options.run.state.value.delivery?.status,
        options.run.state.value.projection?.runId,
        options.run.state.value.dialogueId ?? options.dialogueId,
      ] as const,
    ([messageId, phase, deliveryStatus, runId, dialogueId]) => {
      const rowId = positiveRowId(messageId);
      if (!rowId) {
        stopTracking();
        return;
      }
      if (
        trackedRowId.value === rowId &&
        trackedRunId === (runId ?? null) &&
        trackedDialogueId === dialogueId
      ) {
        return;
      }
      if (!ACTIVE_PHASES.has(phase) && deliveryStatus !== "pending") {
        stopTracking();
        return;
      }
      stopTracking();
      trackedRowId.value = rowId;
      trackedRunId = runId ?? null;
      trackedDialogueId = dialogueId;
      lifecycle.watchRow(rowId);
    },
    { immediate: true, flush: "sync" }
  );

  const snapshot = computed(() => {
    const rowId = trackedRowId.value;
    return rowId ? (lifecycle.snapshots.value[rowId] ?? null) : null;
  });

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    stopWatch();
    stopTracking();
    lifecycle.dispose();
  };

  return { snapshot, reset: stopTracking, dispose };
}
