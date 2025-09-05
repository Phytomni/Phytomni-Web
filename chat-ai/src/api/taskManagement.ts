/*
 * 组件注释
 * @Author: error: git config user.name & please set dead value or install git
 * @Date: 2025-05-12 12:10:59
 * @LastEditors: error: git config user.name & please set dead value or install git
 * @LastEditTime: 2025-05-12 14:15:35
 * @Description:
 * 既往不恋！当下不杂！！未来不迎！！！
 */
// @ts-ignore
import request from '@/utils/request';

// 任务管理列表
export const getTaskList = (params?: {
  current?: number;
  size?: number;
}) => {
  return request({
    url: '/async_task/List',
    method: 'get',
    params,
  });
};
