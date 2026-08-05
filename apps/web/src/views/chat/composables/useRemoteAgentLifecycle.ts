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
  let generation = 0;
  let disposed = false;

  const reconcileHistory = async (rowId: string): Promise<void> => {
    const expectedRunId = options.run.state.value.projection?.runId;
    if (!expectedRunId) return;
    const dialogueId = options.run.state.value.dialogueId ?? options.dialogueId;
    const currentGeneration = generation;
    const response = await getAnswerCheck({ dialogue_id: dialogueId });
    if (
      disposed ||
      generation !== currentGeneration ||
      trackedRowId.value !== rowId
    ) {
      return;
    }
    if (response.code !== 200 || !Array.isArray(response.data)) return;
    const snapshot = findRemoteAgentHistorySnapshot(
      response.data,
      options.tool,
      expectedRunId
    );
    if (!snapshot) return;
    const identity: Partial<RemoteAgentRunIdentity> = {
      dialogueId: snapshot.dialogueId ?? dialogueId,
      messageId: snapshot.rowId,
    };
    if (snapshot.artifactLinks !== undefined) {
      identity.artifactLinks = snapshot.artifactLinks;
    }
    options.run.hydrate(snapshot.projection, identity);
  };

  const lifecycle = useAgentRunLifecycle({
    scope: `remote-${options.tool}`,
    onSnapshot: (rowId) => reconcileHistory(rowId),
  });

  const stopTracking = (): void => {
    generation += 1;
    const rowId = trackedRowId.value;
    trackedRowId.value = null;
    if (rowId) lifecycle.unwatchRow(rowId);
  };

  const stopWatch = watch(
    () =>
      [
        options.run.state.value.messageId,
        options.run.state.value.phase,
        options.run.state.value.delivery?.status,
      ] as const,
    ([messageId, phase, deliveryStatus]) => {
      const rowId = positiveRowId(messageId);
      if (!rowId) {
        stopTracking();
        return;
      }
      if (trackedRowId.value === rowId) return;
      if (!ACTIVE_PHASES.has(phase) && deliveryStatus !== "pending") {
        stopTracking();
        return;
      }
      stopTracking();
      trackedRowId.value = rowId;
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
