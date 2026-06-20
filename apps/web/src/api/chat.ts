/*
 * 组件注释
 * @Author: error: git config user.name & please set dead value or install git
 * @Date: 2025-04-29 15:21:50
 * @LastEditors: error: git config user.name & please set dead value or install git
 * @LastEditTime: 2025-05-12 09:53:49
 * @Description:
 * 既往不恋！当下不杂！！未来不迎！！！
 */
import request, { createAbortableRequest } from "@/utils/request";

// 历史问题列表
export const getHistoryQuestionList = () => {
  return request({
    url: "/api/v1/conversations",
    method: "get",
  });
};

// 对话(发送消息;RESTful:会话 id 进路径,id=0 为新会话)
export const getQuery = (
  data:
    | {
        query: string;
        id?: number;
        tool?: string;
        files?: File[];
      }
    | FormData
) => {
  const id = data instanceof FormData ? data.get("id") ?? "0" : data.id ?? 0;
  return request({
    url: `/api/v1/conversations/${id}/messages`,
    method: "post",
    data: data,
  });
};

// 可中止的对话请求(同上)
export const getQueryAbortable = (
  data:
    | {
        query: string;
        id?: number;
        tool?: string;
        files?: File[];
      }
    | FormData,
  requestId?: string
) => {
  const id = data instanceof FormData ? data.get("id") ?? "0" : data.id ?? 0;
  return createAbortableRequest({
    url: `/api/v1/conversations/${id}/messages`,
    method: "post",
    data: data,
    requestId: requestId,
  });
};

// 查询对话(某会话的全部子级对话)
export const getAnswerCheck = (data: { dialogue_id: string }) => {
  return request({
    url: `/api/v1/conversations/${data.dialogue_id}/messages`,
    method: "get",
  });
};

// 获取用户权限工具
export const getUserTool = () => {
  return request({
    url: "/v1/permission/user/tool",
    method: "get",
  });
};

// 获取对话下载链接
export const getChatdownloadURL = (data: { obs_path: string }) => {
  return request({
    url: "/v1/download/analyst_agent/obs_file",
    method: "get",
    params: data,
  });
};

// 获取对话下载链接
export const getFileDownUrlApi = (
  data: { id: string; document_format: string } | FormData
) => {
  return request({
    url: "/v1/download/rendering_file",
    method: "post",
    data: data,
    responseType: "blob",
  });
};

// 获取分析日志(RESTful:任务 id 进路径)
export const getAnalystAgentLog = (data: { id: string }) => {
  return request({
    url: `/api/v1/async-tasks/${data.id}/analyst-log`,
    method: "get",
  });
};
// 点赞点踩(RESTful:会话 id 进路径)
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
// 删除历史对话(RESTful:会话 id 进路径,无需请求体)
export const deleteHistory = (
  data: { id: string; reaction_type: string } | FormData
) => {
  const id = data instanceof FormData ? data.get("id") : data.id;
  return request({
    url: `/api/v1/conversations/${id}`,
    method: "delete",
  });
};
// 重命名对话(RESTful:会话 id 进路径,rename 留在请求体)
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
// 收藏对话(RESTful:会话 id 进路径,collect_type 留在请求体)
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
// 获取收藏对话列表(RESTful:并入会话列表,?favorite=true 过滤)
export const getCollectHistory = () => {
  return request({
    url: "/api/v1/conversations",
    method: "get",
    params: { favorite: true },
  });
};

// 更新日志
export const updateAnalystAgentLog = (
  data: { task_id: string; compute_resource: string } | FormData
) => {
  return request({
    url: "/query/analyst/update_log",
    method: "post",
    data: data,
  });
};

// 获取 AnalystAgent obs 图片下载链接(GeneNetworkAgent / DigitalDesignAgent 渲染依赖)
export const getObsImages = (data: { obs_path: string }) => {
  return request({
    url: "/v1/download/analyst_agent/obs_images",
    method: "get",
    params: data,
  });
};
