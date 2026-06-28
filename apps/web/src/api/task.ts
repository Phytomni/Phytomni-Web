import request from "@/utils/request";

// Task list
export const getTaskList = (params?: { current?: number; size?: number }) => {
  return request({
    url: "/api/v1/async-tasks",
    method: "get",
    params,
  });
};
