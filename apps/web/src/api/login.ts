import type { ApiEnvelope, LoginRequest, LoginResponse } from "@/api/types";
import { decodeLoginResponse, decodeString, requestApi } from "@/api/types";

// Login (create session)
export const login = (
  data: LoginRequest | FormData
): Promise<ApiEnvelope<LoginResponse>> =>
  requestApi(
    {
      url: "/api/v1/auth/sessions",
      method: "post",
      data,
    },
    decodeLoginResponse
  );

export const logout = (): Promise<ApiEnvelope<string>> =>
  requestApi(
    {
      url: "/api/v1/auth/logout",
      method: "post",
      suppressErrorToast: true,
      skipSessionExpired: true,
    },
    decodeString
  );
