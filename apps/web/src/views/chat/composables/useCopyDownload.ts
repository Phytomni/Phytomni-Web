import { ElMessage } from "element-plus";
import type { WritableComputedRef } from "vue";
import { getChatdownloadURL, getFileDownUrlApi } from "@/api/chat";
import { createTransferTracker } from "@/utils/transfer-progress";
import {
  removeDownloadTransfer,
  upsertDownloadTransfer,
} from "@/utils/download-transfers";

let renderingFileDownloadSeq = 0;

function isCanceledRequest(error: unknown): boolean {
  const err = error as { code?: unknown; name?: unknown };
  return err?.code === "ERR_CANCELED" || err?.name === "CanceledError";
}

export function useCopyDownload(opts: {
  copyVisible: WritableComputedRef<number>;
  copyTimeRef: WritableComputedRef<ReturnType<typeof setTimeout> | undefined>;
  t: (key: string) => string;
}) {
  const { copyVisible, copyTimeRef, t } = opts;

  const updateCopyIconHandler = (index: number, delay = 3000) => {
    copyVisible.value = index;
    if (copyTimeRef.value) {
      clearTimeout(copyTimeRef.value);
    }
    copyTimeRef.value = setTimeout(() => {
      copyVisible.value = 0;
    }, delay);
  };

  // copy the conversation
  const textAreaCopyCore = (text: any, index: number) => {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    // move the textarea off-viewport and make it invisible
    textArea.style.position = "absolute";
    textArea.style.opacity = "0";
    textArea.style.left = "-999999px";
    textArea.style.top = "-999999px";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    document.execCommand("copy");
    updateCopyIconHandler(index);
    textArea.remove();
    ElMessage.success(t("chat.copySuccess"));
  };

  const fallbackCopyText = (text: any, index: number) => {
    try {
      if (window.isSecureContext) {
        navigator.clipboard.writeText(text);
        updateCopyIconHandler(index);
        ElMessage.success(t("chat.copySuccess"));
      } else {
        textAreaCopyCore(text, index);
      }
    } catch {
      ElMessage.error(t("chat.copyFailed"));
    }
  };

  // sign and open an internal OBS download reference
  const downloadFile = async (downloadPath: string) => {
    if (!downloadPath) return;
    const res = await getChatdownloadURL({ obs_path: downloadPath });
    if (res.code == 200 && res.data) {
      window.open(res.data, "_blank", "noopener,noreferrer");
    }
  };

  // download the converted file link for the conversation
  const getFileDownUrl = async (id: string, type: string) => {
    // call getFileDownUrlApi to get the download link
    const queryData = new FormData();
    queryData.append("document_format", type);
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
      // extract the filename from the response headers
      const contentDisposition = response.headers["content-disposition"];
      let fileName = "default_filename"; // default filename
      if (contentDisposition) {
        const fileNameMatch = contentDisposition.match(
          /filename="?(.+?)"?(;|$)/i
        );
        if (fileNameMatch && fileNameMatch[1]) {
          fileName = fileNameMatch[1];
        }
      }
      const blob = new Blob([response.data], {
        type: response.headers["content-type"],
      });

      // create the download link
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = fileName; // set the download filename
      document.body.appendChild(link);
      link.click();

      // clean up
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
  };

  return { fallbackCopyText, downloadFile, getFileDownUrl };
}
