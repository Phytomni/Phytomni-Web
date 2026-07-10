import request, { createAbortableRequest } from "@/utils/request";
import type { AxiosProgressEvent } from "axios";

type QueryProgressOpts = {
  onUploadProgress?: (e: AxiosProgressEvent) => void;
};

// History question list
export const getHistoryQuestionList = () => {
  return request({
    url: "/api/v1/conversations",
    method: "get",
  });
};

// Conversation (send message; RESTful: conversation id in path, id=0 is a new conversation)
export const getQuery = (
  data:
    | {
        query: string;
        id?: number;
        tool?: string;
        files?: File[];
      }
    | FormData,
  opts?: QueryProgressOpts
) => {
  const id = data instanceof FormData ? data.get("id") ?? "0" : data.id ?? 0;
  return request({
    url: `/api/v1/conversations/${id}/messages`,
    method: "post",
    data: data,
    onUploadProgress: opts?.onUploadProgress,
  });
};

// Abortable conversation request (same as above)
export const getQueryAbortable = (
  data:
    | {
        query: string;
        id?: number;
        tool?: string;
        files?: File[];
      }
    | FormData,
  requestId?: string,
  opts?: QueryProgressOpts
) => {
  const id = data instanceof FormData ? data.get("id") ?? "0" : data.id ?? 0;
  return createAbortableRequest({
    url: `/api/v1/conversations/${id}/messages`,
    method: "post",
    data: data,
    requestId: requestId,
    onUploadProgress: opts?.onUploadProgress,
  });
};

// Query conversation (all child messages of a conversation)
export const getAnswerCheck = (data: { dialogue_id: string }) => {
  return request({
    url: `/api/v1/conversations/${data.dialogue_id}/messages`,
    method: "get",
  });
};

// Get user tool permissions
export const getUserTool = () => {
  return request({
    url: "/api/v1/users/me/tool-permissions",
    method: "get",
  });
};

// Get conversation download URL (analyst-agent OBS file)
export const getChatdownloadURL = (data: { obs_path: string }) => {
  return request({
    url: "/api/v1/downloads/analyst-agent/obs-file",
    method: "get",
    params: data,
  });
};

// Get rendering-file download URL
export const getFileDownUrlApi = (
  data: { id: string; document_format: string } | FormData
) => {
  return request({
    url: "/api/v1/downloads/rendering-file",
    method: "post",
    data: data,
    responseType: "blob",
  });
};

// Get analyst log (RESTful: task id in path)
export const getAnalystAgentLog = (data: { id: string }) => {
  return request({
    url: `/api/v1/async-tasks/${data.id}/analyst-log`,
    method: "get",
  });
};
// Reaction like/dislike (RESTful: conversation id in path)
export const getReactionType = (
  data: { id: string; reaction_type: string } | FormData
) => {
  const id = data instanceof FormData ? data.get("id") : data.id;
  return request({
    url: `/api/v1/conversations/${id}/reaction`,
    method: "put",
    data: data,
  });
};
// Delete conversation (RESTful: conversation id in path, no request body)
export const deleteHistory = (
  data: { id: string; reaction_type: string } | FormData
) => {
  const id = data instanceof FormData ? data.get("id") : data.id;
  return request({
    url: `/api/v1/conversations/${id}`,
    method: "delete",
  });
};
// Rename conversation (RESTful: conversation id in path, rename stays in body)
export const renameHistory = (
  data: { id: string; rename: string } | FormData
) => {
  const id = data instanceof FormData ? data.get("id") : data.id;
  return request({
    url: `/api/v1/conversations/${id}`,
    method: "patch",
    data: data,
  });
};
// Favorite conversation (RESTful: conversation id in path, collect_type stays in body)
export const collectHistory = (
  data: { id: string; collect_type: string } | FormData
) => {
  const id = data instanceof FormData ? data.get("id") : data.id;
  return request({
    url: `/api/v1/conversations/${id}/favorite`,
    method: "put",
    data: data,
  });
};
// Get favorites (RESTful: merged into the conversation list, filtered by ?favorite=true)
export const getCollectHistory = () => {
  return request({
    url: "/api/v1/conversations",
    method: "get",
    params: { favorite: true },
  });
};

// Update analyst log (RESTful: async-task subresource write-back)
export const updateAnalystAgentLog = (
  data: { task_id: string; compute_resource: string } | FormData
) => {
  return request({
    url: "/api/v1/async-tasks/analyst-log",
    method: "patch",
    data: data,
  });
};

// Get AnalystAgent OBS image download URLs (GeneNetworkAgent / DigitalDesignAgent rendering dependency)
export const getObsImages = (data: { obs_path: string }) => {
  return request({
    url: "/api/v1/downloads/analyst-agent/obs-images",
    method: "get",
    params: data,
  });
};
