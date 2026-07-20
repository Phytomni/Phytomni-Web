import { AxiosError } from "axios";
import type { ChatResponse } from "@/views/chat/types";

export type AxiosErrorOverrides<T = unknown, D = unknown> = Partial<
  Pick<
    AxiosError<T, D>,
    "message" | "code" | "config" | "request" | "response" | "status"
  >
>;

export function buildChatResponse(
  overrides: Partial<ChatResponse> = {}
): ChatResponse {
  return {
    query: "fixture question",
    answer: "fixture answer",
    ...overrides,
  };
}

export function buildAxiosError<T = unknown, D = unknown>(
  overrides: AxiosErrorOverrides<T, D> = {}
): AxiosError<T, D> {
  const error = new AxiosError<T, D>(
    overrides.message ?? "fixture request failed",
    overrides.code,
    overrides.config,
    overrides.request,
    overrides.response
  );

  if (overrides.status !== undefined) {
    error.status = overrides.status;
  }
  return error;
}
