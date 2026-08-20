import { ElMessage } from "element-plus";
import type { WritableComputedRef } from "vue";
import { getChatdownloadURL } from "@/api/chat";
import { downloadRenderingFile } from "@/utils/download-rendering-file";

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
  const textAreaCopyCore = (text: string, index: number) => {
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

  const fallbackCopyText = (text: string, index: number) => {
    if (text.trim() === "") {
      ElMessage.error(t("chat.copyFailed"));
      return;
    }
    try {
      if (window.isSecureContext) {
        navigator.clipboard
          .writeText(text)
          .then(() => {
            updateCopyIconHandler(index);
            ElMessage.success(t("chat.copySuccess"));
          })
          .catch(() => {
            ElMessage.error(t("chat.copyFailed"));
          });
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

  const getFileDownUrl = async (id: string, type: string) => {
    await downloadRenderingFile(id, type, t);
  };

  return { fallbackCopyText, downloadFile, getFileDownUrl };
}
