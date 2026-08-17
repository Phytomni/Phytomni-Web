import type { AxiosProgressEvent } from "axios";

import { createAbortableRequest } from "@/utils/request";
import { normalizePositiveTaskRowId } from "@/api/task";
import type { RemoteAgentTool } from "@/constants/agents";
import type {
  ApiEnvelope,
  AnalystAgentLog,
  AgentResultDelivery,
  BinaryResponse,
  ConversationSummary,
  DecodedQueryData,
  QueryRequest,
} from "@/api/types";
import {
  decodeChatHistory,
  decodeConversationList,
  decodeImageData,
  decodeMutationData,
  decodeQueryData,
  decodeAnalystAgentLog,
  decodeAgentResultDelivery,
  decodeString,
  decodeUserToolResponse,
  isConversationArtifactDownloadURL,
  requestAbortableApi,
  requestApi,
  type ChatHistoryRecord,
  type MutationData,
  type UserToolResponse,
} from "@/api/types";

export type { QueryData } from "@/api/types";
export { decodeQueryData } from "@/api/types";

export type QueryProgressOpts = {
  onUploadProgress?: (e: AxiosProgressEvent) => void;
};

export type DownloadProgressOpts = {
  requestId?: string;
  onDownloadProgress?: (e: AxiosProgressEvent) => void;
};

type FormIdPayload = { id: string | number };

const EXPLICIT_RESEARCH_INTENT_HEADER = "X-Phyto-Research-Intent";
const EXPLICIT_RESEARCH_INTENT_VALUE = "expert-research-v1";
const CLIENT_TURN_ID_HEADER = "X-Phyto-Client-Turn-Id";

function queryIdentityHeaders(
  data: QueryRequest | FormData
): Record<string, string> | undefined {
  if (!(data instanceof FormData)) return undefined;
  const headers: Record<string, string> = {};
  const clientTurnId = data.get("client_turn_id");
  if (typeof clientTurnId === "string" && clientTurnId !== "") {
    headers[CLIENT_TURN_ID_HEADER] = clientTurnId;
  }
  if (
    data.get("mode") === "expert" &&
    data.get("tool") === "InSilicoResearchAgent"
  ) {
    headers[EXPLICIT_RESEARCH_INTENT_HEADER] = EXPLICIT_RESEARCH_INTENT_VALUE;
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}

function getId(data: FormIdPayload | FormData, label: string): string | number {
  const id = data instanceof FormData ? data.get("id") : data.id;
  if (!(
    (typeof id === "number" && Number.isFinite(id)) ||
    (typeof id === "string" && id.length > 0)
  )) {
    throw new TypeError(`Invalid ${label}`);
  }
  return id;
}

// History question list
export const getHistoryQuestionList = (): Promise<
  ApiEnvelope<ConversationSummary[]>
> =>
  requestApi(
    {
      url: "/api/v1/conversations",
      method: "get",
    },
    decodeConversationList
  );

export const retryConversationResultArchive = (data: {
  dialogue_id: string;
  message_id: string;
}): Promise<ApiEnvelope<AgentResultDelivery>> =>
  requestApi(
    {
      url:
        `/api/v1/conversations/${encodeURIComponent(data.dialogue_id)}` +
        `/messages/${encodeURIComponent(data.message_id)}/artifacts/archive/retry`,
      method: "post",
    },
    decodeAgentResultDelivery
  );

// Conversation (send message; RESTful: conversation id in path, id=0 is a new conversation)
export const getQuery = (
  data: QueryRequest | FormData,
  opts?: QueryProgressOpts
): Promise<ApiEnvelope<DecodedQueryData>> => {
  const id =
    data instanceof FormData ? (data.get("id") ?? "0") : (data.id ?? 0);
  const headers = queryIdentityHeaders(data);
  return requestApi(
    {
      url: `/api/v1/conversations/${id}/messages`,
      method: "post",
      data,
      onUploadProgress: opts?.onUploadProgress,
      ...(headers ? { headers } : {}),
    },
    decodeQueryData
  );
};

// Abortable conversation request (same as above)
export const getQueryAbortable = (
  data: QueryRequest | FormData,
  requestId?: string,
  opts?: QueryProgressOpts
): Promise<ApiEnvelope<DecodedQueryData>> => {
  const id =
    data instanceof FormData ? (data.get("id") ?? "0") : (data.id ?? 0);
  const headers = queryIdentityHeaders(data);
  return requestAbortableApi(
    {
      url: `/api/v1/conversations/${id}/messages`,
      method: "post",
      data,
      requestId,
      onUploadProgress: opts?.onUploadProgress,
      ...(headers ? { headers } : {}),
    },
    decodeQueryData
  );
};

export function runAgentProductAbortable(
  tool: RemoteAgentTool,
  data: FormData,
  requestId?: string,
  opts?: QueryProgressOpts
): Promise<ApiEnvelope<DecodedQueryData>> {
  const headers = queryIdentityHeaders(data);
  return requestAbortableApi(
    {
      url: `/api/v1/agent-products/${encodeURIComponent(tool)}/runs`,
      method: "post",
      data,
      requestId,
      onUploadProgress: opts?.onUploadProgress,
      ...(headers ? { headers } : {}),
    },
    decodeQueryData
  );
}

// Query conversation (all child messages of a conversation)
export const getAnswerCheck = (data: {
  dialogue_id: string;
}): Promise<ApiEnvelope<ChatHistoryRecord[]>> =>
  requestApi(
    {
      url: `/api/v1/conversations/${data.dialogue_id}/messages`,
      method: "get",
    },
    decodeChatHistory
  );

// Sign one conversation artifact only after an explicit authenticated click.
// The returned relay URL is consumed immediately and never enters chat or
// history state.
export const getConversationArtifactDownloadURL = (data: {
  dialogue_id: string;
  message_id: string;
  artifact_id: string;
}): Promise<ApiEnvelope<string>> =>
  requestApi(
    {
      url: `/api/v1/conversations/${encodeURIComponent(
        data.dialogue_id
      )}/messages/${encodeURIComponent(
        data.message_id
      )}/artifacts/${encodeURIComponent(data.artifact_id)}/download-url`,
      method: "get",
    },
    decodeString
  );

// Get user tool permissions
export const getUserTool = (): Promise<ApiEnvelope<UserToolResponse>> =>
  requestApi(
    {
      url: "/api/v1/users/me/tool-permissions",
      method: "get",
    },
    decodeUserToolResponse
  );

// Get conversation download URL (analyst-agent OBS file)
export const getChatdownloadURL = (data: {
  obs_path: string;
}): Promise<ApiEnvelope<string>> => {
  if (isConversationArtifactDownloadURL(data.obs_path)) {
    return Promise.resolve({ code: 200, data: data.obs_path });
  }
  return requestApi(
    {
      url: "/api/v1/downloads/analyst-agent/obs-file",
      method: "get",
      params: data,
    },
    decodeString
  );
};

export const getConversationArtifactFile = (
  downloadURL: string,
  opts?: DownloadProgressOpts
): Promise<BinaryResponse> => {
  if (!isConversationArtifactDownloadURL(downloadURL)) {
    throw new TypeError("Invalid conversation artifact download URL");
  }
  return createAbortableRequest<BinaryResponse>({
    url: downloadURL,
    method: "get",
    responseType: "blob",
    requestId: opts?.requestId,
    onDownloadProgress: opts?.onDownloadProgress,
  });
};

// Get rendering-file download URL
export const getFileDownUrlApi = (
  data: { id: string; document_format: string } | FormData,
  opts?: DownloadProgressOpts
): Promise<BinaryResponse> =>
  createAbortableRequest<BinaryResponse>({
    url: "/api/v1/downloads/rendering-file",
    method: "post",
    data,
    responseType: "blob",
    requestId: opts?.requestId,
    onDownloadProgress: opts?.onDownloadProgress,
  });

// Get analyst log (RESTful: task id in path)
export const getAnalystAgentLog = (data: {
  id: string | number;
}): Promise<ApiEnvelope<AnalystAgentLog>> => {
  const rowId = normalizePositiveTaskRowId(data.id);
  return requestApi(
    {
      url: `/api/v1/async-tasks/${rowId}/analyst-log`,
      method: "get",
    },
    decodeAnalystAgentLog
  );
};

// Reaction like/dislike (RESTful: conversation id in path)
export const getReactionType = (
  data: (FormIdPayload & { reaction_type: string }) | FormData
): Promise<ApiEnvelope<MutationData>> => {
  const id = getId(data, "conversation id");
  return requestApi(
    {
      url: `/api/v1/conversations/${id}/reaction`,
      method: "put",
      data,
    },
    decodeMutationData
  );
};

// Delete conversation (RESTful: conversation id in path, no request body)
export const deleteHistory = (
  data: FormIdPayload | FormData
): Promise<ApiEnvelope<MutationData>> => {
  const id = getId(data, "conversation id");
  return requestApi(
    {
      url: `/api/v1/conversations/${id}`,
      method: "delete",
    },
    decodeMutationData
  );
};

// Rename conversation (RESTful: conversation id in path, rename stays in body)
export const renameHistory = (
  data: (FormIdPayload & { rename: string }) | FormData
): Promise<ApiEnvelope<MutationData>> => {
  const id = getId(data, "conversation id");
  return requestApi(
    {
      url: `/api/v1/conversations/${id}`,
      method: "patch",
      data,
    },
    decodeMutationData
  );
};

// Favorite conversation (RESTful: conversation id in path, collect_type stays in body)
export const collectHistory = (
  data: (FormIdPayload & { collect_type: string }) | FormData
): Promise<ApiEnvelope<MutationData>> => {
  const id = getId(data, "conversation id");
  return requestApi(
    {
      url: `/api/v1/conversations/${id}/favorite`,
      method: "put",
      data,
    },
    decodeMutationData
  );
};

// Get favorites (RESTful: merged into the conversation list, filtered by ?favorite=true)
export const getCollectHistory = (): Promise<
  ApiEnvelope<ConversationSummary[]>
> =>
  requestApi(
    {
      url: "/api/v1/conversations",
      method: "get",
      params: { favorite: true },
    },
    decodeConversationList
  );

// Update analyst log (RESTful: async-task subresource write-back)
export const updateAnalystAgentLog = (
  data: { task_id: string; compute_resource: string } | FormData
): Promise<ApiEnvelope<MutationData>> =>
  requestApi(
    {
      url: "/api/v1/async-tasks/analyst-log",
      method: "patch",
      data,
    },
    decodeMutationData
  );

// Get AnalystAgent OBS image download URLs (GeneNetworkAgent / DigitalDesignAgent rendering dependency)
export const getObsImages = (data: {
  obs_path: string;
}): Promise<ApiEnvelope<string | string[]>> =>
  requestApi(
    {
      url: "/api/v1/downloads/analyst-agent/obs-images",
      method: "get",
      params: data,
      suppressErrorToast: true,
    },
    decodeImageData
  );
