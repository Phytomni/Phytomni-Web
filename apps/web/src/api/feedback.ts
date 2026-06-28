import request from "@/utils/request";

// User feedback
export const feedback = (
  data: { feedback_type: string; feedback_content: string } | FormData
) => {
  return request({
    url: "/api/v1/user-feedback",
    method: "post",
    data: data,
  });
};
