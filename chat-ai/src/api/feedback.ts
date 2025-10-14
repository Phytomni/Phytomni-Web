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

// 用户反馈
export const feedback = (data: { feedback_type: string; feedback_content: string } | FormData) => {
  return request({
    url: '/v1/user/feedback',
    method: 'post',
    data: data,
  });
};