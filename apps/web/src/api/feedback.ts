import type {
  ApiEnvelope,
  FeedbackRequest,
  FeedbackResponse,
} from "@/api/types";
import { decodeFeedbackResponse, requestApi } from "@/api/types";

// User feedback
export const feedback = (
  data: FeedbackRequest | FormData
): Promise<ApiEnvelope<FeedbackResponse>> =>
  requestApi(
    {
      url: "/api/v1/user-feedback",
      method: "post",
      data,
    },
    decodeFeedbackResponse
  );
