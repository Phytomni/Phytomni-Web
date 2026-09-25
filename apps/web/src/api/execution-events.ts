import i18n from "@/locales";
import { requestApi, type ApiEnvelope } from "@/api/types";
import { getToken } from "@/utils/auth";
import {
  decodeExecutionEvent,
  decodeExecutionEventPage,
  decodeExecutionProjection,
  decodeExecutionTargetResolution,
  type ExecutionEvent,
  type ExecutionEventPage,
  type ExecutionProjection,
  type ExecutionTarget,
  type ExecutionTargetResolution,
} from "@/views/chat/streaming/executionEvents";

function required<T>(
  result: { ok: true; value: T } | { ok: false; reason: string }
): T {
  if (!result.ok) throw new TypeError(result.reason);
  return result.value;
}

function executionURL(
  dialogueId: string,
  runId: string,
  suffix: string
): string {
  return (
    `/api/v1/conversations/${encodeURIComponent(dialogueId)}` +
    `/runs/${encodeURIComponent(runId)}/${suffix}`
  );
}

function publicExecutionURL(executionId: string, suffix = ""): string {
  const base = `/api/v1/executions/${encodeURIComponent(executionId)}`;
  return suffix ? `${base}/${suffix}` : base;
}

export function getExecutionEvents(data: {
  dialogueId: string;
  runId: string;
  afterSeq?: number;
  limit?: number;
}): Promise<ApiEnvelope<ExecutionEventPage>> {
  return requestApi(
    {
      url: executionURL(data.dialogueId, data.runId, "events"),
      method: "get",
      params: { after_seq: data.afterSeq ?? 0, limit: data.limit ?? 200 },
      suppressErrorToast: true,
    },
    (value) => required(decodeExecutionEventPage(value))
  );
}

export function getExecutionProjection(data: {
  dialogueId: string;
  runId: string;
}): Promise<ApiEnvelope<ExecutionProjection>> {
  return requestApi(
    {
      url: executionURL(data.dialogueId, data.runId, "event-projection"),
      method: "get",
      suppressErrorToast: true,
    },
    (value) => required(decodeExecutionProjection(value))
  );
}

export function getExecutionEvent(data: {
  dialogueId: string;
  runId: string;
  eventId: string;
}): Promise<ApiEnvelope<ExecutionEvent>> {
  return requestApi(
    {
      url: executionURL(
        data.dialogueId,
        data.runId,
        `events/${encodeURIComponent(data.eventId)}`
      ),
      method: "get",
      suppressErrorToast: true,
    },
    (value) => required(decodeExecutionEvent(value))
  );
}

export function getExecutionTarget(data: {
  dialogueId: string;
  runId: string;
  target: ExecutionTarget;
}): Promise<ApiEnvelope<ExecutionTargetResolution>> {
  return requestApi(
    {
      url: executionURL(
        data.dialogueId,
        data.runId,
        `targets/${encodeURIComponent(data.target.kind)}/${encodeURIComponent(
          data.target.id
        )}`
      ),
      method: "get",
      suppressErrorToast: true,
    },
    (value) => required(decodeExecutionTargetResolution(value))
  );
}

export function getExecutionEventsById(data: {
  executionId: string;
  afterSeq?: number;
  limit?: number;
}): Promise<ApiEnvelope<ExecutionEventPage>> {
  return requestApi(
    {
      url: publicExecutionURL(data.executionId, "events"),
      method: "get",
      params: { after_seq: data.afterSeq ?? 0, limit: data.limit ?? 200 },
      suppressErrorToast: true,
    },
    (value) => required(decodeExecutionEventPage(value))
  );
}

export function getExecutionProjectionById(data: {
  executionId: string;
}): Promise<ApiEnvelope<ExecutionProjection>> {
  return requestApi(
    {
      url: publicExecutionURL(data.executionId),
      method: "get",
      suppressErrorToast: true,
    },
    (value) => required(decodeExecutionProjection(value))
  );
}

export function getExecutionTargetById(data: {
  executionId: string;
  target: ExecutionTarget;
  afterSeq?: number;
  limit?: number;
}): Promise<ApiEnvelope<ExecutionTargetResolution>> {
  return requestApi(
    {
      url: publicExecutionURL(
        data.executionId,
        `targets/${encodeURIComponent(data.target.kind)}/${encodeURIComponent(
          data.target.id
        )}`
      ),
      method: "get",
      ...(data.target.kind === "trace"
        ? {
            params: { after_seq: data.afterSeq ?? 0, limit: data.limit ?? 100 },
          }
        : {}),
      suppressErrorToast: true,
    },
    (value) => required(decodeExecutionTargetResolution(value))
  );
}

export function openExecutionEventStreamById(data: {
  executionId: string;
  afterSeq: number;
  afterRevision?: number;
  afterOffset?: number;
  signal: AbortSignal;
}): Promise<Response> {
  const token = getToken();
  return fetch(
    `${publicExecutionURL(data.executionId, "events/stream")}` +
      `?after_seq=${encodeURIComponent(String(data.afterSeq))}` +
      `&after_revision=${encodeURIComponent(String(data.afterRevision ?? 0))}` +
      `&after_offset=${encodeURIComponent(String(data.afterOffset ?? 0))}`,
    {
      method: "GET",
      signal: data.signal,
      headers: {
        Accept: "text/event-stream",
        "Accept-Language": i18n.global.locale.value,
        platform: "bcemis",
        ...(token ? { Authorization: `Bearer ${token}`, satoken: token } : {}),
        ...(data.afterSeq > 0
          ? { "Last-Event-ID": String(data.afterSeq) }
          : {}),
      },
    }
  );
}

export function postExecutionAction(data: {
  executionId: string;
  actionId: string;
  expectedRevision: number;
  surfaceId: string;
  widget: string;
  payload: Readonly<Record<string, unknown>>;
}): Promise<ApiEnvelope<Record<string, unknown>>> {
  return requestApi(
    {
      url: publicExecutionURL(data.executionId, "actions"),
      method: "post",
      data: {
        action_id: data.actionId,
        expected_revision: data.expectedRevision,
        surface_id: data.surfaceId,
        widget: data.widget,
        payload: data.payload,
      },
    },
    (value) => {
      if (typeof value !== "object" || value === null || Array.isArray(value))
        throw new TypeError("invalid execution action response");
      return value as Record<string, unknown>;
    }
  );
}

export function cancelExecution(data: {
  executionId: string;
  requestId: string;
  expectedRevision: number;
  reason?: string;
}): Promise<ApiEnvelope<Record<string, unknown>>> {
  return requestApi(
    {
      url: publicExecutionURL(data.executionId, "cancel"),
      method: "post",
      data: {
        request_id: data.requestId,
        expected_revision: data.expectedRevision,
        reason: data.reason ?? "user_requested",
      },
    },
    (value) => {
      if (typeof value !== "object" || value === null || Array.isArray(value))
        throw new TypeError("invalid execution cancellation response");
      return value as Record<string, unknown>;
    }
  );
}
