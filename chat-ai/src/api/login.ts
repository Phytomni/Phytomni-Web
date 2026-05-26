/*
 * 组件注释
 * @Author: dingcl-b
 * @Date: 2022-08-04 17:18:59
 * @LastEditors: error: git config user.name & please set dead value or install git
 * @LastEditTime: 2025-05-11 23:29:57
 * @Description:
 * 登录页面
 */
import request from '@/utils/request';

// 登录
export const login = (data: any) => {
  return request({
    url: '/auth/login',
    method: 'post',
    data: data,
  });
};
