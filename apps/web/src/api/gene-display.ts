import type { ApiEnvelope, GeneDetail, GeneListResponse } from "@/api/types";
import {
  decodeGeneDetailResponse,
  decodeGeneListResponse,
  requestApi,
} from "@/api/types";

export interface GeneListQuery {
  title?: string;
  current?: number;
  size?: number;
}

export interface GeneDetailQuery {
  file_name?: string;
  current?: number;
  size?: number;
}

// Gene list
export const getGeneList = (
  params?: GeneListQuery
): Promise<ApiEnvelope<GeneListResponse>> =>
  requestApi(
    {
      url: "/api/v1/genes",
      method: "get",
      params,
    },
    decodeGeneListResponse
  );

// Gene detail
export const getGeneDetails = (
  params?: GeneDetailQuery
): Promise<ApiEnvelope<GeneDetail>> =>
  requestApi(
    {
      url: `/api/v1/genes/${encodeURIComponent(params?.file_name ?? "")}`,
      method: "get",
    },
    decodeGeneDetailResponse
  );
