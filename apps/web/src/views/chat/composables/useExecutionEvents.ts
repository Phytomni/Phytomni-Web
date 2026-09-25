import {
  getExecutionEvents,
  getExecutionEventsById,
  getExecutionProjection,
  getExecutionProjectionById,
  openExecutionEventStreamById,
} from "@/api/execution-events";
import type { ApiEnvelope } from "@/api/types";
import type { ChatUIState } from "../types";
import { canonicalAgentToolFromIdentity } from "@/constants/agents";
import {
  decodeCitationDocuments,
  decodeTableMessagePresentation,
} from "../utils/format";
import { executionReportProjection } from "../utils/report-presentation";
import { splitSSEFrames } from "../streaming/aguiEvents";
import {
  applyExecutionEvent,
  createExecutionRunState,
  decodeExecutionEvent,
  decodeExecutionProjection,
  hydrateExecutionProjection,
  openExecutionDiagnostics,
  openExecutionTarget,
  type ExecutionEvent,
  type ExecutionEventPage,
  type ExecutionProjection,
  type ExecutionRunState,
  type ExecutionTarget,
} from "../streaming/executionEvents";

type ExecutionClient = {
  getEvents: (data: {
    dialogueId: string;
    runId: string;
    afterSeq?: number;
    limit?: number;
  }) => Promise<ApiEnvelope<ExecutionEventPage>>;
  getProjection: (data: {
    dialogueId: string;
    runId: string;
  }) => Promise<ApiEnvelope<ExecutionProjection>>;
  getExecutionEvents?: (data: {
    executionId: string;
    afterSeq?: number;
    limit?: number;
  }) => Promise<ApiEnvelope<ExecutionEventPage>>;
  getExecutionProjection?: (data: {
    executionId: string;
  }) => Promise<ApiEnvelope<ExecutionProjection>>;
  openExecutionStream?: (data: {
    executionId: string;
    afterSeq: number;
    afterRevision?: number;
    afterOffset?: number;
    signal: AbortSignal;
  }) => Promise<Response>;
};

const defaultClient: ExecutionClient = {
  getEvents: getExecutionEvents,
  getProjection: getExecutionProjection,
  getExecutionEvents: getExecutionEventsById,
  getExecutionProjection: getExecutionProjectionById,
  openExecutionStream: openExecutionEventStreamById,
};

type ExecutionSubscription = {
  controller: AbortController;
  dialogueId: string;
  owner: symbol;
  getChatState: (dialogueId: string) => ChatUIState;
  projectRun: (
    dialogueId: string,
    run: ExecutionRunState,
    event?: ExecutionEvent
  ) => void;
};

// One application-level subscription registry owns each public execution.
// Component/composable remounts transfer the state projection callbacks on the
// existing subscription instead of opening another simultaneous SSE request.
const executionSubscriptions = new Map<string, ExecutionSubscription>();

function temporaryDialogueId(dialogueId: string): boolean {
  return dialogueId.startsWith("new_");
}

export type ParsedExecutionSSE =
  | { type: "event"; event: ExecutionEvent }
  | { type: "snapshot"; projection: ExecutionProjection }
  | {
      type: "content";
      executionId: string;
      revision: number;
      offset: number;
      delta: string;
    }
  | { type: "tracking"; health: string }
  | { type: "gap" }
  | { type: "heartbeat" }
  | { type: "invalid"; reason: string };

export function parseExecutionSSEFrame(frame: string): ParsedExecutionSSE {
  let eventName = "message";
  const dataLines: string[] = [];
  for (const raw of frame.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line.startsWith(":")) continue;
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    if (line.startsWith("data:"))
      dataLines.push(line.slice(5).replace(/^ /, ""));
  }
  if (dataLines.length === 0) return { type: "heartbeat" };
  if (eventName === "execution_gap") return { type: "gap" };
  let value: unknown;
  try {
    value = JSON.parse(dataLines.join("\n")) as unknown;
  } catch {
    return { type: "invalid", reason: "invalid_stream_json" };
  }
  if (eventName === "execution_event") {
    const decoded = decodeExecutionEvent(value);
    return decoded.ok
      ? { type: "event", event: decoded.value }
      : { type: "invalid", reason: decoded.reason };
  }
  if (eventName === "execution_snapshot") {
    const decoded = decodeExecutionProjection(value);
    return decoded.ok
      ? { type: "snapshot", projection: decoded.value }
      : { type: "invalid", reason: decoded.reason };
  }
  if (
    eventName === "execution_content" &&
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  ) {
    const raw = value as Record<string, unknown>;
    if (
      raw.schema_version === 2 &&
      typeof raw.execution_id === "string" &&
      typeof raw.output_revision === "number" &&
      Number.isSafeInteger(raw.output_revision) &&
      typeof raw.offset === "number" &&
      Number.isSafeInteger(raw.offset) &&
      typeof raw.delta === "string"
    ) {
      return {
        type: "content",
        executionId: raw.execution_id,
        revision: raw.output_revision,
        offset: raw.offset,
        delta: raw.delta,
      };
    }
  }
  if (
    eventName === "execution_tracking" &&
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  ) {
    const health = (value as Record<string, unknown>).tracking_health;
    if (typeof health === "string") return { type: "tracking", health };
  }
  return { type: "invalid", reason: "unknown_stream_event" };
}

function isEventStream(response: Response): boolean {
  return (
    response.headers
      .get("Content-Type")
      ?.split(";", 1)[0]
      .trim()
      .toLowerCase() === "text/event-stream"
  );
}

function terminal(state: ExecutionRunState): boolean {
  return state.terminal !== null;
}

function terminalProjectionStatus(
  status: ExecutionRunState["status"]
): boolean {
  switch (status) {
    case "succeeded":
    case "partial":
    case "failed":
    case "cancelled":
    case "timed_out":
      return true;
    default:
      return false;
  }
}

function hydrateStreamProjection(
  state: ExecutionRunState,
  projection: ExecutionProjection
): ExecutionRunState {
  // A stream snapshot is a projection high-water mark, not proof that this
  // client has consumed the events up to that sequence. The server sends the
  // snapshot before replaying events after the requested cursor. Keep both the
  // cursor and terminal fold at the consumed event boundary so replayed
  // message.completed and terminal facts are not discarded.
  const replayPending = projection.latestSeq > state.latestSeq;
  return hydrateExecutionProjection(state, {
    ...projection,
    latestSeq: state.latestSeq,
    ...(replayPending
      ? { status: state.status, terminal: state.terminal }
      : {}),
  });
}

function abortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    !Array.isArray(error) &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

function withStreamContact(state: ExecutionRunState): ExecutionRunState {
  const contactAt = new Date().toISOString();
  return {
    ...state,
    lastContactAt: contactAt,
    executionStage: state.executionStage
      ? {
          ...state.executionStage,
          clocks: {
            ...state.executionStage.clocks,
            lastStreamContactAt: contactAt,
          },
        }
      : null,
  };
}

export function useExecutionEvents(options: {
  getChatState: (dialogueId: string) => ChatUIState;
  client?: ExecutionClient;
  maxReconnectAttempts?: number;
  reconnectDelay?: (attempt: number) => Promise<void>;
}) {
  const subscriptionOwner = Symbol("execution-events-owner");
  const client = options.client ?? defaultClient;
  const maxReconnectAttempts = options.maxReconnectAttempts ?? 4;
  const reconnectDelay =
    options.reconnectDelay ??
    ((attempt: number) =>
      new Promise<void>((resolve) => {
        window.setTimeout(resolve, Math.min(500 * 2 ** attempt, 8_000));
      }));
  function projectRunToAssistantMessage(
    dialogueId: string,
    run: ExecutionRunState,
    event?: ExecutionEvent
  ): void {
    const messages = options.getChatState(dialogueId).renderedChat?.messages;
    if (!messages) return;
    const eventMessageId =
      event &&
      (event.kind === "message.snapshot" ||
        event.kind === "message.completed") &&
      typeof event.payload.message_id === "string"
        ? event.payload.message_id
        : null;
    const index = messages.findIndex(
      (message) =>
        message.role === "assistant" &&
        ((eventMessageId !== null && message.id === eventMessageId) ||
          message.executionId === run.executionId ||
          message.executionRun?.executionId === run.executionId)
    );
    if (index < 0) return;

    const current = messages[index];
    const currentRevision = current.contentRevision ?? 0;
    const currentOffset = current.contentOffset ?? 0;
    const hasNewerContent =
      run.outputRevision > currentRevision ||
      (run.outputRevision === currentRevision &&
        run.outputOffset > currentOffset);
    const totalLength =
      event &&
      typeof event.payload.total_length === "number" &&
      Number.isSafeInteger(event.payload.total_length) &&
      event.payload.total_length >= run.outputOffset
        ? event.payload.total_length
        : current.contentLength;
    const eventReferences =
      event?.kind === "message.completed"
        ? decodeCitationDocuments(event.payload.references)
        : undefined;
    const table =
      event?.kind === "message.completed"
        ? decodeTableMessagePresentation(run.outputText)
        : undefined;
    const toolName = canonicalAgentToolFromIdentity(
      run.selectedAgentId,
      run.agentSlug
    );
    const botProjection = toolName
      ? executionReportProjection(run, toolName, run.outputText)
      : undefined;
    messages.splice(index, 1, {
      ...current,
      ...(hasNewerContent
        ? {
            content: table?.content ?? run.outputText,
            contentRevision: run.outputRevision,
            contentOffset: run.outputOffset,
            contentLength: totalLength ?? run.outputOffset,
            tableHeaders: table?.tableHeaders,
            original: table?.original,
          }
        : {}),
      ...(!hasNewerContent && table ? table : {}),
      ...(eventReferences === undefined ? {} : { doc_list: eventReferences }),
      status: run.status,
      executionId: run.executionId,
      executionRun: run,
      ...(toolName ? { tool_name: toolName } : {}),
      ...(botProjection ? { botProjection } : {}),
      ...(run.routeReasonCode
        ? { route_reason_code: run.routeReasonCode }
        : {}),
    });
  }

  function setRun(
    dialogueId: string,
    run: ExecutionRunState,
    event?: ExecutionEvent
  ): void {
    const chatState = options.getChatState(dialogueId);
    chatState.executionRuns[run.executionId] = run;
    chatState.selectedExecutionRunId ??= run.executionId;
    projectRunToAssistantMessage(dialogueId, run, event);
  }

  async function refreshProjection(
    dialogueId: string,
    runId: string,
    delivery: ExecutionRunState["delivery"] = "connected"
  ): Promise<ExecutionRunState> {
    const chatState = options.getChatState(dialogueId);
    const existing =
      chatState.executionRuns[runId] ?? createExecutionRunState(runId);
    const response = await client.getProjection({ dialogueId, runId });
    if (response.code !== 200)
      throw new Error("execution projection unavailable");
    const next = {
      ...hydrateExecutionProjection(existing, response.data),
      delivery,
    };
    setRun(dialogueId, next);
    return next;
  }

  async function hydrateRun(
    dialogueId: string,
    runId: string,
    reset = false
  ): Promise<ExecutionRunState> {
    if (temporaryDialogueId(dialogueId)) {
      throw new Error("execution history requires a persisted dialogue");
    }
    const chatState = options.getChatState(dialogueId);
    let state = reset
      ? createExecutionRunState(runId)
      : (chatState.executionRuns[runId] ?? createExecutionRunState(runId));
    let cursor = state.latestSeq;
    try {
      for (;;) {
        const response = await client.getEvents({
          dialogueId,
          runId,
          afterSeq: cursor,
          limit: 200,
        });
        if (response.code !== 200)
          throw new Error("execution history unavailable");
        for (const event of response.data.items) {
          state = applyExecutionEvent(state, event);
          setRun(dialogueId, state, event);
          if (state.delivery === "gap") {
            return await refreshProjection(dialogueId, runId, "gap");
          }
        }
        cursor = response.data.nextAfterSeq;
        setRun(dialogueId, state);
        if (!response.data.hasMore) break;
      }
      return state;
    } catch (error) {
      const stale = {
        ...state,
        delivery: state.events.length ? "stale" : "degraded",
      } as ExecutionRunState;
      setRun(dialogueId, stale);
      throw error;
    }
  }

  async function attachExecution(
    dialogueId: string,
    executionId: string
  ): Promise<void> {
    if (!client.openExecutionStream || !executionId) return;
    const chatState = options.getChatState(dialogueId);
    if (!chatState.executionRuns[executionId]) {
      const observedAt = new Date().toISOString();
      chatState.executionRuns[executionId] = {
        ...createExecutionRunState(executionId, 2),
        delivery: "reconnecting",
        startedAt: observedAt,
        lastActivityAt: observedAt,
      };
    }
    chatState.selectedExecutionRunId = executionId;
    const active = executionSubscriptions.get(executionId);
    if (active) {
      active.dialogueId = dialogueId;
      active.owner = subscriptionOwner;
      active.getChatState = options.getChatState;
      active.projectRun = setRun;
      return;
    }
    const controller = new AbortController();
    const subscription: ExecutionSubscription = {
      controller,
      dialogueId,
      owner: subscriptionOwner,
      getChatState: options.getChatState,
      projectRun: setRun,
    };
    executionSubscriptions.set(executionId, subscription);
    const ownerState = () => subscription.getChatState(subscription.dialogueId);
    let cursor = chatState.executionRuns[executionId].latestSeq;
    let attempt = 0;
    try {
      while (!controller.signal.aborted) {
        if (attempt > 0) await reconnectDelay(attempt - 1);
        try {
          const currentState = ownerState();
          const before =
            currentState.executionRuns[executionId] ??
            createExecutionRunState(executionId, 2);
          const response = await client.openExecutionStream({
            executionId,
            afterSeq: cursor,
            afterRevision: before.outputRevision,
            afterOffset: before.outputOffset,
            signal: controller.signal,
          });
          if (!response.ok || !response.body || !isEventStream(response)) {
            throw new Error("execution stream unavailable");
          }
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let snapshotLatestSeq = 0;
          for (;;) {
            const part = await reader.read();
            if (part.done) break;
            buffer += decoder.decode(part.value, { stream: true });
            const split = splitSSEFrames(buffer);
            buffer = split.rest;
            for (const frame of split.frames) {
              const parsed = parseExecutionSSEFrame(frame);
              const liveState = ownerState();
              if (parsed.type === "heartbeat") {
                const current = liveState.executionRuns[executionId];
                if (current)
                  subscription.projectRun(
                    subscription.dialogueId,
                    withStreamContact(current)
                  );
                continue;
              }
              if (parsed.type === "invalid") {
                const current = liveState.executionRuns[executionId]
                  ? withStreamContact(liveState.executionRuns[executionId])
                  : undefined;
                if (current)
                  subscription.projectRun(subscription.dialogueId, {
                    ...current,
                    delivery: "degraded",
                  });
                continue;
              }
              if (parsed.type === "tracking") {
                const current = liveState.executionRuns[executionId]
                  ? withStreamContact(liveState.executionRuns[executionId])
                  : undefined;
                if (current)
                  subscription.projectRun(subscription.dialogueId, {
                    ...current,
                    trackingHealth: parsed.health,
                    delivery: "degraded",
                  });
                continue;
              }
              if (parsed.type === "snapshot") {
                const current = withStreamContact(
                  liveState.executionRuns[executionId] ??
                    createExecutionRunState(executionId, 2)
                );
                const stableProjection =
                  parsed.projection.schemaVersion === 1
                    ? { ...parsed.projection, executionId, runId: executionId }
                    : parsed.projection;
                snapshotLatestSeq = Math.max(
                  snapshotLatestSeq,
                  stableProjection.latestSeq
                );
                const replayPending =
                  stableProjection.latestSeq > current.latestSeq;
                const next = hydrateStreamProjection(current, stableProjection);
                subscription.projectRun(subscription.dialogueId, next);
                cursor = next.latestSeq;
                if (
                  (terminal(next) ||
                    terminalProjectionStatus(stableProjection.status)) &&
                  !replayPending
                )
                  return;
                continue;
              }
              if (parsed.type === "content") {
                const current = withStreamContact(
                  liveState.executionRuns[executionId] ??
                    createExecutionRunState(executionId, 2)
                );
                if (
                  parsed.executionId !== executionId ||
                  parsed.revision < current.outputRevision ||
                  (parsed.revision === current.outputRevision &&
                    parsed.offset <= current.outputOffset)
                )
                  continue;
                const deltaLength = [...parsed.delta].length;
                const newerRevision = parsed.revision > current.outputRevision;
                const contiguous = newerRevision
                  ? parsed.offset === deltaLength
                  : parsed.offset === current.outputOffset + deltaLength;
                const next = {
                  ...current,
                  outputRevision: parsed.revision,
                  outputOffset: parsed.offset,
                  outputText: contiguous
                    ? newerRevision
                      ? parsed.delta
                      : current.outputText + parsed.delta
                    : current.outputText,
                  outputCompleted: false,
                  delivery: contiguous ? "connected" : "gap",
                } as ExecutionRunState;
                subscription.projectRun(subscription.dialogueId, next);
                continue;
              }
              if (parsed.type === "gap") {
                const current = liveState.executionRuns[executionId];
                if (current)
                  subscription.projectRun(subscription.dialogueId, {
                    ...current,
                    delivery: "gap",
                  });
                if (!client.getExecutionProjection) {
                  throw new Error("execution stream gap");
                }
                const projection = await client.getExecutionProjection({
                  executionId,
                });
                if (projection.code !== 200) {
                  throw new Error("execution projection unavailable");
                }
                const projectionState =
                  liveState.executionRuns[executionId] ??
                  createExecutionRunState(executionId, 2);
                const stableProjection =
                  projection.data.schemaVersion === 1
                    ? { ...projection.data, executionId, runId: executionId }
                    : projection.data;
                const recovered = {
                  ...hydrateExecutionProjection(
                    projectionState,
                    stableProjection
                  ),
                  delivery: "gap" as const,
                };
                subscription.projectRun(subscription.dialogueId, recovered);
                cursor = recovered.latestSeq;
                if (terminal(recovered)) return;
                throw new Error("execution stream gap recovered");
              }
              const current = withStreamContact(
                liveState.executionRuns[executionId] ??
                  createExecutionRunState(executionId, 2)
              );
              const stableEvent =
                parsed.event.schemaVersion === 1
                  ? { ...parsed.event, executionId, runId: executionId }
                  : parsed.event;
              const withBotRun =
                parsed.event.schemaVersion === 1 && current.botRunId === null
                  ? { ...current, botRunId: parsed.event.runId }
                  : current;
              const next = applyExecutionEvent(withBotRun, stableEvent);
              subscription.projectRun(
                subscription.dialogueId,
                next,
                stableEvent
              );
              cursor = next.latestSeq;
              if (terminal(next) && next.latestSeq >= snapshotLatestSeq) return;
            }
          }
        } catch (error) {
          if (controller.signal.aborted || abortError(error)) return;
        }
        attempt += 1;
        if (attempt > maxReconnectAttempts) {
          const current = ownerState().executionRuns[executionId];
          if (current)
            subscription.projectRun(subscription.dialogueId, {
              ...current,
              delivery: "stale",
            });
          return;
        }
      }
    } finally {
      if (executionSubscriptions.get(executionId) === subscription)
        executionSubscriptions.delete(executionId);
    }
  }

  function openTarget(
    dialogueId: string,
    target: ExecutionTarget,
    title: string
  ): void {
    const state = options.getChatState(dialogueId);
    const opened = openExecutionTarget(
      state.executionWorkspaceTabs,
      target,
      title
    );
    state.executionWorkspaceTabs = opened.tabs;
    state.activeExecutionWorkspaceTab = opened.activeKey;
    state.executionWorkspaceOpen = true;
  }

  function openDiagnostics(
    dialogueId: string,
    executionId: string,
    title: string
  ): void {
    const state = options.getChatState(dialogueId);
    const opened = openExecutionDiagnostics(
      state.executionWorkspaceTabs,
      executionId,
      title
    );
    state.executionWorkspaceTabs = opened.tabs;
    state.activeExecutionWorkspaceTab = opened.activeKey;
    state.executionWorkspaceOpen = true;
  }

  function closeTarget(dialogueId: string, key: string): void {
    const state = options.getChatState(dialogueId);
    const index = state.executionWorkspaceTabs.findIndex(
      (tab) => tab.key === key
    );
    if (index < 0) return;
    state.executionWorkspaceTabs = state.executionWorkspaceTabs.filter(
      (tab) => tab.key !== key
    );
    if (state.activeExecutionWorkspaceTab === key) {
      state.activeExecutionWorkspaceTab =
        state.executionWorkspaceTabs[
          Math.min(index, state.executionWorkspaceTabs.length - 1)
        ]?.key ?? null;
    }
    if (state.executionWorkspaceTabs.length === 0)
      state.executionWorkspaceOpen = false;
  }

  function disposeRun(dialogueId: string, runId: string): void {
    const subscription = executionSubscriptions.get(runId);
    if (
      subscription?.dialogueId !== dialogueId ||
      subscription.owner !== subscriptionOwner
    )
      return;
    subscription.controller.abort();
    executionSubscriptions.delete(runId);
  }

  function disposeDialogue(dialogueId: string): void {
    for (const [executionId, subscription] of executionSubscriptions) {
      if (
        subscription.dialogueId === dialogueId &&
        subscription.owner === subscriptionOwner
      ) {
        subscription.controller.abort();
        executionSubscriptions.delete(executionId);
      }
    }
  }

  function dispose(): void {
    for (const [executionId, subscription] of executionSubscriptions) {
      if (subscription.owner !== subscriptionOwner) continue;
      subscription.controller.abort();
      executionSubscriptions.delete(executionId);
    }
  }

  return {
    hydrateRun,
    refreshProjection,
    attachExecution,
    openTarget,
    openDiagnostics,
    closeTarget,
    disposeRun,
    disposeDialogue,
    dispose,
  };
}
