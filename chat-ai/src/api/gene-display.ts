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

// 基因展示
export const getGeneList = (params?: {
  title?: string;
  current?: number;
  size?: number;
}) => {
  return request({
    url: '/v1/gene/list',
    method: 'get',
    params,
  });
};
// 基因详情展示
export const getGeneDetails = (params?: {
  id?: string;
  current?: number;
  size?: number;
}) => {
  return request({
    url: '/v1/gene/details',
    method: 'get',
    params,
  });
};
