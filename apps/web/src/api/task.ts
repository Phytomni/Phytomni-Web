import type {
  AgentTaskLifecycle,
  ApiEnvelope,
  AsyncTaskListResponse,
} from "@/api/types";
import {
  decodeAgentTaskLifecycle,
  decodeAsyncTaskListResponse,
  requestAbortableApi,
  requestApi,
} from "@/api/types";

export interface TaskListQuery {
  current?: number;
  size?: number;
}

export function normalizePositiveTaskRowId(value: string | number): string {
  const text = typeof value === "number" ? String(value) : value;
  if (!/^[0-9]+$/u.test(text)) throw new TypeError("Invalid task row ID");
  const id = Number(text);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new TypeError("Invalid task row ID");
  }
  return text;
}

// Task list
export const getTaskList = (
  params?: TaskListQuery
): Promise<ApiEnvelope<AsyncTaskListResponse>> =>
  requestApi(
    {
      url: "/api/v1/async-tasks",
      method: "get",
      params,
    },
    decodeAsyncTaskListResponse
  );

export const getTaskLifecycle = (
  id: string | number,
  requestId?: string
): Promise<ApiEnvelope<AgentTaskLifecycle>> => {
  const rowId = normalizePositiveTaskRowId(id);
  return requestAbortableApi(
    {
      url: `/api/v1/async-tasks/${rowId}/lifecycle`,
      method: "get",
      requestId,
      suppressErrorToast: true,
    },
    decodeAgentTaskLifecycle
  );
};

export const cancelTask = (
  id: string | number
): Promise<ApiEnvelope<AgentTaskLifecycle>> => {
  const rowId = normalizePositiveTaskRowId(id);
  return requestApi(
    {
      url: `/api/v1/async-tasks/${rowId}/cancel`,
      method: "post",
      suppressErrorToast: true,
    },
    decodeAgentTaskLifecycle
  );
};
