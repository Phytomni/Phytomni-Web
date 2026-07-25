import type {
  ApiEnvelope,
  ChangePasswordRequest,
  ChangePermissionRequest,
  CreateUserRequest,
  MutationData,
  RegistrationRequest,
  UserListResponse,
  UserProfileResponse,
} from "@/api/types";
import {
  decodeMutationData,
  decodeString,
  decodeUserListResponse,
  decodeUserProfileResponse,
  requestApi,
} from "@/api/types";

export interface UserListQuery {
  current: string | number;
  size: string | number;
}

function getUserId(data: ChangePermissionRequest | FormData): string | number {
  const id = data instanceof FormData ? data.get("id") : data.id;
  if (!(
    (typeof id === "number" && Number.isFinite(id)) ||
    (typeof id === "string" && id.length > 0)
  )) {
    throw new TypeError("Invalid user id");
  }
  return id;
}

// User list
export const getUserList = (
  data: UserListQuery
): Promise<ApiEnvelope<UserListResponse>> =>
  requestApi(
    {
      url: "/api/v1/users",
      method: "get",
      params: data,
    },
    decodeUserListResponse
  );

// Self-service registration (D5: lands on /auth/registrations, distinct from admin-created accounts via POST /users)
export const register = (
  data: RegistrationRequest | FormData
): Promise<ApiEnvelope<string>> =>
  requestApi(
    {
      url: "/api/v1/auth/registrations",
      method: "post",
      data,
    },
    decodeString
  );

// Update permissions (RESTful: user id in path /users/:id/permissions)
export const changePermission = (
  data: ChangePermissionRequest | FormData
): Promise<ApiEnvelope<MutationData>> => {
  const id = getUserId(data);
  return requestApi(
    {
      url: `/api/v1/users/${id}/permissions`,
      method: "put",
      data,
    },
    decodeMutationData
  );
};

// Change own password
export const changePassword = (
  data: ChangePasswordRequest | FormData
): Promise<ApiEnvelope<string>> =>
  requestApi(
    {
      url: "/api/v1/users/me/password",
      method: "put",
      data,
    },
    decodeString
  );

// Add user (admin-created account, D5)
export const addUser = (
  data: CreateUserRequest | FormData
): Promise<ApiEnvelope<string>> =>
  requestApi(
    {
      url: "/api/v1/users",
      method: "post",
      data,
    },
    decodeString
  );

// Unlock user (RESTful: user id in path, no request body)
export const unlockUser = (userId: number): Promise<ApiEnvelope<string>> =>
  requestApi(
    {
      url: `/api/v1/users/${userId}/unlock`,
      method: "post",
    },
    decodeString
  );

// Get user profile (backend reads email from JWT and ignores ?email=, frontend still passes it for compatibility)
export const getUserProfile = (
  email: string
): Promise<ApiEnvelope<UserProfileResponse>> =>
  requestApi(
    {
      url: "/api/v1/users/me",
      method: "get",
      params: { email },
    },
    decodeUserProfileResponse
  );
