import { computed, ref, watch, type ComputedRef, type Ref } from "vue";
import { getAnswerCheck } from "@/api/chat";
import type { AgentRunPhase, AgentTaskLifecycle } from "@/api/types";
import type { RemoteAgentTool } from "@/constants/agents";
import type { BotRunProjection } from "@/views/chat/botProjection";
import type {
  BotRemoteAgentRunState,
  RemoteAgentRunIdentity,
} from "./useBotRemoteAgentRun";
import { useAgentRunLifecycle } from "./useAgentRunLifecycle";
import { findRemoteAgentHistorySnapshot } from "./remoteAgentHistory";
import { useChatStates } from "./useChatStates";
import { useExecutionEvents } from "./useExecutionEvents";
import type { ExecutionRunState } from "../streaming/executionEvents";

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

function executionPhase(state: ExecutionRunState): AgentRunPhase {
  const status = state.terminal?.status ?? state.status;
  switch (status) {
    case "succeeded":
    case "partial":
      return "SUCCEEDED";
    case "failed":
      return "FAILED";
    case "cancelled":
      return "CANCELLED";
    case "timed_out":
      return "TIMED_OUT";
    default:
      break;
  }
  switch ((state.phase ?? "").toUpperCase()) {
    case "RESOLVING_INPUTS":
      return "RESOLVING_INPUTS";
    case "PLANNING":
      return "PLANNING";
    case "FINALIZING":
      return "FINALIZING";
    case "RUNNING":
      return "RUNNING";
    default:
      return state.latestSeq > 0 ? "RUNNING" : "PREPARING";
  }
}

function executionSnapshot(
  rowId: string,
  state: ExecutionRunState
): AgentTaskLifecycle {
  const phase = executionPhase(state);
  const resultMedia = state.results.map((result) =>
    result.mediaType.toLowerCase()
  );
  return {
    id: Number(rowId),
    phase,
    terminal: state.terminal !== null,
    child_task_count: Object.keys(state.spans).length,
    child_work_accepted: state.latestSeq > 0,
    report_revision: state.outputRevision,
    artifact_summary: {
      image_count: resultMedia.filter((media) => media.startsWith("image/"))
        .length,
      output_directory_count: 0,
      has_report:
        state.outputText.length > 0 ||
        resultMedia.some(
          (media) =>
            media === "text/markdown" ||
            media === "text/html" ||
            media === "application/pdf"
        ),
    },
    reconciliation:
      state.delivery === "connected" && state.trackingHealth !== "degraded"
        ? "FRESH"
        : "DEGRADED",
    tracking_degraded:
      state.trackingHealth === "degraded" || state.delivery === "stale",
    error_code: null,
  };
}

function remotePhase(phase: AgentRunPhase): BotRemoteAgentRunState["phase"] {
  switch (phase) {
    case "SUCCEEDED":
      return "succeeded";
    case "FAILED":
      return "failed";
    case "TIMED_OUT":
      return "timed_out";
    case "CANCELLED":
      return "cancelled";
    default:
      return "running";
  }
}

export function useRemoteAgentLifecycle(options: {
  tool: RemoteAgentTool;
  run: RemoteAgentLifecycleRun;
  dialogueId: string;
}): RemoteAgentLifecycleController {
  const executionStates = useChatStates();
  const executionEvents = useExecutionEvents({
    getChatState: executionStates.getChatState,
  });
  const trackedRowId = ref<string | null>(null);
  let trackedRunId: string | null = null;
  let trackedDialogueId: string | null = null;
  let trackedExecutionId: string | null = null;
  let trackedExecutionDialogueId: string | null = null;
  let generation = 0;
  let historyEpoch = 0;
  let disposed = false;
  let terminalHistoryWork: TerminalHistoryWork | null = null;

  const executionRun = computed<ExecutionRunState | null>(() => {
    const executionId = options.run.state.value.executionId;
    if (!executionId) return null;
    const dialogueId = options.run.state.value.dialogueId ?? options.dialogueId;
    return (
      executionStates.getChatState(dialogueId).executionRuns[executionId] ??
      null
    );
  });

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

  const stopExecutionTracking = (): void => {
    if (trackedExecutionId && trackedExecutionDialogueId) {
      executionEvents.disposeRun(
        trackedExecutionDialogueId,
        trackedExecutionId
      );
    }
    trackedExecutionId = null;
    trackedExecutionDialogueId = null;
  };

  const stopWatch = watch(
    () =>
      [
        options.run.state.value.messageId,
        options.run.state.value.phase,
        options.run.state.value.delivery?.status,
        options.run.state.value.projection?.runId,
        options.run.state.value.dialogueId ?? options.dialogueId,
        options.run.state.value.executionId,
      ] as const,
    ([messageId, phase, deliveryStatus, runId, dialogueId, executionId]) => {
      const rowId = positiveRowId(messageId);
      if (executionId) {
        if (
          trackedExecutionId !== executionId ||
          trackedExecutionDialogueId !== dialogueId
        ) {
          stopExecutionTracking();
          trackedExecutionId = executionId;
          trackedExecutionDialogueId = dialogueId;
          void executionEvents.attachExecution(dialogueId, executionId);
        }
        if (
          trackedRowId.value !== rowId ||
          trackedRunId !== (runId ?? null) ||
          trackedDialogueId !== dialogueId
        ) {
          stopTracking();
          trackedRowId.value = rowId;
          trackedRunId = runId ?? null;
          trackedDialogueId = dialogueId;
        }
        return;
      }
      stopExecutionTracking();
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

  const stopExecutionStateWatch = watch(
    executionRun,
    (state) => {
      if (!state) return;
      const phase = executionPhase(state);
      const current = options.run.state.value;
      const nextPhase = remotePhase(phase);
      const nextStatus =
        phase === "SUCCEEDED" ||
        phase === "FAILED" ||
        phase === "TIMED_OUT" ||
        phase === "CANCELLED"
          ? phase
          : "RUNNING";
      if (current.phase !== nextPhase || current.status !== nextStatus) {
        options.run.state.value = {
          ...current,
          phase: nextPhase,
          status: nextStatus,
        };
      }
      const rowId = trackedRowId.value;
      if (rowId && state.terminal) reconcileTerminalHistory(rowId);
    },
    { deep: true, immediate: true }
  );

  const snapshot = computed(() => {
    const rowId = trackedRowId.value;
    if (rowId && executionRun.value) {
      return executionSnapshot(rowId, executionRun.value);
    }
    return rowId ? (lifecycle.snapshots.value[rowId] ?? null) : null;
  });

  const reset = (): void => {
    stopExecutionTracking();
    stopTracking();
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    stopWatch();
    stopExecutionStateWatch();
    reset();
    executionEvents.dispose();
    lifecycle.dispose();
  };

  return { snapshot, reset, dispose };
}
