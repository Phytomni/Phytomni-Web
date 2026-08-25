import type { AguiEvent } from "./aguiEvents";

export const EXECUTION_EVENT_KINDS = [
  "execution.admitted",
  "execution.queued",
  "execution.dispatching",
  "execution.started",
  "execution.waiting_input",
  "execution.resumed",
  "execution.cancellation_requested",
  "execution.succeeded",
  "execution.partial",
  "execution.failed",
  "execution.cancelled",
  "execution.timed_out",
  "span.created",
  "span.started",
  "span.progress",
  "span.waiting_input",
  "span.resumed",
  "span.retry_scheduled",
  "span.succeeded",
  "span.partial",
  "span.failed",
  "span.cancelled",
  "span.timed_out",
  "span.skipped",
  "work_unit.registered",
  "work_unit.attempt_started",
  "work_unit.submitted",
  "work_unit.acknowledged",
  "work_unit.progress",
  "work_unit.retry_scheduled",
  "work_unit.cancellation_requested",
  "work_unit.cancellation_confirmed",
  "work_unit.succeeded",
  "work_unit.partial",
  "work_unit.failed",
  "work_unit.cancelled",
  "work_unit.timed_out",
  "run.started",
  "run.accepted",
  "run.waiting_input",
  "run.resumed",
  "run.succeeded",
  "run.failed",
  "run.cancelled",
  "phase.started",
  "phase.progress",
  "phase.completed",
  "phase.failed",
  "tool.started",
  "tool.completed",
  "tool.failed",
  "todo.snapshot",
  "reasoning.summary",
  "decision.note",
  "input.required",
  "input.resolved",
  "artifact.published",
  "tracking.degraded",
  "tracking.recovered",
  "sequence.gap",
  "result.published",
  "message.snapshot",
  "message.completed",
] as const;

export const EXECUTION_TARGET_KINDS = [
  "event",
  "artifact",
  "report",
  "todo",
  "preview",
  "download",
  "trace",
] as const;

const TRACE_TARGET_ID = /^trc_[A-Za-z0-9_-]{16,80}$/;

const EVENT_KIND_SET = new Set<string>(EXECUTION_EVENT_KINDS);
const TARGET_KIND_SET = new Set<string>(EXECUTION_TARGET_KINDS);
const EVENT_STATUS_SET = new Set([
  "admitted",
  "queued",
  "dispatching",
  "pending",
  "submitted",
  "acknowledged",
  "running",
  "waiting",
  "waiting_input",
  "retry_scheduled",
  "cancellation_requested",
  "succeeded",
  "partial",
  "failed",
  "cancelled",
  "timed_out",
  "skipped",
  "degraded",
]);
const TODO_STATUS_SET = new Set([
  "pending",
  "in_progress",
  "completed",
  "failed",
  "skipped",
]);
const OPERATION_STATUS_SET = new Set<ExecutionOperationStatus>([
  "queued",
  "running",
  "retrying",
  "succeeded",
  "partial",
  "failed",
  "cancelled",
  "timed_out",
]);
const OPERATION_ATTEMPT_STATUS_SET = new Set<ExecutionOperationAttemptStatus>([
  "running",
  "retry_scheduled",
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
]);
const EXECUTION_STAGE_SET = new Set<ExecutionStageName>([
  "orchestration",
  "scientific_execution",
  "consolidation",
  "response_settlement",
]);
const EXECUTION_STAGE_TODO_IDS = [
  "planning",
  "analysis",
  "consolidation",
  "response",
] as const;

const EVENT_PAYLOAD_FIELDS: Readonly<Record<string, ReadonlySet<string>>> = {
  "run.started": new Set(),
  "run.accepted": new Set(),
  "run.waiting_input": new Set(),
  "run.resumed": new Set(),
  "run.succeeded": new Set(),
  "run.failed": new Set(["code", "retryable"]),
  "run.cancelled": new Set(),
  "phase.started": new Set(["phase", "label_key"]),
  "phase.progress": new Set(["phase", "completed", "total"]),
  "phase.completed": new Set(["phase", "label_key"]),
  "phase.failed": new Set(["phase", "code"]),
  "tool.started": new Set(["tool_key", "call_id"]),
  "tool.completed": new Set(["tool_key", "call_id", "duration_ms"]),
  "tool.failed": new Set(["tool_key", "call_id", "duration_ms", "code"]),
  "todo.snapshot": new Set(["items"]),
  "reasoning.summary": new Set(["text"]),
  "decision.note": new Set(["text"]),
  "input.required": new Set(["surface_id", "widget"]),
  "input.resolved": new Set(["surface_id", "outcome"]),
  "artifact.published": new Set(["name", "media_type", "size_bytes"]),
  "tracking.degraded": new Set(["code", "retryable"]),
};

const FORBIDDEN_KEYS = new Set([
  "authorization",
  "authorization_header",
  "credential",
  "credentials",
  "headers",
  "path",
  "provider_payload",
  "raw_reasoning",
  "secret",
  "storage_key",
  "system_prompt",
  "token",
  "url",
  "prompt",
  "chain_of_thought",
  "model_tokens",
  "raw_log",
  "content",
  "arguments",
  "result",
  "query",
  "sql",
  "provider_body",
  "exception_text",
  "source_passage",
  "stdout",
  "stderr",
]);

export type ExecutionEventKind = (typeof EXECUTION_EVENT_KINDS)[number];
export type ExecutionTargetKind = (typeof EXECUTION_TARGET_KINDS)[number];
export type ExecutionStatus =
  | "admitted"
  | "queued"
  | "dispatching"
  | "pending"
  | "submitted"
  | "acknowledged"
  | "running"
  | "waiting"
  | "waiting_input"
  | "retry_scheduled"
  | "cancellation_requested"
  | "succeeded"
  | "partial"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "skipped"
  | "degraded";
export type TodoStatus =
  "pending" | "in_progress" | "completed" | "failed" | "skipped";

export interface ExecutionTarget {
  kind: ExecutionTargetKind;
  id: string;
}

export interface ExecutionSummary {
  key: string;
  text: string;
}

export interface ExecutionTodoItem {
  id: string;
  labelKey: string;
  status: TodoStatus;
}

export interface ExecutionResult {
  eventId: string;
  name: string;
  mediaType: string;
  sizeBytes: number;
  target: ExecutionTarget;
}

export interface ExecutionSpanState {
  spanId: string;
  parentSpanId: string | null;
  workUnitId: string | null;
  attempt: number;
  status: ExecutionStatus;
  lastEventId: string;
}

export type ExecutionOperationStatus =
  | "queued"
  | "running"
  | "retrying"
  | "succeeded"
  | "partial"
  | "failed"
  | "cancelled"
  | "timed_out";

export type ExecutionOperationAttemptStatus =
  | "running"
  | "retry_scheduled"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timed_out";

export interface ExecutionOperationAttempt {
  attempt: number;
  status: ExecutionOperationAttemptStatus;
  startedAt: string;
  completedAt: string | null;
  durationMs: number;
  failure: { code: string; retryable: boolean } | null;
  retry: { delayMs: number } | null;
}

export interface ExecutionOperationRecord {
  schemaVersion: 1;
  operationId: string;
  workUnitId: string;
  operationKey: string;
  labelKey: string;
  fallbackLabel: string;
  status: ExecutionOperationStatus;
  startedAt: string;
  lastObservationAt: string;
  completedAt: string | null;
  durationMs: number;
  currentAttempt: number;
  attempts: ExecutionOperationAttempt[];
  progress: { completed: number; total: number; unit: string } | null;
  detail: Record<string, number | boolean | string>;
  summary: {
    kind: "operation" | "decision" | "reasoning";
    text: string;
  } | null;
  target: ExecutionTarget | null;
}

export type ExecutionStageName =
  | "orchestration"
  | "scientific_execution"
  | "consolidation"
  | "response_settlement";

export type ExecutionTerminalStatus =
  "succeeded" | "partial" | "failed" | "cancelled" | "timed_out";

export interface ExecutionStageState {
  stage: ExecutionStageName;
  childStatus: "running" | ExecutionTerminalStatus | null;
  rootStatus: "running" | ExecutionTerminalStatus;
  answerAvailable: boolean;
  todos: Array<{
    id: "planning" | "analysis" | "consolidation" | "response";
    status: TodoStatus;
  }>;
  pendingStatusKey: string | null;
  clocks: {
    lastExecutionFactAt: string | null;
    lastProviderContactAt: string | null;
    lastStreamContactAt: string | null;
  };
}

export interface ExecutionEvent {
  schemaVersion: 1 | 2;
  eventId: string;
  executionId?: string;
  runId: string;
  seq: number;
  occurredAt: string;
  kind: ExecutionEventKind | string;
  known: boolean;
  ignorable: boolean;
  status: ExecutionStatus;
  summary: ExecutionSummary;
  payload: Readonly<Record<string, unknown>>;
  target?: ExecutionTarget;
  taskId?: string;
  parentEventId?: string;
  spanId?: string;
  parentSpanId?: string;
  workUnitId?: string;
  attempt?: number;
  source?: string;
}

export interface ExecutionProjection {
  schemaVersion: 1 | 2;
  executionId?: string;
  runId: string;
  latestSeq: number;
  status: ExecutionStatus;
  phase: string | null;
  todos: ExecutionTodoItem[];
  results: ExecutionResult[];
  inputRequired: {
    surfaceId: string;
    widget: string;
    actionRevision: number;
  } | null;
  terminal: {
    status: "succeeded" | "partial" | "failed" | "cancelled" | "timed_out";
    eventId: string;
  } | null;
  outputRevision?: number;
  outputOffset?: number;
  operationRevision?: number;
  trackingHealth?: string;
  activeSpanIds?: string[];
  todoDeclared?: boolean;
  targets?: ExecutionTarget[];
  stale?: boolean;
  source?: string;
  agentSlug: string | null;
  selectedAgentId: string | null;
  routeReasonCode: string | null;
  operations: ExecutionOperationRecord[];
  executionStage: ExecutionStageState | null;
}

export interface ExecutionEventPage {
  schemaVersion: 1 | 2;
  executionId?: string;
  runId: string;
  items: ExecutionEvent[];
  nextAfterSeq: number;
  hasMore: boolean;
  gaps?: Array<{ firstMissingSeq: number; lastMissingSeq: number }>;
}

export interface ExecutionTargetResolution {
  schemaVersion: 1 | 2;
  executionId?: string;
  kind: ExecutionTargetKind;
  id: string;
  eventId: string;
  name?: string;
  mediaType?: string;
  sizeBytes?: number;
  messageId?: number;
  artifactId?: string;
  deliveryUrl?: string;
  previewAvailable: boolean;
  event?: ExecutionEvent;
  todos: ExecutionTodoItem[];
  resolution?: string;
  trace?: ExecutionTraceResolution;
}

export type ExecutionTraceHealth = "healthy" | "degraded" | "unavailable";
export type ExecutionTraceItemKind =
  "phase" | "tool" | "reasoning_summary" | "decision";

export interface ExecutionTraceOperation extends Omit<
  ExecutionOperationRecord,
  "schemaVersion" | "workUnitId" | "target"
> {
  target: ExecutionTarget;
}

export interface ExecutionTraceFeedItem {
  schemaVersion: 1;
  itemId: string;
  seq: number;
  kind: ExecutionTraceItemKind;
  operationKey: string;
  labelKey: string;
  fallbackLabel: string;
  status:
    "pending" | "running" | "succeeded" | "failed" | "cancelled" | "timed_out";
  attempt: number;
  occurredAt: string;
  durationMs: number | null;
  progress: ExecutionOperationRecord["progress"];
  attempts: ExecutionOperationAttempt[];
  detail: ExecutionOperationRecord["detail"];
  summary: string | null;
  target: ExecutionTarget | null;
}

export interface ExecutionTraceResolution {
  schemaVersion: 1;
  target: ExecutionTarget;
  health: ExecutionTraceHealth;
  operation: ExecutionTraceOperation;
  lastSemanticActivityAt: string | null;
  lastProviderContactAt: string | null;
  items: ExecutionTraceFeedItem[];
  nextAfterSeq: number;
  hasMore: boolean;
}

export type DecodeResult<T> =
  { ok: true; value: T } | { ok: false; reason: string };

export type ExecutionDeliveryState =
  "idle" | "connected" | "reconnecting" | "gap" | "degraded" | "stale";

export interface ExecutionRunState {
  schemaVersion: 1 | 2;
  executionId: string;
  runId: string;
  botRunId: string | null;
  latestSeq: number;
  status: ExecutionStatus;
  phase: string | null;
  events: ExecutionEvent[];
  todos: ExecutionTodoItem[];
  todoDeclared: boolean;
  results: ExecutionResult[];
  inputRequired: {
    surfaceId: string;
    widget: string;
    actionRevision: number;
  } | null;
  terminal: ExecutionProjection["terminal"];
  delivery: ExecutionDeliveryState;
  startedAt: string | null;
  lastActivityAt: string | null;
  /** Last SSE frame/heartbeat received; transport liveness is not Agent work. */
  lastContactAt: string | null;
  spans: Record<string, ExecutionSpanState>;
  outputRevision: number;
  outputOffset: number;
  operationRevision: number;
  outputText: string;
  trackingHealth: string;
  targets: ExecutionTarget[];
  agentSlug: string | null;
  selectedAgentId: string | null;
  routeReasonCode: string | null;
  operations: ExecutionOperationRecord[];
  executionStage: ExecutionStageState | null;
}

export interface ExecutionWorkspaceTab {
  key: string;
  target: ExecutionTarget;
  title: string;
  localView?: "diagnostics";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function authenticatedTargetDeliveryURL(
  value: unknown,
  executionId: string,
  kind: ExecutionTargetKind,
  targetId: string
): string | null {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\u0000-\u001f\u007f?#]/.test(value)
  ) {
    return null;
  }
  const segments = value.split("/");
  if (
    segments.length !== 9 ||
    segments[1] !== "api" ||
    segments[2] !== "v1" ||
    segments[3] !== "executions" ||
    segments[5] !== "targets" ||
    segments[8] !== "content"
  ) {
    return null;
  }
  try {
    const decodedExecutionId = decodeURIComponent(segments[4]);
    const decodedKind = decodeURIComponent(segments[6]);
    const decodedTargetId = decodeURIComponent(segments[7]);
    if (
      [decodedExecutionId, decodedKind, decodedTargetId].some(
        (segment) => segment === "." || segment === ".."
      ) ||
      decodedExecutionId !== executionId ||
      decodedKind !== kind ||
      decodedTargetId !== targetId
    ) {
      return null;
    }
  } catch {
    return null;
  }
  return value;
}

function safeInteger(value: unknown, minimum = 0): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum
    ? value
    : null;
}

function containsForbiddenValue(value: unknown): boolean {
  if (typeof value === "string") {
    return (
      /https?:\/\//i.test(value) ||
      /\bbearer\s+[a-z0-9._~+/=-]+/i.test(value) ||
      /\b(password|passwd|api[_-]?key|secret|token)\s*[:=]/i.test(value) ||
      /\b[a-z]:[\\/]/i.test(value) ||
      /(^|[^a-z0-9._-])\/(?:[a-z0-9._-]+\/)+[a-z0-9._-]+/i.test(value)
    );
  }
  if (Array.isArray(value)) return value.some(containsForbiddenValue);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(
    ([key, child]) =>
      FORBIDDEN_KEYS.has(key.toLowerCase()) || containsForbiddenValue(child)
  );
}

type DurableMessageChunk = {
  revision: number;
  messageId: string;
  sourceMessageId: string;
  baseOffset: number;
  offset: number;
  totalLength: number;
  chunkIndex: number;
  chunkCount: number;
  digest: string;
  text: string;
};

const EXECUTION_CITATION_FIELDS = new Set([
  "title",
  "au",
  "ti",
  "so",
  "vl",
  "bp",
  "ep",
  "ar",
  "py",
  "di",
  "pm",
  "doi_missing",
]);

function validExecutionCitationReferences(value: unknown): boolean {
  if (!Array.isArray(value) || value.length > 64) return false;
  return value.every((reference) => {
    if (
      !isRecord(reference) ||
      Object.keys(reference).some((key) => !EXECUTION_CITATION_FIELDS.has(key))
    ) {
      return false;
    }
    return Object.entries(reference).every(([key, field]) =>
      key === "doi_missing"
        ? typeof field === "boolean"
        : typeof field === "string" &&
          field.length > 0 &&
          [...field].length <= 512
    );
  });
}

function decodeDurableMessageChunk(
  value: Readonly<Record<string, unknown>>
): DurableMessageChunk | null {
  const requiredFields = new Set([
    "output_revision",
    "message_id",
    "source_message_id",
    "base_offset",
    "offset",
    "total_length",
    "chunk_index",
    "chunk_count",
    "content_sha256",
    "text",
  ]);
  const allowedFields = new Set([...requiredFields, "references"]);
  if (
    Object.keys(value).length < requiredFields.size ||
    Object.keys(value).length > allowedFields.size ||
    [...requiredFields].some((key) => !(key in value)) ||
    Object.keys(value).some((key) => !allowedFields.has(key)) ||
    (value.references !== undefined &&
      !validExecutionCitationReferences(value.references))
  ) {
    return null;
  }
  const revision = safeInteger(value.output_revision);
  const messageId = stringValue(value.message_id);
  const sourceMessageId = stringValue(value.source_message_id);
  const baseOffset = safeInteger(value.base_offset);
  const offset = safeInteger(value.offset);
  const totalLength = safeInteger(value.total_length);
  const chunkIndex = safeInteger(value.chunk_index);
  const chunkCount = safeInteger(value.chunk_count, 1);
  const digest = stringValue(value.content_sha256);
  const text = typeof value.text === "string" ? value.text : null;
  const textLength = text === null ? -1 : [...text].length;
  if (
    revision === null ||
    !messageId ||
    !sourceMessageId ||
    baseOffset === null ||
    offset === null ||
    totalLength === null ||
    chunkIndex === null ||
    chunkCount === null ||
    !digest ||
    !/^[a-f0-9]{64}$/u.test(digest) ||
    text === null ||
    textLength > 8192 ||
    offset !== baseOffset + textLength ||
    offset > totalLength ||
    chunkIndex >= chunkCount
  ) {
    return null;
  }
  return {
    revision,
    messageId,
    sourceMessageId,
    baseOffset,
    offset,
    totalLength,
    chunkIndex,
    chunkCount,
    digest,
    text,
  };
}

function decodeTarget(
  value: unknown
): DecodeResult<ExecutionTarget | undefined> {
  if (value === undefined || value === null)
    return { ok: true, value: undefined };
  if (!isRecord(value)) return { ok: false, reason: "unknown_target_kind" };
  const kind = stringValue(value.kind);
  const id = stringValue(value.id);
  if (!kind || !id || !TARGET_KIND_SET.has(kind)) {
    return { ok: false, reason: "unknown_target_kind" };
  }
  if (kind === "trace" && !TRACE_TARGET_ID.test(id)) {
    return { ok: false, reason: "unknown_target_kind" };
  }
  return { ok: true, value: { kind: kind as ExecutionTargetKind, id } };
}

function decodeTodoItems(value: unknown): DecodeResult<ExecutionTodoItem[]> {
  if (!Array.isArray(value) || value.length > 100) {
    return { ok: false, reason: "invalid_todo" };
  }
  const items: ExecutionTodoItem[] = [];
  const ids = new Set<string>();
  for (const raw of value) {
    if (!isRecord(raw)) return { ok: false, reason: "invalid_todo" };
    const id = stringValue(raw.id);
    const labelKey = stringValue(raw.label_key);
    const status = stringValue(raw.status);
    if (
      !id ||
      !labelKey ||
      !status ||
      !TODO_STATUS_SET.has(status) ||
      ids.has(id)
    ) {
      return { ok: false, reason: "invalid_todo" };
    }
    ids.add(id);
    items.push({ id, labelKey, status: status as TodoStatus });
  }
  return { ok: true, value: items };
}

export function decodeExecutionEvent(
  value: unknown
): DecodeResult<ExecutionEvent> {
  if (!isRecord(value)) return { ok: false, reason: "invalid_event" };
  let byteLength = Number.POSITIVE_INFINITY;
  try {
    byteLength = new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return { ok: false, reason: "invalid_event" };
  }
  if (byteLength > 16_384)
    return { ok: false, reason: "event_payload_too_large" };

  if (value.schema_version === 2) {
    const eventId = stringValue(value.event_id);
    const executionId = stringValue(value.execution_id);
    const seq = safeInteger(value.seq, 1);
    const occurredAt = stringValue(value.occurred_at);
    const kind = stringValue(value.type);
    const status = stringValue(value.status);
    const source = stringValue(value.source);
    const spanId = stringValue(value.span_id);
    const attempt = safeInteger(value.attempt);
    if (
      !eventId ||
      !executionId ||
      seq === null ||
      !occurredAt ||
      !kind ||
      !status ||
      !EVENT_STATUS_SET.has(status) ||
      !source ||
      !spanId ||
      attempt === null ||
      Number.isNaN(Date.parse(occurredAt))
    ) {
      return { ok: false, reason: "invalid_event" };
    }
    const known = EVENT_KIND_SET.has(kind);
    if (!known) return { ok: false, reason: "unknown_required_kind" };
    if (!isRecord(value.summary))
      return { ok: false, reason: "invalid_event_summary" };
    const summaryKey = stringValue(value.summary.key);
    const summaryText = stringValue(value.summary.text);
    if (!summaryKey || !summaryText || [...summaryText].length > 512) {
      return { ok: false, reason: "invalid_event_summary" };
    }
    if (!isRecord(value.public_payload)) {
      return { ok: false, reason: "forbidden_public_payload" };
    }
    if (
      (kind === "message.snapshot" || kind === "message.completed") &&
      decodeDurableMessageChunk(value.public_payload) === null
    ) {
      return { ok: false, reason: "invalid_public_payload" };
    }
    if (containsForbiddenValue(value.public_payload)) {
      return { ok: false, reason: "forbidden_public_payload" };
    }
    const target = decodeTarget(value.target);
    if (!target.ok) return target;
    const parentSpanId =
      value.parent_span_id === null
        ? undefined
        : (stringValue(value.parent_span_id) ?? undefined);
    const workUnitId =
      value.work_unit_id === null
        ? undefined
        : (stringValue(value.work_unit_id) ?? undefined);
    if (
      value.parent_span_id !== null &&
      value.parent_span_id !== undefined &&
      !parentSpanId
    )
      return { ok: false, reason: "invalid_event" };
    if (
      value.work_unit_id !== null &&
      value.work_unit_id !== undefined &&
      !workUnitId
    )
      return { ok: false, reason: "invalid_event" };
    return {
      ok: true,
      value: {
        schemaVersion: 2,
        eventId,
        executionId,
        runId: executionId,
        seq,
        occurredAt,
        kind,
        known,
        ignorable: false,
        status: status as ExecutionStatus,
        summary: { key: summaryKey, text: summaryText },
        payload: value.public_payload,
        source,
        spanId,
        attempt,
        ...(parentSpanId ? { parentSpanId } : {}),
        ...(workUnitId ? { workUnitId } : {}),
        ...(target.value ? { target: target.value } : {}),
      },
    };
  }

  const eventId = stringValue(value.event_id);
  const runId = stringValue(value.run_id);
  const seq = safeInteger(value.seq, 1);
  const occurredAt = stringValue(value.occurred_at);
  const kind = stringValue(value.kind);
  const status = stringValue(value.status);
  const ignorable = value.ignorable === true;
  if (
    value.schema_version !== 1 ||
    !eventId ||
    !runId ||
    seq === null ||
    !occurredAt ||
    !kind ||
    !status ||
    !EVENT_STATUS_SET.has(status) ||
    Number.isNaN(Date.parse(occurredAt)) ||
    !occurredAt.endsWith("Z")
  ) {
    return { ok: false, reason: "invalid_event" };
  }
  const known = EVENT_KIND_SET.has(kind);
  if (!known && !ignorable)
    return { ok: false, reason: "unknown_required_kind" };

  if (!isRecord(value.summary))
    return { ok: false, reason: "invalid_event_summary" };
  const summaryKey = stringValue(value.summary.key);
  const summaryText = stringValue(value.summary.text);
  if (!summaryKey || !summaryText || [...summaryText].length > 512) {
    return { ok: false, reason: "invalid_event_summary" };
  }
  if (!isRecord(value.payload) || containsForbiddenValue(value.payload)) {
    return { ok: false, reason: "forbidden_public_payload" };
  }
  if (known) {
    const allowedFields = EVENT_PAYLOAD_FIELDS[kind];
    if (Object.keys(value.payload).some((key) => !allowedFields.has(key))) {
      return { ok: false, reason: "invalid_public_payload" };
    }
    if (kind === "todo.snapshot") {
      const todos = decodeTodoItems(value.payload.items);
      if (!todos.ok) return todos;
    }
  }
  const target = decodeTarget(value.target);
  if (!target.ok) return target;
  const taskId =
    value.task_id === undefined ? null : stringValue(value.task_id);
  const parentEventId =
    value.parent_event_id === undefined
      ? null
      : stringValue(value.parent_event_id);
  if (taskId === null && value.task_id !== undefined)
    return { ok: false, reason: "invalid_event" };
  if (parentEventId === null && value.parent_event_id !== undefined)
    return { ok: false, reason: "invalid_event" };

  return {
    ok: true,
    value: {
      schemaVersion: 1,
      eventId,
      executionId: runId,
      runId,
      seq,
      occurredAt,
      kind,
      known,
      ignorable,
      status: status as ExecutionStatus,
      summary: { key: summaryKey, text: summaryText },
      payload: value.payload,
      ...(target.value ? { target: target.value } : {}),
      ...(taskId ? { taskId } : {}),
      ...(parentEventId ? { parentEventId } : {}),
    },
  };
}

function decodeResult(value: unknown): DecodeResult<ExecutionResult> {
  if (!isRecord(value)) return { ok: false, reason: "invalid_projection" };
  const eventId = stringValue(value.event_id) ?? stringValue(value.id);
  const name = stringValue(value.name);
  const mediaType = stringValue(value.media_type);
  const sizeBytes = safeInteger(value.size_bytes);
  const target = decodeTarget(value.target);
  if (
    !eventId ||
    !name ||
    !mediaType ||
    sizeBytes === null ||
    !target.ok ||
    !target.value
  ) {
    return { ok: false, reason: "invalid_projection" };
  }
  return {
    ok: true,
    value: { eventId, name, mediaType, sizeBytes, target: target.value },
  };
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function decodeNullableTimestamp(value: unknown): string | null | undefined {
  if (value === null) return null;
  return validTimestamp(value) ? value : undefined;
}

function decodeOperationAttempt(
  value: unknown
): DecodeResult<ExecutionOperationAttempt> {
  if (!isRecord(value)) return { ok: false, reason: "invalid_operation" };
  const attempt = safeInteger(value.attempt, 1);
  const status = stringValue(value.status);
  const startedAt = validTimestamp(value.started_at) ? value.started_at : null;
  const completedAt = decodeNullableTimestamp(value.completed_at);
  const durationMs = safeInteger(value.duration_ms);
  if (
    attempt === null ||
    !status ||
    !OPERATION_ATTEMPT_STATUS_SET.has(
      status as ExecutionOperationAttemptStatus
    ) ||
    !startedAt ||
    completedAt === undefined ||
    durationMs === null
  ) {
    return { ok: false, reason: "invalid_operation" };
  }
  let failure: ExecutionOperationAttempt["failure"] = null;
  if (value.failure !== null) {
    if (!isRecord(value.failure))
      return { ok: false, reason: "invalid_operation" };
    const code = stringValue(value.failure.code);
    if (!code || typeof value.failure.retryable !== "boolean")
      return { ok: false, reason: "invalid_operation" };
    failure = { code, retryable: value.failure.retryable };
  }
  let retry: ExecutionOperationAttempt["retry"] = null;
  if (value.retry !== null) {
    if (!isRecord(value.retry))
      return { ok: false, reason: "invalid_operation" };
    const delayMs = safeInteger(value.retry.delay_ms);
    if (delayMs === null) return { ok: false, reason: "invalid_operation" };
    retry = { delayMs };
  }
  return {
    ok: true,
    value: {
      attempt,
      status: status as ExecutionOperationAttemptStatus,
      startedAt,
      completedAt,
      durationMs,
      failure,
      retry,
    },
  };
}

export function decodeExecutionOperation(
  value: unknown
): DecodeResult<ExecutionOperationRecord> {
  if (!isRecord(value) || value.schema_version !== 1)
    return { ok: false, reason: "invalid_operation" };
  const operationId = stringValue(value.operation_id);
  const workUnitId = stringValue(value.work_unit_id);
  const operationKey = stringValue(value.operation_key);
  const labelKey = stringValue(value.label_key);
  const fallbackLabel = stringValue(value.fallback_label);
  const status = stringValue(value.status);
  const startedAt = validTimestamp(value.started_at) ? value.started_at : null;
  const lastObservationAt = validTimestamp(value.last_observation_at)
    ? value.last_observation_at
    : null;
  const completedAt = decodeNullableTimestamp(value.completed_at);
  const durationMs = safeInteger(value.duration_ms);
  const currentAttempt = safeInteger(value.current_attempt, 1);
  if (
    !operationId ||
    !workUnitId ||
    !operationKey ||
    !labelKey ||
    !fallbackLabel ||
    !status ||
    !OPERATION_STATUS_SET.has(status as ExecutionOperationStatus) ||
    !startedAt ||
    !lastObservationAt ||
    completedAt === undefined ||
    durationMs === null ||
    currentAttempt === null ||
    !Array.isArray(value.attempts) ||
    value.attempts.length > 8
  ) {
    return { ok: false, reason: "invalid_operation" };
  }
  const attempts: ExecutionOperationAttempt[] = [];
  for (const raw of value.attempts) {
    const decoded = decodeOperationAttempt(raw);
    if (!decoded.ok) return decoded;
    attempts.push(decoded.value);
  }
  let progress: ExecutionOperationRecord["progress"] = null;
  if (value.progress !== null) {
    if (!isRecord(value.progress))
      return { ok: false, reason: "invalid_operation" };
    const completed = safeInteger(value.progress.completed);
    const total = safeInteger(value.progress.total, 1);
    const unit = stringValue(value.progress.unit);
    if (completed === null || total === null || completed > total || !unit)
      return { ok: false, reason: "invalid_operation" };
    progress = { completed, total, unit };
  }
  if (!isRecord(value.detail) || Object.keys(value.detail).length > 16)
    return { ok: false, reason: "invalid_operation" };
  const detail: ExecutionOperationRecord["detail"] = {};
  for (const [key, field] of Object.entries(value.detail)) {
    if (
      !key ||
      !["number", "boolean", "string"].includes(typeof field) ||
      (typeof field === "number" && !Number.isSafeInteger(field)) ||
      containsForbiddenValue(field)
    ) {
      return { ok: false, reason: "invalid_operation" };
    }
    detail[key] = field as number | boolean | string;
  }
  let summary: ExecutionOperationRecord["summary"] = null;
  if (value.summary !== null) {
    if (!isRecord(value.summary))
      return { ok: false, reason: "invalid_operation" };
    const kind = stringValue(value.summary.kind);
    const text = stringValue(value.summary.text);
    if (
      !kind ||
      !["operation", "decision", "reasoning"].includes(kind) ||
      !text ||
      [...text].length > 512 ||
      containsForbiddenValue(text)
    ) {
      return { ok: false, reason: "invalid_operation" };
    }
    summary = {
      kind: kind as "operation" | "decision" | "reasoning",
      text,
    };
  }
  const target = decodeTarget(value.target);
  if (!target.ok) return { ok: false, reason: "invalid_operation" };
  return {
    ok: true,
    value: {
      schemaVersion: 1,
      operationId,
      workUnitId,
      operationKey,
      labelKey,
      fallbackLabel,
      status: status as ExecutionOperationStatus,
      startedAt,
      lastObservationAt,
      completedAt,
      durationMs,
      currentAttempt,
      attempts,
      progress,
      detail,
      summary,
      target: target.value ?? null,
    },
  };
}

function decodeExecutionStage(
  value: unknown
): DecodeResult<ExecutionStageState | null> {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (
    !isRecord(value) ||
    !isRecord(value.clocks) ||
    !Array.isArray(value.todos)
  )
    return { ok: false, reason: "invalid_execution_stage" };
  const stage = stringValue(value.stage);
  const childStatus =
    value.child_status === null ? null : stringValue(value.child_status);
  const rootStatus = stringValue(value.root_status);
  const pendingStatusKey =
    value.pending_status_key === null
      ? null
      : stringValue(value.pending_status_key);
  const terminalStatuses = [
    "succeeded",
    "partial",
    "failed",
    "cancelled",
    "timed_out",
  ];
  const validChild =
    childStatus === null ||
    childStatus === "running" ||
    terminalStatuses.includes(childStatus);
  if (
    !stage ||
    !EXECUTION_STAGE_SET.has(stage as ExecutionStageName) ||
    !validChild ||
    !rootStatus ||
    !(rootStatus === "running" || terminalStatuses.includes(rootStatus)) ||
    typeof value.answer_available !== "boolean" ||
    (value.pending_status_key !== null && !pendingStatusKey) ||
    value.todos.length !== EXECUTION_STAGE_TODO_IDS.length
  ) {
    return { ok: false, reason: "invalid_execution_stage" };
  }
  const todos: ExecutionStageState["todos"] = [];
  for (const [index, raw] of value.todos.entries()) {
    if (!isRecord(raw)) return { ok: false, reason: "invalid_execution_stage" };
    const id = stringValue(raw.id);
    const status = stringValue(raw.status);
    if (
      id !== EXECUTION_STAGE_TODO_IDS[index] ||
      !status ||
      !TODO_STATUS_SET.has(status)
    ) {
      return { ok: false, reason: "invalid_execution_stage" };
    }
    todos.push({
      id: id as ExecutionStageState["todos"][number]["id"],
      status: status as TodoStatus,
    });
  }
  const lastExecutionFactAt = decodeNullableTimestamp(
    value.clocks.last_execution_fact_at
  );
  const lastProviderContactAt = decodeNullableTimestamp(
    value.clocks.last_provider_contact_at
  );
  const lastStreamContactAt = decodeNullableTimestamp(
    value.clocks.last_stream_contact_at
  );
  if (
    lastExecutionFactAt === undefined ||
    lastProviderContactAt === undefined ||
    lastStreamContactAt === undefined
  ) {
    return { ok: false, reason: "invalid_execution_stage" };
  }
  const typedStage = stage as ExecutionStageName;
  const typedRootStatus = rootStatus as ExecutionStageState["rootStatus"];
  const expectedTodos = stageTodos(typedStage, typedRootStatus);
  const expectedPending =
    typedRootStatus === "running"
      ? {
          orchestration: "execution.pending.submitted",
          scientific_execution: "execution.pending.running",
          consolidation: "execution.pending.consolidating",
          response_settlement: "execution.pending.settling",
        }[typedStage]
      : null;
  if (
    todos.some((todo, index) => todo.status !== expectedTodos[index]?.status) ||
    pendingStatusKey !== expectedPending ||
    (["succeeded", "partial"].includes(typedRootStatus) &&
      (typedStage !== "response_settlement" || value.answer_available !== true))
  ) {
    return { ok: false, reason: "invalid_execution_stage" };
  }
  return {
    ok: true,
    value: {
      stage: typedStage,
      childStatus: childStatus as ExecutionStageState["childStatus"],
      rootStatus: typedRootStatus,
      answerAvailable: value.answer_available,
      todos,
      pendingStatusKey,
      clocks: {
        lastExecutionFactAt,
        lastProviderContactAt,
        lastStreamContactAt,
      },
    },
  };
}

export function decodeExecutionProjection(
  value: unknown
): DecodeResult<ExecutionProjection> {
  if (!isRecord(value)) return { ok: false, reason: "invalid_projection" };
  if (value.schema_version === 2) {
    const executionId = stringValue(value.execution_id);
    const latestSeq = safeInteger(value.latest_seq);
    const status = stringValue(value.status);
    const outputRevision = safeInteger(value.output_revision);
    const outputOffset = safeInteger(value.output_offset);
    const trackingHealth = stringValue(value.tracking_health);
    const operationRevision = safeInteger(value.operation_revision);
    const agentSlug =
      value.agent_slug === undefined ||
      value.agent_slug === null ||
      value.agent_slug === ""
        ? null
        : stringValue(value.agent_slug);
    if (
      !executionId ||
      latestSeq === null ||
      !status ||
      !EVENT_STATUS_SET.has(status) ||
      outputRevision === null ||
      outputOffset === null ||
      !trackingHealth ||
      operationRevision === null ||
      (value.agent_slug !== undefined &&
        value.agent_slug !== null &&
        value.agent_slug !== "" &&
        agentSlug === null)
    ) {
      return { ok: false, reason: "invalid_projection" };
    }
    const todos = decodeTodoItems(value.todos ?? []);
    if (!todos.ok || !Array.isArray(value.results))
      return { ok: false, reason: "invalid_projection" };
    const rawOperations = value.operations ?? [];
    if (!Array.isArray(rawOperations) || rawOperations.length > 256)
      return { ok: false, reason: "invalid_projection" };
    const operations: ExecutionOperationRecord[] = [];
    for (const raw of rawOperations) {
      if (
        isRecord(raw) &&
        safeInteger(raw.schema_version, 1) !== null &&
        raw.schema_version !== 1
      ) {
        continue;
      }
      const decoded = decodeExecutionOperation(raw);
      if (!decoded.ok) return { ok: false, reason: "invalid_projection" };
      operations.push(decoded.value);
    }
    const executionStage = decodeExecutionStage(value.execution_stage);
    if (!executionStage.ok) return { ok: false, reason: "invalid_projection" };
    const results: ExecutionResult[] = [];
    for (const raw of value.results) {
      const decoded = decodeResult(raw);
      if (!decoded.ok) return decoded;
      results.push(decoded.value);
    }
    const targets: ExecutionTarget[] = [];
    if (!Array.isArray(value.targets))
      return { ok: false, reason: "invalid_projection" };
    for (const raw of value.targets) {
      const decoded = decodeTarget(raw);
      if (!decoded.ok || !decoded.value)
        return { ok: false, reason: "invalid_projection" };
      targets.push(decoded.value);
    }
    let terminal: ExecutionProjection["terminal"] = null;
    if (value.terminal !== null && value.terminal !== undefined) {
      if (!isRecord(value.terminal))
        return { ok: false, reason: "invalid_projection" };
      const terminalStatus = stringValue(value.terminal.status);
      const eventId = stringValue(value.terminal.event_id);
      if (
        !terminalStatus ||
        !eventId ||
        !["succeeded", "partial", "failed", "cancelled", "timed_out"].includes(
          terminalStatus
        )
      ) {
        return { ok: false, reason: "invalid_projection" };
      }
      terminal = {
        status: terminalStatus as
          "succeeded" | "partial" | "failed" | "cancelled" | "timed_out",
        eventId,
      };
    }
    const activeSpanIds =
      Array.isArray(value.active_span_ids) &&
      value.active_span_ids.every((item) => typeof item === "string")
        ? ([...value.active_span_ids] as string[])
        : [];
    let inputRequired: ExecutionProjection["inputRequired"] = null;
    if (value.input_required !== null && value.input_required !== undefined) {
      if (!isRecord(value.input_required))
        return { ok: false, reason: "invalid_projection" };
      const surfaceId = stringValue(value.input_required.surface_id);
      const widget = stringValue(value.input_required.widget);
      const actionRevision = safeInteger(value.input_required.action_revision);
      if (!surfaceId || !widget || actionRevision === null)
        return { ok: false, reason: "invalid_projection" };
      inputRequired = { surfaceId, widget, actionRevision };
    }
    let selectedAgentId: string | null = null;
    let routeReasonCode: string | null = null;
    if (value.context_stage !== null && value.context_stage !== undefined) {
      if (!isRecord(value.context_stage)) {
        return { ok: false, reason: "invalid_projection" };
      }
      const context = value.context_stage;
      const turnId = stringValue(context.turn_id);
      selectedAgentId = stringValue(context.selected_agent_id);
      const routeSource = stringValue(context.route_source);
      routeReasonCode = stringValue(context.route_reason_code);
      if (
        context.schema_version !== 1 ||
        !turnId ||
        !selectedAgentId ||
        !routeSource ||
        !routeReasonCode ||
        safeInteger(context.base_business_context_version) === null ||
        safeInteger(context.proposed_business_context_version) === null ||
        safeInteger(context.last_applied_ledger_cursor) === null ||
        typeof context.context_truncated !== "boolean" ||
        typeof context.context_rebuilt !== "boolean"
      ) {
        return { ok: false, reason: "invalid_projection" };
      }
    }
    return {
      ok: true,
      value: {
        schemaVersion: 2,
        executionId,
        runId: executionId,
        latestSeq,
        status: status as ExecutionStatus,
        phase: null,
        todos: todos.value,
        results,
        inputRequired,
        terminal,
        outputRevision,
        outputOffset,
        operationRevision,
        trackingHealth,
        activeSpanIds,
        todoDeclared: value.todo_declared === true,
        targets,
        stale: value.stale === true,
        source: stringValue(value.source) ?? undefined,
        agentSlug,
        selectedAgentId,
        routeReasonCode,
        operations,
        executionStage: executionStage.value,
      },
    };
  }
  const runId = stringValue(value.run_id);
  const latestSeq = safeInteger(value.latest_seq);
  const status = stringValue(value.status);
  const phase = value.phase === null ? null : stringValue(value.phase);
  if (
    value.schema_version !== 1 ||
    !runId ||
    latestSeq === null ||
    !status ||
    !EVENT_STATUS_SET.has(status) ||
    (value.phase !== null && phase === null)
  ) {
    return { ok: false, reason: "invalid_projection" };
  }
  const todos = decodeTodoItems(value.todos);
  if (!todos.ok) return { ok: false, reason: "invalid_projection" };
  if (!Array.isArray(value.results))
    return { ok: false, reason: "invalid_projection" };
  const results: ExecutionResult[] = [];
  for (const raw of value.results) {
    const decoded = decodeResult(raw);
    if (!decoded.ok) return decoded;
    results.push(decoded.value);
  }

  let inputRequired: ExecutionProjection["inputRequired"] = null;
  if (value.input_required !== null) {
    if (!isRecord(value.input_required))
      return { ok: false, reason: "invalid_projection" };
    const surfaceId = stringValue(value.input_required.surface_id);
    const widget = stringValue(value.input_required.widget);
    if (!surfaceId || !widget)
      return { ok: false, reason: "invalid_projection" };
    inputRequired = { surfaceId, widget, actionRevision: 0 };
  }
  let terminal: ExecutionProjection["terminal"] = null;
  if (value.terminal !== null) {
    if (!isRecord(value.terminal))
      return { ok: false, reason: "invalid_projection" };
    const terminalStatus = stringValue(value.terminal.status);
    const eventId = stringValue(value.terminal.event_id);
    if (
      !terminalStatus ||
      !eventId ||
      !["succeeded", "failed", "cancelled"].includes(terminalStatus)
    ) {
      return { ok: false, reason: "invalid_projection" };
    }
    terminal = {
      status: terminalStatus as "succeeded" | "failed" | "cancelled",
      eventId,
    };
  }
  return {
    ok: true,
    value: {
      schemaVersion: 1,
      executionId: runId,
      runId,
      latestSeq,
      status: status as ExecutionStatus,
      phase,
      todos: todos.value,
      results,
      inputRequired,
      terminal,
      agentSlug: null,
      selectedAgentId: null,
      routeReasonCode: null,
      operations: [],
      executionStage: null,
    },
  };
}

export function decodeExecutionEventPage(
  value: unknown
): DecodeResult<ExecutionEventPage> {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    return { ok: false, reason: "invalid_page" };
  }
  if (value.schema_version === 2) {
    const executionId = stringValue(value.execution_id);
    const nextAfterSeq = safeInteger(value.next_after_seq);
    if (
      !executionId ||
      nextAfterSeq === null ||
      typeof value.has_more !== "boolean" ||
      value.items.length > 200
    ) {
      return { ok: false, reason: "invalid_page" };
    }
    const items: ExecutionEvent[] = [];
    let previous = 0;
    for (const raw of value.items) {
      const decoded = decodeExecutionEvent(raw);
      if (
        !decoded.ok ||
        decoded.value.executionId !== executionId ||
        decoded.value.seq <= previous
      )
        return { ok: false, reason: "invalid_page" };
      previous = decoded.value.seq;
      items.push(decoded.value);
    }
    const gaps: Array<{ firstMissingSeq: number; lastMissingSeq: number }> = [];
    if (value.gaps !== undefined) {
      if (!Array.isArray(value.gaps))
        return { ok: false, reason: "invalid_page" };
      for (const raw of value.gaps) {
        if (!isRecord(raw)) return { ok: false, reason: "invalid_page" };
        const firstMissingSeq = safeInteger(raw.first_missing_seq, 1);
        const lastMissingSeq = safeInteger(raw.last_missing_seq, 1);
        if (
          firstMissingSeq === null ||
          lastMissingSeq === null ||
          lastMissingSeq < firstMissingSeq
        )
          return { ok: false, reason: "invalid_page" };
        gaps.push({ firstMissingSeq, lastMissingSeq });
      }
    }
    return {
      ok: true,
      value: {
        schemaVersion: 2,
        executionId,
        runId: executionId,
        items,
        nextAfterSeq,
        hasMore: value.has_more,
        gaps,
      },
    };
  }
  const runId = stringValue(value.run_id);
  const nextAfterSeq = safeInteger(value.next_after_seq);
  if (
    value.schema_version !== 1 ||
    !runId ||
    nextAfterSeq === null ||
    typeof value.has_more !== "boolean" ||
    value.items.length > 200
  ) {
    return { ok: false, reason: "invalid_page" };
  }
  const items: ExecutionEvent[] = [];
  let previous = 0;
  for (const raw of value.items) {
    const decoded = decodeExecutionEvent(raw);
    if (
      !decoded.ok ||
      decoded.value.runId !== runId ||
      decoded.value.seq <= previous
    ) {
      return { ok: false, reason: "invalid_page" };
    }
    previous = decoded.value.seq;
    items.push(decoded.value);
  }
  if (
    (items.length > 0 && nextAfterSeq !== previous) ||
    (items.length === 0 && nextAfterSeq < 0)
  ) {
    return { ok: false, reason: "invalid_page" };
  }
  return {
    ok: true,
    value: {
      schemaVersion: 1,
      runId,
      items,
      nextAfterSeq,
      hasMore: value.has_more,
    },
  };
}

const TRACE_ITEM_KINDS = new Set<ExecutionTraceItemKind>([
  "phase",
  "tool",
  "reasoning_summary",
  "decision",
]);
const TRACE_ITEM_STATUSES = new Set([
  "pending",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
]);

function decodeTraceProgress(
  value: unknown
): DecodeResult<ExecutionOperationRecord["progress"]> {
  if (value === null) return { ok: true, value: null };
  if (!isRecord(value)) return { ok: false, reason: "invalid_trace" };
  const completed = safeInteger(value.completed);
  const total = safeInteger(value.total, 1);
  const unit = stringValue(value.unit);
  if (
    Object.keys(value).some(
      (key) => !["completed", "total", "unit"].includes(key)
    ) ||
    completed === null ||
    total === null ||
    completed > total ||
    total > 1_000_000 ||
    !unit
  ) {
    return { ok: false, reason: "invalid_trace" };
  }
  return { ok: true, value: { completed, total, unit } };
}

function decodeTraceDetail(
  value: unknown
): DecodeResult<ExecutionOperationRecord["detail"]> {
  if (
    !isRecord(value) ||
    Object.keys(value).length > 16 ||
    containsForbiddenValue(value)
  ) {
    return { ok: false, reason: "invalid_trace" };
  }
  const detail: ExecutionOperationRecord["detail"] = {};
  for (const [key, field] of Object.entries(value)) {
    if (
      !key ||
      !["number", "boolean", "string"].includes(typeof field) ||
      (typeof field === "number" &&
        (!Number.isSafeInteger(field) || field < 0 || field > 1_000_000)) ||
      (typeof field === "string" && [...field].length > 128)
    ) {
      return { ok: false, reason: "invalid_trace" };
    }
    detail[key] = field as number | boolean | string;
  }
  return { ok: true, value: detail };
}

function decodeTraceAttempts(
  value: unknown
): DecodeResult<ExecutionOperationAttempt[]> {
  if (!Array.isArray(value) || value.length > 8) {
    return { ok: false, reason: "invalid_trace" };
  }
  const attempts: ExecutionOperationAttempt[] = [];
  const allowed = new Set([
    "attempt",
    "status",
    "started_at",
    "completed_at",
    "duration_ms",
    "failure",
    "retry",
  ]);
  for (const raw of value) {
    if (!isRecord(raw) || Object.keys(raw).some((key) => !allowed.has(key))) {
      return { ok: false, reason: "invalid_trace" };
    }
    const decoded = decodeOperationAttempt(raw);
    if (!decoded.ok) return { ok: false, reason: "invalid_trace" };
    attempts.push(decoded.value);
  }
  return { ok: true, value: attempts };
}

function decodeTraceOperation(
  value: unknown,
  target: ExecutionTarget
): DecodeResult<ExecutionTraceOperation> {
  const allowed = new Set([
    "operation_id",
    "operation_key",
    "label_key",
    "fallback_label",
    "status",
    "started_at",
    "last_observation_at",
    "completed_at",
    "duration_ms",
    "current_attempt",
    "attempts",
    "progress",
    "detail",
    "summary",
    "target",
  ]);
  if (!isRecord(value) || Object.keys(value).some((key) => !allowed.has(key))) {
    return { ok: false, reason: "invalid_trace" };
  }
  const decoded = decodeExecutionOperation({
    ...value,
    schema_version: 1,
    work_unit_id: "trace-redacted",
  });
  if (
    !decoded.ok ||
    decoded.value.operationKey !== "remote.analysis" ||
    decoded.value.target?.kind !== target.kind ||
    decoded.value.target.id !== target.id
  ) {
    return { ok: false, reason: "invalid_trace" };
  }
  return {
    ok: true,
    value: {
      operationId: decoded.value.operationId,
      operationKey: decoded.value.operationKey,
      labelKey: decoded.value.labelKey,
      fallbackLabel: decoded.value.fallbackLabel,
      status: decoded.value.status,
      startedAt: decoded.value.startedAt,
      lastObservationAt: decoded.value.lastObservationAt,
      completedAt: decoded.value.completedAt,
      durationMs: decoded.value.durationMs,
      currentAttempt: decoded.value.currentAttempt,
      attempts: decoded.value.attempts,
      progress: decoded.value.progress,
      detail: decoded.value.detail,
      summary: decoded.value.summary,
      target,
    },
  };
}

function decodeTraceItem(value: unknown): DecodeResult<ExecutionTraceFeedItem> {
  const allowed = new Set([
    "schema_version",
    "item_id",
    "seq",
    "kind",
    "operation_key",
    "label_key",
    "fallback_label",
    "status",
    "attempt",
    "occurred_at",
    "duration_ms",
    "progress",
    "attempts",
    "detail",
    "summary",
    "target",
  ]);
  if (
    !isRecord(value) ||
    value.schema_version !== 1 ||
    Object.keys(value).some((key) => !allowed.has(key))
  ) {
    return { ok: false, reason: "invalid_trace" };
  }
  const itemId = stringValue(value.item_id);
  const seq = safeInteger(value.seq, 1);
  const kind = stringValue(value.kind);
  const operationKey = stringValue(value.operation_key);
  const labelKey = stringValue(value.label_key);
  const fallbackLabel = stringValue(value.fallback_label);
  const status = stringValue(value.status);
  const attempt = safeInteger(value.attempt, 1);
  const occurredAt = validTimestamp(value.occurred_at)
    ? value.occurred_at
    : null;
  const durationMs =
    value.duration_ms === null ? null : safeInteger(value.duration_ms);
  const progress = decodeTraceProgress(value.progress);
  const attempts = decodeTraceAttempts(value.attempts);
  const detail = decodeTraceDetail(value.detail);
  const target = decodeTarget(value.target);
  const summary = value.summary === null ? null : stringValue(value.summary);
  if (
    !itemId ||
    seq === null ||
    !kind ||
    !TRACE_ITEM_KINDS.has(kind as ExecutionTraceItemKind) ||
    !operationKey ||
    !labelKey ||
    !fallbackLabel ||
    !status ||
    !TRACE_ITEM_STATUSES.has(status) ||
    attempt === null ||
    attempt > 20 ||
    !occurredAt ||
    (durationMs === null && value.duration_ms !== null) ||
    !progress.ok ||
    !attempts.ok ||
    !detail.ok ||
    !target.ok ||
    (summary !== null &&
      ([...summary].length > 512 || containsForbiddenValue(summary)))
  ) {
    return { ok: false, reason: "invalid_trace" };
  }
  return {
    ok: true,
    value: {
      schemaVersion: 1,
      itemId,
      seq,
      kind: kind as ExecutionTraceItemKind,
      operationKey,
      labelKey,
      fallbackLabel,
      status: status as ExecutionTraceFeedItem["status"],
      attempt,
      occurredAt,
      durationMs,
      progress: progress.value,
      attempts: attempts.value,
      detail: detail.value,
      summary,
      target: target.value ?? null,
    },
  };
}

export function decodeExecutionTraceResolution(
  value: unknown
): DecodeResult<ExecutionTraceResolution> {
  const allowed = new Set([
    "schema_version",
    "target",
    "health",
    "operation",
    "last_semantic_activity_at",
    "last_provider_contact_at",
    "items",
    "next_after_seq",
    "has_more",
  ]);
  if (
    !isRecord(value) ||
    value.schema_version !== 1 ||
    Object.keys(value).some((key) => !allowed.has(key)) ||
    containsForbiddenValue(value)
  ) {
    return { ok: false, reason: "invalid_trace" };
  }
  const target = decodeTarget(value.target);
  const health = stringValue(value.health);
  const semanticAt = decodeNullableTimestamp(value.last_semantic_activity_at);
  const providerAt = decodeNullableTimestamp(value.last_provider_contact_at);
  const nextAfterSeq = safeInteger(value.next_after_seq);
  if (
    !target.ok ||
    target.value?.kind !== "trace" ||
    !health ||
    !["healthy", "degraded", "unavailable"].includes(health) ||
    semanticAt === undefined ||
    providerAt === undefined ||
    nextAfterSeq === null ||
    typeof value.has_more !== "boolean" ||
    !Array.isArray(value.items) ||
    value.items.length > 100
  ) {
    return { ok: false, reason: "invalid_trace" };
  }
  const operation = decodeTraceOperation(value.operation, target.value);
  if (!operation.ok) return operation;
  const items: ExecutionTraceFeedItem[] = [];
  let previous = 0;
  for (const raw of value.items) {
    const item = decodeTraceItem(raw);
    if (!item.ok || item.value.seq <= previous) {
      return { ok: false, reason: "invalid_trace" };
    }
    previous = item.value.seq;
    items.push(item.value);
  }
  if (items.length > 0 && nextAfterSeq !== previous) {
    return { ok: false, reason: "invalid_trace" };
  }
  return {
    ok: true,
    value: {
      schemaVersion: 1,
      target: target.value,
      health: health as ExecutionTraceHealth,
      operation: operation.value,
      lastSemanticActivityAt: semanticAt,
      lastProviderContactAt: providerAt,
      items,
      nextAfterSeq,
      hasMore: value.has_more,
    },
  };
}

export function mergeExecutionTracePage(
  current: ExecutionTraceResolution,
  incoming: ExecutionTraceResolution
): DecodeResult<ExecutionTraceResolution> {
  if (
    current.schemaVersion !== 1 ||
    incoming.schemaVersion !== 1 ||
    current.target.kind !== incoming.target.kind ||
    current.target.id !== incoming.target.id ||
    incoming.nextAfterSeq < current.nextAfterSeq
  ) {
    return { ok: false, reason: "invalid_trace_replay" };
  }
  const itemsBySeq = new Map<number, ExecutionTraceFeedItem>();
  for (const item of current.items) itemsBySeq.set(item.seq, item);
  for (const item of incoming.items) {
    const existing = itemsBySeq.get(item.seq);
    if (existing && JSON.stringify(existing) !== JSON.stringify(item)) {
      return { ok: false, reason: "invalid_trace_replay" };
    }
    itemsBySeq.set(item.seq, item);
  }
  const items = [...itemsBySeq.values()].sort(
    (left, right) => left.seq - right.seq
  );
  if (items.length > 1_000) {
    return { ok: false, reason: "invalid_trace_replay" };
  }
  return {
    ok: true,
    value: {
      ...incoming,
      items,
    },
  };
}

export function decodeExecutionTargetResolution(
  value: unknown
): DecodeResult<ExecutionTargetResolution> {
  if (
    isRecord(value) &&
    value.schema_version === 1 &&
    isRecord(value.target) &&
    value.target.kind === "trace"
  ) {
    const trace = decodeExecutionTraceResolution(value);
    if (!trace.ok) return { ok: false, reason: "invalid_target_resolution" };
    return {
      ok: true,
      value: {
        schemaVersion: 1,
        kind: "trace",
        id: trace.value.target.id,
        eventId: trace.value.target.id,
        previewAvailable: false,
        todos: [],
        resolution: "authorized",
        trace: trace.value,
      },
    };
  }
  if (isRecord(value) && value.schema_version === 2) {
    const allowedFields = new Set([
      "schema_version",
      "execution_id",
      "target",
      "resolution",
      "message_id",
      "artifact_id",
      "name",
      "media_type",
      "size_bytes",
      "preview_available",
      "delivery_url",
    ]);
    if (Object.keys(value).some((key) => !allowedFields.has(key))) {
      return { ok: false, reason: "invalid_target_resolution" };
    }
    const executionId = stringValue(value.execution_id);
    const target = decodeTarget(value.target);
    const resolution = stringValue(value.resolution);
    if (
      !executionId ||
      !target.ok ||
      !target.value ||
      !resolution ||
      typeof value.preview_available !== "boolean"
    ) {
      return { ok: false, reason: "invalid_target_resolution" };
    }
    const messageId =
      value.message_id === undefined
        ? undefined
        : safeInteger(value.message_id, 1);
    if (messageId === null) {
      return { ok: false, reason: "invalid_target_resolution" };
    }
    const artifactId = stringValue(value.artifact_id) ?? undefined;
    const name = stringValue(value.name) ?? undefined;
    const mediaType = stringValue(value.media_type) ?? undefined;
    const sizeBytes =
      value.size_bytes === undefined
        ? undefined
        : safeInteger(value.size_bytes, 0);
    if (sizeBytes === null) {
      return { ok: false, reason: "invalid_target_resolution" };
    }
    const deliveryUrl =
      value.delivery_url === undefined
        ? undefined
        : authenticatedTargetDeliveryURL(
            value.delivery_url,
            executionId,
            target.value.kind,
            target.value.id
          );
    if (
      (value.delivery_url !== undefined && !deliveryUrl) ||
      (deliveryUrl && value.preview_available !== true)
    ) {
      return { ok: false, reason: "invalid_target_resolution" };
    }
    return {
      ok: true,
      value: {
        schemaVersion: 2,
        executionId,
        kind: target.value.kind,
        id: target.value.id,
        eventId: target.value.id,
        previewAvailable: value.preview_available,
        todos: [],
        resolution,
        ...(messageId ? { messageId } : {}),
        ...(artifactId ? { artifactId } : {}),
        ...(deliveryUrl ? { deliveryUrl } : {}),
        ...(name ? { name } : {}),
        ...(mediaType ? { mediaType } : {}),
        ...(sizeBytes !== undefined ? { sizeBytes } : {}),
      },
    };
  }
  const allowedFields = new Set([
    "schema_version",
    "kind",
    "id",
    "event_id",
    "name",
    "media_type",
    "size_bytes",
    "message_id",
    "artifact_id",
    "preview_available",
    "event",
    "todos",
  ]);
  if (
    !isRecord(value) ||
    value.schema_version !== 1 ||
    Object.keys(value).some((key) => !allowedFields.has(key)) ||
    containsForbiddenValue(value)
  ) {
    return { ok: false, reason: "invalid_target_resolution" };
  }
  const kind = stringValue(value.kind);
  const id = stringValue(value.id);
  const eventId = stringValue(value.event_id);
  if (
    !kind ||
    !TARGET_KIND_SET.has(kind) ||
    !id ||
    !eventId ||
    typeof value.preview_available !== "boolean"
  ) {
    return { ok: false, reason: "invalid_target_resolution" };
  }
  const optionalStrings = ["name", "media_type", "artifact_id"] as const;
  for (const field of optionalStrings) {
    if (value[field] !== undefined && !stringValue(value[field])) {
      return { ok: false, reason: "invalid_target_resolution" };
    }
  }
  const messageId =
    value.message_id === undefined
      ? undefined
      : safeInteger(value.message_id, 1);
  const sizeBytes =
    value.size_bytes === undefined ? undefined : safeInteger(value.size_bytes);
  if (messageId === null || sizeBytes === null) {
    return { ok: false, reason: "invalid_target_resolution" };
  }
  let event: ExecutionEvent | undefined;
  if (value.event !== undefined) {
    const decoded = decodeExecutionEvent(value.event);
    if (!decoded.ok) return decoded;
    event = decoded.value;
  }
  const todos =
    value.todos === undefined
      ? { ok: true as const, value: [] }
      : decodeTodoItems(value.todos);
  if (!todos.ok) return { ok: false, reason: "invalid_target_resolution" };
  const name = stringValue(value.name);
  const mediaType = stringValue(value.media_type);
  const artifactId = stringValue(value.artifact_id);
  return {
    ok: true,
    value: {
      schemaVersion: 1,
      kind: kind as ExecutionTargetKind,
      id,
      eventId,
      previewAvailable: value.preview_available,
      todos: todos.value,
      ...(name ? { name } : {}),
      ...(mediaType ? { mediaType } : {}),
      ...(sizeBytes !== undefined ? { sizeBytes } : {}),
      ...(messageId !== undefined ? { messageId } : {}),
      ...(artifactId ? { artifactId } : {}),
      ...(event ? { event } : {}),
    },
  };
}

export function executionEventFromAGUI(
  ev: AguiEvent
): DecodeResult<ExecutionEvent> | null {
  if (
    ev.type !== "Custom" ||
    ev.data.name !== "phyto.run_event" ||
    !isRecord(ev.data.value)
  ) {
    return null;
  }
  return decodeExecutionEvent(ev.data.value.event);
}

export function createExecutionRunState(
  runId: string,
  schemaVersion: 1 | 2 = 1
): ExecutionRunState {
  return {
    schemaVersion,
    executionId: runId,
    runId,
    botRunId: null,
    latestSeq: 0,
    status: "admitted",
    phase: null,
    events: [],
    todos: [],
    todoDeclared: false,
    results: [],
    inputRequired: null,
    terminal: null,
    delivery: "idle",
    startedAt: null,
    lastActivityAt: null,
    lastContactAt: null,
    spans: {},
    outputRevision: 0,
    outputOffset: 0,
    operationRevision: 0,
    outputText: "",
    trackingHealth: "pending",
    targets: [],
    agentSlug: null,
    selectedAgentId: null,
    routeReasonCode: null,
    operations: [],
    executionStage: null,
  };
}

function executionStatusAfterEvent(
  current: ExecutionStatus,
  event: ExecutionEvent
): ExecutionStatus {
  switch (event.kind) {
    case "execution.admitted":
      return "admitted";
    case "execution.queued":
      return "queued";
    case "execution.dispatching":
      return "dispatching";
    case "execution.started":
    case "execution.resumed":
    case "input.resolved":
      return "running";
    case "execution.waiting_input":
    case "input.required":
      return "waiting_input";
    case "execution.cancellation_requested":
      return "cancellation_requested";
    case "execution.succeeded":
    case "execution.partial":
    case "execution.failed":
    case "execution.cancelled":
    case "execution.timed_out":
    case "run.started":
    case "run.accepted":
    case "run.waiting_input":
    case "run.resumed":
    case "run.succeeded":
    case "run.failed":
    case "run.cancelled":
      return event.status;
    default:
      return current;
  }
}

export type OperationGroupingPolicy =
  | {
      policy: "group_siblings";
      unit: string;
      identity: "operation_key" | "parent_span";
      preserveBranches?: boolean;
    }
  | {
      policy: "attach_to_parent";
      parentOperationKey: string;
    };

type OperationPresenter = {
  labelKey: string;
  fallbackLabel: string;
  detailFields: ReadonlySet<string>;
  counterUnits: readonly string[];
  grouping?: OperationGroupingPolicy;
};

const OPERATION_PRESENTERS: Readonly<Record<string, OperationPresenter>> = {
  "analyst.collect_outputs": {
    labelKey: "execution.trace.analyst.collectOutputs",
    fallbackLabel: "Collect analysis outputs",
    detailFields: new Set(["result_count"]),
    counterUnits: ["results"],
  },
  "analyst.prepare_analysis": {
    labelKey: "execution.trace.analyst.prepareAnalysis",
    fallbackLabel: "Prepare analysis",
    detailFields: new Set(),
    counterUnits: [],
  },
  "analyst.run_workflow": {
    labelKey: "execution.trace.analyst.runWorkflow",
    fallbackLabel: "Run analysis workflow",
    detailFields: new Set(["step_count"]),
    counterUnits: ["steps"],
  },
  "artifact.package": {
    labelKey: "execution.operation.artifact.package",
    fallbackLabel: "Package results",
    detailFields: new Set(["artifact_count"]),
    counterUnits: ["artifacts"],
  },
  "data.query": {
    labelKey: "execution.operation.data.query",
    fallbackLabel: "Query data",
    detailFields: new Set(["result_count"]),
    counterUnits: ["rows", "results"],
  },
  "deep_genome.experiment_protocol": {
    labelKey: "execution.trace.deepGenome.experimentProtocol",
    fallbackLabel: "Build experiment protocol",
    detailFields: new Set(),
    counterUnits: [],
  },
  "deep_genome.gather_context": {
    labelKey: "execution.trace.deepGenome.gatherContext",
    fallbackLabel: "Gather genome context",
    detailFields: new Set(["result_count"]),
    counterUnits: ["results"],
  },
  "deep_genome.prepare_plan": {
    labelKey: "execution.trace.deepGenome.preparePlan",
    fallbackLabel: "Prepare genome analysis plan",
    detailFields: new Set(),
    counterUnits: [],
  },
  "deep_genome.run_analysis_branches": {
    labelKey: "execution.trace.deepGenome.runAnalysisBranches",
    fallbackLabel: "Run genome analysis branches",
    detailFields: new Set(["branch_count"]),
    counterUnits: ["branches"],
  },
  "deep_genome.synthesize_results": {
    labelKey: "execution.trace.deepGenome.synthesizeResults",
    fallbackLabel: "Synthesize genome results",
    detailFields: new Set(["result_count"]),
    counterUnits: ["results"],
  },
  "deep_genome.workflow": {
    labelKey: "execution.operation.deepGenome.workflow",
    fallbackLabel: "Run genome workflow",
    detailFields: new Set(),
    counterUnits: [],
  },
  "design.consolidate_candidates": {
    labelKey: "execution.trace.design.consolidateCandidates",
    fallbackLabel: "Consolidate design candidates",
    detailFields: new Set(["candidate_count"]),
    counterUnits: ["candidates"],
  },
  "design.package_outputs": {
    labelKey: "execution.trace.design.packageOutputs",
    fallbackLabel: "Package design outputs",
    detailFields: new Set(["artifact_count"]),
    counterUnits: ["artifacts"],
  },
  "design.run_branches": {
    labelKey: "execution.trace.design.runBranches",
    fallbackLabel: "Run design branches",
    detailFields: new Set(["branch_count"]),
    counterUnits: ["branches"],
  },
  "design.validate_target": {
    labelKey: "execution.trace.design.validateTarget",
    fallbackLabel: "Validate design target",
    detailFields: new Set(["target_validated"]),
    counterUnits: [],
  },
  "gene_network.infer_network": {
    labelKey: "execution.trace.geneNetwork.inferNetwork",
    fallbackLabel: "Infer regulatory network",
    detailFields: new Set(["gene_count", "interaction_count"]),
    counterUnits: ["genes", "interactions"],
  },
  "gene_network.prepare_inputs": {
    labelKey: "execution.trace.geneNetwork.prepareInputs",
    fallbackLabel: "Prepare analysis inputs",
    detailFields: new Set(["input_count"]),
    counterUnits: ["inputs"],
  },
  "gene_network.rank_regulators": {
    labelKey: "execution.trace.geneNetwork.rankRegulators",
    fallbackLabel: "Rank candidate regulators",
    detailFields: new Set(["regulator_count"]),
    counterUnits: ["regulators"],
  },
  "gene_network.synthesize_results": {
    labelKey: "execution.trace.geneNetwork.synthesizeResults",
    fallbackLabel: "Synthesize network results",
    detailFields: new Set(["result_count"]),
    counterUnits: ["results"],
  },
  "gene_network.validate_target": {
    labelKey: "execution.trace.geneNetwork.validateTarget",
    fallbackLabel: "Validate trait target",
    detailFields: new Set(["target_validated"]),
    counterUnits: [],
  },
  "knowledge.search": {
    labelKey: "execution.operation.knowledge.search",
    fallbackLabel: "Search knowledge",
    detailFields: new Set(["repository_count", "result_count"]),
    counterUnits: ["repositories", "results"],
    grouping: {
      policy: "group_siblings",
      unit: "searches",
      identity: "operation_key",
    },
  },
  "model.generate": {
    labelKey: "execution.operation.model.generate",
    fallbackLabel: "Generate response",
    detailFields: new Set(),
    counterUnits: [],
  },
  "remote.analysis": {
    labelKey: "execution.operation.remote.analysis",
    fallbackLabel: "Run analysis",
    detailFields: new Set(["provider_state"]),
    counterUnits: [],
    grouping: {
      policy: "group_siblings",
      unit: "analyses",
      identity: "parent_span",
    },
  },
  "remote.reconcile": {
    labelKey: "execution.operation.remote.reconcile",
    fallbackLabel: "Collect analysis",
    detailFields: new Set(["provider_state", "result_count"]),
    counterUnits: ["results"],
  },
  "remote.submit": {
    labelKey: "execution.operation.remote.submit",
    fallbackLabel: "Submit analysis",
    detailFields: new Set(["provider_state"]),
    counterUnits: [],
    grouping: {
      policy: "attach_to_parent",
      parentOperationKey: "remote.analysis",
    },
  },
  "research.collect_evidence": {
    labelKey: "execution.trace.research.collectEvidence",
    fallbackLabel: "Collect research evidence",
    detailFields: new Set(["result_count"]),
    counterUnits: ["results"],
  },
  "research.decompose_objectives": {
    labelKey: "execution.trace.research.decomposeObjectives",
    fallbackLabel: "Define research objectives",
    detailFields: new Set(["objective_count"]),
    counterUnits: ["objectives"],
  },
  "research.dispatch_work": {
    labelKey: "execution.trace.research.dispatchWork",
    fallbackLabel: "Run research tasks",
    detailFields: new Set(["task_count"]),
    counterUnits: ["tasks"],
  },
  "research.package_outputs": {
    labelKey: "execution.trace.research.packageOutputs",
    fallbackLabel: "Package research outputs",
    detailFields: new Set(["artifact_count"]),
    counterUnits: ["artifacts"],
  },
  "research.synthesize_results": {
    labelKey: "execution.trace.research.synthesizeResults",
    fallbackLabel: "Synthesize research results",
    detailFields: new Set(["result_count"]),
    counterUnits: ["results"],
  },
  "review.citation_check": {
    labelKey: "execution.operation.review.citationCheck",
    fallbackLabel: "Check citations",
    detailFields: new Set(["ordinal", "total"]),
    counterUnits: ["batches"],
    grouping: {
      policy: "group_siblings",
      unit: "batches",
      identity: "operation_key",
      preserveBranches: true,
    },
  },
  "review.draft_dimension": {
    labelKey: "execution.operation.review.draftDimension",
    fallbackLabel: "Draft section",
    detailFields: new Set(["ordinal", "total"]),
    counterUnits: ["dimensions"],
    grouping: {
      policy: "group_siblings",
      unit: "dimensions",
      identity: "operation_key",
      preserveBranches: true,
    },
  },
  "review.final_synthesis": {
    labelKey: "execution.operation.review.finalSynthesis",
    fallbackLabel: "Synthesize report",
    detailFields: new Set(["total"]),
    counterUnits: ["dimensions"],
  },
  "review.retrieve_dimension": {
    labelKey: "execution.operation.review.retrieveDimension",
    fallbackLabel: "Retrieve evidence",
    detailFields: new Set(["ordinal", "total"]),
    counterUnits: ["dimensions"],
    grouping: {
      policy: "group_siblings",
      unit: "dimensions",
      identity: "operation_key",
      preserveBranches: true,
    },
  },
  "tool.analyst": {
    labelKey: "execution.operation.tool.analyst",
    fallbackLabel: "Submit analysis",
    detailFields: new Set(),
    counterUnits: [],
  },
  "tool.brief_gene": {
    labelKey: "execution.operation.tool.brief_gene",
    fallbackLabel: "Run gene summary",
    detailFields: new Set(),
    counterUnits: [],
  },
  "tool.chat": {
    labelKey: "execution.operation.tool.chat",
    fallbackLabel: "Generate response",
    detailFields: new Set(),
    counterUnits: [],
  },
  "tool.data": {
    labelKey: "execution.operation.tool.data",
    fallbackLabel: "Run data analysis",
    detailFields: new Set(),
    counterUnits: [],
  },
  "tool.deep_genome": {
    labelKey: "execution.operation.tool.deep_genome",
    fallbackLabel: "Run genome analysis",
    detailFields: new Set(),
    counterUnits: [],
  },
  "tool.design": {
    labelKey: "execution.operation.tool.design",
    fallbackLabel: "Submit design analysis",
    detailFields: new Set(),
    counterUnits: [],
  },
  "tool.knowledge": {
    labelKey: "execution.operation.tool.knowledge",
    fallbackLabel: "Run knowledge analysis",
    detailFields: new Set(),
    counterUnits: [],
  },
  "tool.network": {
    labelKey: "execution.operation.tool.network",
    fallbackLabel: "Submit network analysis",
    detailFields: new Set(),
    counterUnits: [],
  },
  "tool.research": {
    labelKey: "execution.operation.tool.research",
    fallbackLabel: "Submit research analysis",
    detailFields: new Set(),
    counterUnits: [],
  },
  "tool.review": {
    labelKey: "execution.operation.tool.review",
    fallbackLabel: "Run literature review",
    detailFields: new Set(),
    counterUnits: [],
  },
};

const UNKNOWN_OPERATION_PRESENTER: OperationPresenter = {
  labelKey: "execution.operation.generic",
  fallbackLabel: "Internal operation",
  detailFields: new Set(),
  counterUnits: [],
};

function operationPresenter(key: string): {
  key: string;
  presenter: OperationPresenter;
} {
  const presenter = OPERATION_PRESENTERS[key];
  return presenter
    ? { key, presenter }
    : { key: "operation.unknown", presenter: UNKNOWN_OPERATION_PRESENTER };
}

/** Finite presentation policy for logical grouping and parent attachment. */
export function operationGroupingPolicy(
  key: string
): OperationGroupingPolicy | null {
  return OPERATION_PRESENTERS[key]?.grouping ?? null;
}

function durationSince(startedAt: string, occurredAt: string): number {
  return Math.max(0, Date.parse(occurredAt) - Date.parse(startedAt));
}

function operationTerminalStatus(
  kind: string
): "succeeded" | "partial" | "failed" | "cancelled" | "timed_out" | null {
  if (kind.endsWith(".succeeded")) return "succeeded";
  if (kind.endsWith(".partial")) return "partial";
  if (kind.endsWith(".failed")) return "failed";
  if (kind.endsWith(".cancelled")) return "cancelled";
  if (kind.endsWith(".timed_out")) return "timed_out";
  return null;
}

function applyOperationAttempt(
  existing: ExecutionOperationRecord | undefined,
  event: ExecutionEvent,
  operationStartedAt: string
): ExecutionOperationAttempt[] {
  const attempts = existing ? [...existing.attempts] : [];
  const attemptNumber = Math.max(1, event.attempt ?? 1);
  const index = attempts.findIndex((item) => item.attempt === attemptNumber);
  const prior = index >= 0 ? attempts[index] : undefined;
  const terminal = operationTerminalStatus(event.kind);
  const status: ExecutionOperationAttemptStatus =
    event.kind === "work_unit.retry_scheduled"
      ? "retry_scheduled"
      : terminal && terminal !== "partial"
        ? terminal
        : (prior?.status ?? "running");
  const startedAt =
    event.kind === "work_unit.registered"
      ? operationStartedAt
      : (prior?.startedAt ?? event.occurredAt);
  const completedAt = terminal
    ? event.occurredAt
    : (prior?.completedAt ?? null);
  let failure = prior?.failure ?? null;
  const failureCode = stringValue(event.payload.code);
  if (failureCode && typeof event.payload.retryable === "boolean") {
    failure = { code: failureCode, retryable: event.payload.retryable };
  }
  let retry = prior?.retry ?? null;
  const delayMs = safeInteger(event.payload.delay_ms);
  if (delayMs !== null) retry = { delayMs };
  const attempt: ExecutionOperationAttempt = {
    attempt: attemptNumber,
    status,
    startedAt,
    completedAt,
    durationMs:
      safeInteger(event.payload.duration_ms) ??
      durationSince(startedAt, event.occurredAt),
    failure,
    retry,
  };
  if (index >= 0) attempts[index] = attempt;
  else attempts.push(attempt);
  return attempts.slice(-8);
}

function applyOperationEvent(
  operations: ExecutionOperationRecord[],
  event: ExecutionEvent
): ExecutionOperationRecord[] {
  if (
    !event.workUnitId ||
    (!event.kind.startsWith("work_unit.") && !event.kind.startsWith("span."))
  ) {
    return operations;
  }
  const index = operations.findIndex(
    (operation) => operation.workUnitId === event.workUnitId
  );
  const existing = index >= 0 ? operations[index] : undefined;
  const payloadCandidate =
    stringValue(event.payload.operation_key) ??
    stringValue(event.payload.phase);
  const candidate =
    payloadCandidate && OPERATION_PRESENTERS[payloadCandidate]
      ? payloadCandidate
      : (existing?.operationKey ?? "operation.unknown");
  const resolved = operationPresenter(candidate);
  const startedAt = existing?.startedAt ?? event.occurredAt;
  const terminal = operationTerminalStatus(event.kind);
  const status: ExecutionOperationStatus = terminal
    ? terminal
    : event.kind === "work_unit.retry_scheduled"
      ? "retrying"
      : event.kind === "work_unit.registered"
        ? "queued"
        : existing?.completedAt
          ? existing.status
          : "running";
  let detail = existing?.detail ?? {};
  if (isRecord(event.payload.detail)) {
    const sanitized: ExecutionOperationRecord["detail"] = {};
    for (const [key, value] of Object.entries(event.payload.detail)) {
      if (
        resolved.presenter.detailFields.has(key) &&
        (typeof value === "string" ||
          typeof value === "boolean" ||
          (typeof value === "number" && Number.isSafeInteger(value))) &&
        !containsForbiddenValue(value)
      ) {
        sanitized[key] = value;
      }
    }
    detail = sanitized;
  }
  let progress = existing?.progress ?? null;
  const completed = safeInteger(event.payload.completed);
  const total = safeInteger(event.payload.total, 1);
  if (completed !== null && total !== null && completed <= total) {
    const explicitUnit = stringValue(event.payload.unit);
    const unit =
      explicitUnit && resolved.presenter.counterUnits.includes(explicitUnit)
        ? explicitUnit
        : resolved.presenter.counterUnits.length === 1
          ? resolved.presenter.counterUnits[0]
          : null;
    if (unit) progress = { completed, total, unit };
  }
  const operation: ExecutionOperationRecord = {
    schemaVersion: 1,
    operationId: existing?.operationId ?? `operation-${event.workUnitId}`,
    workUnitId: event.workUnitId,
    operationKey: resolved.key,
    labelKey: resolved.presenter.labelKey,
    fallbackLabel: resolved.presenter.fallbackLabel,
    status,
    startedAt,
    lastObservationAt: event.occurredAt,
    completedAt: terminal ? event.occurredAt : (existing?.completedAt ?? null),
    durationMs:
      safeInteger(event.payload.duration_ms) ??
      Math.max(
        existing?.durationMs ?? 0,
        durationSince(startedAt, event.occurredAt)
      ),
    currentAttempt: Math.max(event.attempt ?? 1, existing?.currentAttempt ?? 1),
    attempts: applyOperationAttempt(existing, event, startedAt),
    progress,
    detail,
    summary:
      terminal || event.kind === "work_unit.retry_scheduled"
        ? { kind: "operation", text: event.summary.text }
        : (existing?.summary ?? null),
    target: event.target ?? existing?.target ?? null,
  };
  if (index >= 0) {
    const next = [...operations];
    next[index] = operation;
    return next;
  }
  return operations.length < 256 ? [...operations, operation] : operations;
}

function stageTodos(
  stage: ExecutionStageName,
  rootStatus: ExecutionStageState["rootStatus"]
): ExecutionStageState["todos"] {
  const order: ExecutionStageName[] = [
    "orchestration",
    "scientific_execution",
    "consolidation",
    "response_settlement",
  ];
  const current = order.indexOf(stage);
  return EXECUTION_STAGE_TODO_IDS.map((id, index) => ({
    id,
    status:
      rootStatus === "succeeded" || rootStatus === "partial"
        ? "completed"
        : rootStatus === "failed" || rootStatus === "timed_out"
          ? index < current
            ? "completed"
            : index === current
              ? "failed"
              : "pending"
          : rootStatus === "cancelled"
            ? index < current
              ? "completed"
              : "skipped"
            : index < current
              ? "completed"
              : index === current
                ? "in_progress"
                : "pending",
  }));
}

function latestTimestamp(current: string | null, candidate: string): string {
  return current === null || Date.parse(candidate) > Date.parse(current)
    ? candidate
    : current;
}

function emptyExecutionStage(): ExecutionStageState {
  return {
    stage: "orchestration",
    childStatus: null,
    rootStatus: "running",
    answerAvailable: false,
    todos: stageTodos("orchestration", "running"),
    pendingStatusKey: "execution.pending.submitted",
    clocks: {
      lastExecutionFactAt: null,
      lastProviderContactAt: null,
      lastStreamContactAt: null,
    },
  };
}

function applyExecutionStage(
  current: ExecutionStageState | null,
  event: ExecutionEvent
): ExecutionStageState | null {
  if (event.schemaVersion !== 2) return current;
  if (
    event.kind === "tracking.degraded" ||
    event.kind === "tracking.recovered" ||
    event.kind === "sequence.gap"
  ) {
    return current;
  }
  const observation = stringValue(event.payload.observation);
  if (observation === "liveness") return current;
  const state = current ?? emptyExecutionStage();
  if (observation === "provider_contact") {
    return {
      ...state,
      clocks: {
        ...state.clocks,
        lastProviderContactAt: latestTimestamp(
          state.clocks.lastProviderContactAt,
          event.occurredAt
        ),
      },
    };
  }

  const order: ExecutionStageName[] = [
    "orchestration",
    "scientific_execution",
    "consolidation",
    "response_settlement",
  ];
  let targetStage = state.stage;
  let childStatus = state.childStatus;
  let answerAvailable = state.answerAvailable;
  let rootStatus = state.rootStatus;
  const operationKey =
    stringValue(event.payload.operation_key) ??
    stringValue(event.payload.phase);
  const providerState = isRecord(event.payload.detail)
    ? stringValue(event.payload.detail.provider_state)
    : null;
  if (event.kind === "message.snapshot" || event.kind === "message.completed") {
    targetStage = "response_settlement";
    answerAvailable = true;
  } else if (
    event.kind === "artifact.published" ||
    event.kind === "result.published" ||
    operationKey === "remote.reconcile" ||
    operationKey === "artifact.package"
  ) {
    targetStage = "consolidation";
  } else if (event.workUnitId) {
    if (event.kind === "work_unit.submitted" || providerState === "submitted") {
      targetStage = "orchestration";
      childStatus = "succeeded";
    } else if (
      ["queued", "running", "consolidating", "terminal"].includes(
        providerState ?? ""
      )
    ) {
      targetStage = "scientific_execution";
    } else if (operationKey !== "remote.submit") {
      targetStage = "scientific_execution";
    }
  }
  if (order.indexOf(targetStage) < order.indexOf(state.stage)) {
    targetStage = state.stage;
  }
  const terminal = {
    "execution.succeeded": "succeeded",
    "execution.partial": "partial",
    "execution.failed": "failed",
    "execution.cancelled": "cancelled",
    "execution.timed_out": "timed_out",
    "run.succeeded": "succeeded",
    "run.failed": "failed",
    "run.cancelled": "cancelled",
  }[event.kind] as ExecutionTerminalStatus | undefined;
  if (terminal) {
    rootStatus = terminal;
    if (terminal === "succeeded" || terminal === "partial") {
      targetStage = "response_settlement";
      answerAvailable = true;
    }
  }
  const isTerminal = rootStatus !== "running";
  const pendingStatusKey = isTerminal
    ? null
    : {
        orchestration: "execution.pending.submitted",
        scientific_execution: "execution.pending.running",
        consolidation: "execution.pending.consolidating",
        response_settlement: "execution.pending.settling",
      }[targetStage];
  return {
    stage: targetStage,
    childStatus,
    rootStatus,
    answerAvailable,
    todos: stageTodos(targetStage, rootStatus),
    pendingStatusKey,
    clocks: {
      ...state.clocks,
      lastExecutionFactAt: latestTimestamp(
        state.clocks.lastExecutionFactAt,
        event.occurredAt
      ),
      ...(providerState
        ? {
            lastProviderContactAt: latestTimestamp(
              state.clocks.lastProviderContactAt,
              event.occurredAt
            ),
          }
        : {}),
    },
  };
}

function isSemanticExecutionEvent(event: ExecutionEvent): boolean {
  return !(
    event.kind === "tracking.degraded" ||
    event.kind === "tracking.recovered" ||
    event.kind === "sequence.gap" ||
    ["provider_contact", "liveness"].includes(
      stringValue(event.payload.observation) ?? ""
    )
  );
}

export function applyExecutionEvent(
  state: ExecutionRunState,
  event: ExecutionEvent
): ExecutionRunState {
  const eventExecutionId = event.executionId ?? event.runId;
  if (eventExecutionId !== state.executionId) return state;
  if (event.seq <= state.latestSeq) return state;
  if (event.seq !== state.latestSeq + 1) return { ...state, delivery: "gap" };
  if (
    state.terminal &&
    !["tracking.degraded", "tracking.recovered"].includes(event.kind)
  ) {
    return {
      ...state,
      latestSeq: event.seq,
      events: event.known ? [...state.events, event] : state.events,
    };
  }

  const next: ExecutionRunState = {
    ...state,
    latestSeq: event.seq,
    status: executionStatusAfterEvent(state.status, event),
    events: event.known ? [...state.events, event] : state.events,
    delivery: state.delivery === "gap" ? "gap" : "connected",
    startedAt: state.startedAt ?? event.occurredAt,
    lastActivityAt: isSemanticExecutionEvent(event)
      ? event.occurredAt
      : state.lastActivityAt,
    operations: applyOperationEvent(state.operations, event),
    executionStage: applyExecutionStage(state.executionStage, event),
  };
  if (!event.known) return next;
  if (event.spanId) {
    next.spans = {
      ...state.spans,
      [event.spanId]: {
        spanId: event.spanId,
        parentSpanId: event.parentSpanId ?? null,
        workUnitId: event.workUnitId ?? null,
        attempt: event.attempt ?? state.spans[event.spanId]?.attempt ?? 0,
        status: event.status,
        lastEventId: event.eventId,
      },
    };
  }
  if (event.kind.startsWith("phase.")) {
    const phase = stringValue(event.payload.phase);
    if (phase) next.phase = phase;
  }
  if (event.kind === "todo.snapshot") {
    const todos = decodeTodoItems(event.payload.items);
    if (todos.ok) {
      next.todos = todos.value;
      next.todoDeclared = true;
    }
  }
  if (
    (event.kind === "artifact.published" ||
      event.kind === "result.published") &&
    event.target &&
    event.target.kind !== "trace"
  ) {
    const name = stringValue(event.payload.name);
    const mediaType = stringValue(event.payload.media_type);
    const sizeBytes = safeInteger(event.payload.size_bytes);
    if (name && mediaType && sizeBytes !== null) {
      next.results = [
        ...state.results.filter((result) => result.eventId !== event.eventId),
        {
          eventId: event.eventId,
          name,
          mediaType,
          sizeBytes,
          target: event.target,
        },
      ];
    }
  }
  if (event.kind === "input.required") {
    const surfaceId = stringValue(event.payload.surface_id);
    const widget = stringValue(event.payload.widget);
    const actionRevision = safeInteger(event.payload.action_revision);
    if (surfaceId && widget && actionRevision !== null) {
      next.inputRequired = { surfaceId, widget, actionRevision };
      next.operationRevision = Math.max(next.operationRevision, actionRevision);
    }
  } else if (event.kind === "input.resolved") {
    next.inputRequired = null;
  }
  if (
    [
      "run.succeeded",
      "run.failed",
      "run.cancelled",
      "execution.succeeded",
      "execution.partial",
      "execution.failed",
      "execution.cancelled",
      "execution.timed_out",
    ].includes(event.kind)
  ) {
    next.terminal = {
      status: event.status as
        "succeeded" | "partial" | "failed" | "cancelled" | "timed_out",
      eventId: event.eventId,
    };
  }
  if (event.kind === "tracking.degraded") {
    next.delivery = "degraded";
    next.trackingHealth = "degraded";
  }
  if (event.kind === "tracking.recovered") {
    next.delivery = "connected";
    next.trackingHealth = "healthy";
  }
  if (
    (event.kind === "artifact.published" ||
      event.kind === "result.published") &&
    event.target
  ) {
    if (
      !next.targets.some(
        (target) =>
          target.kind === event.target?.kind && target.id === event.target?.id
      )
    ) {
      next.targets = [...next.targets, event.target];
    }
  }
  if (event.kind === "message.snapshot" || event.kind === "message.completed") {
    const chunk = decodeDurableMessageChunk(event.payload);
    if (chunk) {
      const newerRevision = chunk.revision > state.outputRevision;
      const sameRevision = chunk.revision === state.outputRevision;
      if (newerRevision && chunk.baseOffset === 0) {
        next.outputText = chunk.text;
        next.outputRevision = chunk.revision;
        next.outputOffset = chunk.offset;
      } else if (sameRevision && chunk.baseOffset === state.outputOffset) {
        next.outputText = state.outputText + chunk.text;
        next.outputOffset = chunk.offset;
      } else if (
        sameRevision &&
        chunk.baseOffset === 0 &&
        chunk.offset >= state.outputOffset
      ) {
        next.outputText = chunk.text;
        next.outputOffset = chunk.offset;
      } else if (
        chunk.revision >= state.outputRevision &&
        chunk.offset > state.outputOffset
      ) {
        next.delivery = "gap";
      }
    }
  }
  return next;
}

export function hydrateExecutionProjection(
  state: ExecutionRunState,
  projection: ExecutionProjection
): ExecutionRunState {
  if (
    state.executionId !== (projection.executionId ?? projection.runId) ||
    projection.latestSeq < state.latestSeq
  )
    return state;
  return {
    ...state,
    schemaVersion: projection.schemaVersion,
    latestSeq: projection.latestSeq,
    status: projection.status,
    phase: projection.phase,
    todos: projection.todos,
    results: projection.results,
    inputRequired: projection.inputRequired,
    terminal: projection.terminal,
    delivery: projection.stale ? "stale" : "connected",
    outputRevision: Math.max(
      state.outputRevision,
      projection.outputRevision ?? 0
    ),
    outputOffset: Math.max(state.outputOffset, projection.outputOffset ?? 0),
    operationRevision: Math.max(
      state.operationRevision,
      projection.operationRevision ?? 0
    ),
    trackingHealth: projection.trackingHealth ?? state.trackingHealth,
    targets: projection.targets ?? state.targets,
    agentSlug: projection.agentSlug ?? state.agentSlug,
    selectedAgentId: projection.selectedAgentId ?? state.selectedAgentId,
    routeReasonCode: projection.routeReasonCode ?? state.routeReasonCode,
    operations: projection.operations,
    executionStage: projection.executionStage,
    todoDeclared:
      projection.todoDeclared ??
      (projection.todos.length > 0 || state.todoDeclared),
  };
}

export function openExecutionTarget(
  tabs: readonly ExecutionWorkspaceTab[],
  target: ExecutionTarget,
  title: string
): { tabs: ExecutionWorkspaceTab[]; activeKey: string } {
  const activeKey = `${target.kind}:${target.id}`;
  if (tabs.some((tab) => tab.key === activeKey))
    return { tabs: [...tabs], activeKey };
  return {
    tabs: [...tabs, { key: activeKey, target, title }],
    activeKey,
  };
}

export function openExecutionDiagnostics(
  tabs: readonly ExecutionWorkspaceTab[],
  executionId: string,
  title: string
): { tabs: ExecutionWorkspaceTab[]; activeKey: string } {
  const activeKey = `diagnostics:${executionId}`;
  if (tabs.some((tab) => tab.key === activeKey)) {
    return { tabs: [...tabs], activeKey };
  }
  return {
    tabs: [
      ...tabs,
      {
        key: activeKey,
        target: { kind: "event", id: `diagnostics-${executionId}` },
        title,
        localView: "diagnostics",
      },
    ],
    activeKey,
  };
}
