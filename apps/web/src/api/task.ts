import type { ApiEnvelope, AsyncTaskListResponse } from "@/api/types";
import { decodeAsyncTaskListResponse, requestApi } from "@/api/types";

export interface TaskListQuery {
  current?: number;
  size?: number;
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
