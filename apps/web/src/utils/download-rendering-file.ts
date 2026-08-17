import { ElMessage } from "element-plus";
import { getFileDownUrlApi } from "@/api/chat";
import { createTransferTracker } from "@/utils/transfer-progress";
import {
  removeDownloadTransfer,
  upsertDownloadTransfer,
} from "@/utils/download-transfers";

let renderingFileDownloadSeq = 0;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function readResponseHeader(headers: unknown, key: string): string | undefined {
  if (!isRecord(headers)) return undefined;
  const value = headers[key];
  return typeof value === "string" ? value : undefined;
}

function isCanceledRequest(error: unknown): boolean {
  const err = isRecord(error) ? error : undefined;
  return err?.code === "ERR_CANCELED" || err?.name === "CanceledError";
}

export async function downloadRenderingFile(
  id: string,
  format: string,
  t: (key: string) => string
): Promise<void> {
  const queryData = new FormData();
  queryData.append("document_format", format);
  queryData.append("id", (id ? Number(id) : 0).toString());
  const requestId = `rendering-file-${Date.now()}-${++renderingFileDownloadSeq}`;
  const tracker = createTransferTracker({ phase: "download", requestId });
  try {
    const response = await getFileDownUrlApi(queryData, {
      requestId,
      onDownloadProgress: (event) => {
        upsertDownloadTransfer(tracker.update(event));
      },
    });
    const contentDisposition = readResponseHeader(
      response.headers,
      "content-disposition"
    );
    let fileName = "default_filename";
    if (contentDisposition) {
      const fileNameMatch = contentDisposition.match(
        /filename="?(.+?)"?(;|$)/i
      );
      if (fileNameMatch && fileNameMatch[1]) {
        fileName = fileNameMatch[1];
      }
    }
    const blob = new Blob([response.data], {
      type: readResponseHeader(response.headers, "content-type"),
    });

    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();

    window.URL.revokeObjectURL(downloadUrl);
    document.body.removeChild(link);
  } catch (error) {
    if (isCanceledRequest(error)) {
      ElMessage.info(t("chat.downloadCancelled"));
      return;
    }
    console.error("File download failed:", error);
    ElMessage.error(t("chat.downloadError"));
  } finally {
    removeDownloadTransfer(requestId);
  }
}
