import request from "@/utils/request";

// User list
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

// Self-service registration (D5: lands on /auth/registrations, distinct from admin-created accounts via POST /users)
export const register = (data: any) => {
  return request({
    url: "/api/v1/auth/registrations",
    method: "post",
    data: data,
  });
};

// Update permissions (RESTful: user id in path /users/:id/permissions)
export const changePermission = (data: any) => {
  const id = data instanceof FormData ? data.get("id") : data?.id;
  return request({
    url: `/api/v1/users/${id}/permissions`,
    method: "put",
    data: data,
  });
};
// Change own password
export const changePassword = (data: any) => {
  return request({
    url: "/api/v1/users/me/password",
    method: "put",
    data: data,
  });
};
// Add user (admin-created account, D5)
export const addUser = (data: any) => {
  return request({
    url: "/api/v1/users",
    method: "post",
    data: data,
  });
};

// Unlock user (RESTful: user id in path, no request body)
export const unlockUser = (userId: number) => {
  return request({
    url: `/api/v1/users/${userId}/unlock`,
    method: "post",
  });
};

// Get user profile (backend reads email from JWT and ignores ?email=, closing IDOR; frontend still passes it for compatibility)
export const getUserProfile = (email: string) => {
  return request({
    url: "/api/v1/users/me",
    method: "get",
    params: { email },
  });
};
