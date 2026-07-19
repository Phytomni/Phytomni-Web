import type { ApiEnvelope, LoginRequest, LoginResponse } from "@/api/types";
import { decodeLoginResponse, requestApi } from "@/api/types";

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
