import type { ApiEnvelope, GeneDetail, GeneListResponse } from "@/api/types";
import type { AxiosResponse } from "axios";
import request from "@/utils/request";
import type { DeepGenomeLoadedMarkdown } from "@/components/research/deep-genome-report";
import { MAX_SCIENTIFIC_TEXT_BYTES } from "@/utils/scientific-markdown/resources";
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

/** IDs come from the current report manifest; no client path becomes a URL. */
export async function getGeneResourceMarkdown(
  fileName: string,
  resourceId: string,
  signal: AbortSignal
): Promise<DeepGenomeLoadedMarkdown> {
  return readGeneResourceText(fileName, resourceId, "markdown", signal);
}

export async function getGeneResourceCif(
  fileName: string,
  resourceId: string,
  signal: AbortSignal
): Promise<string> {
  return (await readGeneResourceText(fileName, resourceId, "cif", signal)).text;
}

async function readGeneResourceText(
  fileName: string,
  resourceId: string,
  kind: "markdown" | "cif",
  signal: AbortSignal
): Promise<{ text: string; bytes: Uint8Array }> {
  const maxBytes = MAX_SCIENTIFIC_TEXT_BYTES;
  if (!/^gene-[a-f0-9]{64}$/.test(resourceId) || signal.aborted) {
    throw new Error("Gene resource unavailable");
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  try {
    const response = await request<AxiosResponse<ArrayBuffer>>({
      url: `/api/v1/genes/${encodeURIComponent(fileName)}/resources/${resourceId}`,
      method: "get",
      responseType: "arraybuffer",
      signal: controller.signal,
      suppressErrorToast: true,
      onDownloadProgress: ({ loaded }) => {
        if (loaded > maxBytes) controller.abort();
      },
    });
    const contentType = String(response.headers?.["content-type"] ?? "").trim();
    const mime = contentType.split(";", 1)[0].trim().toLowerCase();
    if (
      controller.signal.aborted ||
      response.status !== 200 ||
      !(response.data instanceof ArrayBuffer) ||
      response.data.byteLength > maxBytes ||
      !(kind === "cif"
        ? /^chemical\/x-cif(?:\s*;\s*charset\s*=\s*(?:"utf-8"|utf-8))?$/i.test(
            contentType
          )
        : ["text/markdown", "text/plain"].includes(mime))
    ) {
      throw new Error("Gene resource unavailable");
    }
    const bytes = new Uint8Array(response.data);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (
      /^\s*(?:<!doctype\s+html|<html\b)/i.test(text) ||
      (kind === "cif" && !text.trim())
    ) {
      throw new Error("Gene resource unavailable");
    }
    return { text, bytes };
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
