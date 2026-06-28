import request from "@/utils/request";

// Gene list
export const getGeneList = (params?: {
  title?: string;
  current?: number;
  size?: number;
}) => {
  return request({
    url: "/api/v1/genes",
    method: "get",
    params,
  });
};
// Gene detail
export const getGeneDetails = (params?: {
  file_name?: string;
  current?: number;
  size?: number;
}) => {
  return request({
    url: `/api/v1/genes/${encodeURIComponent(params?.file_name ?? "")}`,
    method: "get",
  });
};
