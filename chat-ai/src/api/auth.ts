/*
 * 组件注释
 * @Author: error: git config user.name & please set dead value or install git
 * @Date: 2025-05-10 10:31:50
 * @LastEditors: error: git config user.name & please set dead value or install git
 * @LastEditTime: 2025-05-12 11:00:13
 * @Description:
 * 既往不恋！当下不杂！！未来不迎！！！
 */
import request from '@/utils/request';

// 获取用户列表
export const getUserList = (data: {
  current: string | number;
  size: string | number;
}) => {
  return request({
    url: '/v1/permission/user/list',
    method: 'get',
    params: data,
  });
};

// 注册
export const register = (data: any) => {
  return request({
    url: '/auth/user/register',
    method: 'post',
    data: data,
  });
};

// 修改权限
export const changePermission = (data: any) => {
  return request({
    url: '/v1/modify/permission',
    method: 'post',
    data: data,
  });
};
// 修改密码/权限
export const changePassword = (data: any) => {
  return request({
    url: '/v1/modify/password',
    method: 'post',
    data: data,
  });
};
// 新增用户
export const addUser = (data: any) => {
  return request({
    url: '/v1/register',
    method: 'post',
    data: data,
  });
};

// 解锁用户
export const unlockUser = (userId: number) => {
  const formData = new FormData();
  formData.append('user_id', userId.toString());
  return request({
    url: '/v1/user/unlock',
    method: 'post',
    data: formData,
  });
};

// 获取用户资料
export const getUserProfile = (email: string) => {
  return request({
    url: '/v1/user/profile',
    method: 'get',
    params: { email },
  });
};
