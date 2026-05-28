/*
 * 组件注释
 * @Author: error: git config user.name & please set dead value or install git
 * @Date: 2025-04-29 15:21:50
 * @LastEditors: error: git config user.name & please set dead value or install git
 * @LastEditTime: 2025-05-12 09:53:49
 * @Description:
 * 既往不恋！当下不杂！！未来不迎！！！
 */
import request, { createAbortableRequest } from '@/utils/request';

// 历史问题列表
export const getHistoryQuestionList = () => {
  return request({
    url: '/v1/query/list',
    method: 'get',
  });
};

// 对话
export const getQuery = (data: {
  query: string;
  id?: number;
  tool?: string;
  files?: File[];
} | FormData) => {
  return request({
    url: '/query',
    method: 'post',
    data: data,
  });
};

// 可中止的对话请求
export const getQueryAbortable = (data: {
  query: string;
  id?: number;
  tool?: string;
  files?: File[];
} | FormData, requestId?: string) => {
  return createAbortableRequest({
    url: '/query',
    method: 'post',
    data: data,
    requestId: requestId,
  });
};

// 查询对话
export const getAnswerCheck = (data: { dialogue_id: string }) => {
  return request({
    url: '/v1/answer/check',
    method: 'get',
    params: data,
  });
};

// 获取用户权限工具
export const getUserTool = () => {
  return request({
    url: '/v1/permission/user/tool',
    method: 'get',

    
  });
};

// 获取对话下载链接
export const getChatdownloadURL = (data: { obs_path: string }) => {
  return request({
    url: '/v1/download/analyst_agent/obs_file',
    method: 'get',
    params: data,
  });
};

// 获取对话下载链接
export const getFileDownUrlApi = (data: { id: string,document_format:string }|FormData) => {
  return request({
    url: '/v1/download/rendering_file',
    method: 'post',
    data: data,
    responseType: 'blob',
  });
};

// 获取对话下载链接
export const getAnalystAgentLog = (data: { id: string }) => {
  return request({
    url: '/v1/analyst/get_log',
    method: 'get',
    params: data,
  });
};
// 点赞点踩
export const getReactionType = (data: { id: string; reaction_type: string } | FormData) => {
  return request({
    url: '/v1/query/reaction_type',
    method: 'post',
    data: data,
  });
};
// 删除历史对话
export const deleteHistory = (data: { id: string; reaction_type: string } | FormData) => {
  return request({
    url: '/v1/query/list/delete',
    method: 'post',
    data: data,
  });
};
// 重命名对话
export const renameHistory = (data: { id: string; rename: string } | FormData) => {
  return request({
    url: '/v1/query/list/rename',
    method: 'post',
    data: data,
  });
};
// 收藏对话
export const collectHistory = (data: { id: string; reaction_type: string } | FormData) => {
  return request({
    url: '/v1/query/collect',
    method: 'post',
    data: data,
  });
};
// 获取收藏对话列表
export const getCollectHistory = (data: { id: string }) => {
  return request({
    url: '/v1/query/collect/list',
    method: 'get',
    params: data,
  });
};

// 更新日志
export const updateAnalystAgentLog = (data: { task_id: string; compute_resource: string } | FormData) => {
  return request({
    url: '/query/analyst/update_log',
    method: 'post',
    data: data,
  });
};

// 获取 AnalystAgent obs 图片下载链接(GeneNetworkAgent / DigitalDesignAgent 渲染依赖)
export const getObsImages = (data: { obs_path: string }) => {
  return request({
    url: '/v1/download/analyst_agent/obs_images',
    method: 'get',
    params: data,
  });
};