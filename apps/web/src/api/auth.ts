/*
 * 组件注释
 * @Author: error: git config user.name & please set dead value or install git
 * @Date: 2025-05-10 10:31:50
 * @LastEditors: error: git config user.name & please set dead value or install git
 * @LastEditTime: 2025-05-12 11:00:13
 * @Description:
 * 既往不恋！当下不杂！！未来不迎！！！
 */
import request from "@/utils/request";

// 获取用户列表
export const getUserList = (data: {
  current: string | number;
  size: string | number;
}) => {
  return request({
    url: "/api/v1/users",
    method: "get",
    params: data,
  });
};

// 自主注册(D5:自助注册落 /auth/registrations,与管理员建号 POST /users 区分)
export const register = (data: any) => {
  return request({
    url: "/api/v1/auth/registrations",
    method: "post",
    data: data,
  });
};

// 修改权限(RESTful:用户 id 进路径 /users/:id/permissions)
export const changePermission = (data: any) => {
  const id = data instanceof FormData ? data.get("id") : data?.id;
  return request({
    url: `/api/v1/users/${id}/permissions`,
    method: "put",
    data: data,
  });
};
// 修改个人密码
export const changePassword = (data: any) => {
  return request({
    url: "/api/v1/users/me/password",
    method: "put",
    data: data,
  });
};
// 新增用户(管理员建号,D5)
export const addUser = (data: any) => {
  return request({
    url: "/api/v1/users",
    method: "post",
    data: data,
  });
};

// 解锁用户(RESTful:用户 id 进路径,无需请求体)
export const unlockUser = (userId: number) => {
  return request({
    url: `/api/v1/users/${userId}/unlock`,
    method: "post",
  });
};

// 获取用户资料(后端从 JWT 取邮箱、忽略 ?email=,IDOR 关闭;前端仍传以保持兼容)
export const getUserProfile = (email: string) => {
  return request({
    url: "/api/v1/users/me",
    method: "get",
    params: { email },
  });
};
