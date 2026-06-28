import request from "@/utils/request";

// Login (create session)
export const login = (data: any) => {
  return request({
    url: "/api/v1/auth/sessions",
    method: "post",
    data: data,
  });
};
