import { ElMessage } from "element-plus";
import type { WritableComputedRef } from "vue";
import { getChatdownloadURL, getFileDownUrlApi } from "@/api/chat";

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

  //copy复制对话
  const textAreaCopyCore = (text: any, index: number) => {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    // 使text area不在viewport，同时设置不可见
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

  // 下载链接
  const downloadFile = async (url: string) => {
    // 在这里调用 getChatdownloadURL 接口 获取下载链接
    const res = await getChatdownloadURL({ obs_path: url });
    if (res.code == 200) {
      window.open(res.data, "_blank", "noopener,noreferrer");
    }
  };

  // 直接下载文件（基于 download_path）
  const downloadFileDirect = (downloadPath: string) => {
    if (downloadPath) {
      window.open(downloadPath, "_blank", "noopener,noreferrer");
    }
  };

  // 下载对话转换后的文件接链接
  const getFileDownUrl = async (id: string, type: string) => {
    // 在这里调用 getFileDownUrlApi 接口 获取下载链接
    const queryData = new FormData();
    queryData.append("document_format", type);
    queryData.append("id", (id ? Number(id) : 0).toString());
    try {
      const response = await getFileDownUrlApi(queryData);
      // 从响应头中提取文件名
      const contentDisposition = response.headers["content-disposition"];
      let fileName = "default_filename"; // 默认文件名
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

      // 创建下载链接
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = fileName; // 设置下载文件名
      document.body.appendChild(link);
      link.click();

      // 清理资源
      window.URL.revokeObjectURL(downloadUrl);
      document.body.removeChild(link);
    } catch (error) {
      console.error("下载文件失败:", error);
    }
  };

  return { fallbackCopyText, downloadFile, downloadFileDirect, getFileDownUrl };
}
