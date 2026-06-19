import { watch, nextTick } from "vue";
import type { Ref, WritableComputedRef } from "vue";
import type { UploadFile } from "../types";

export function useFileUpload(opts: {
  fileList: WritableComputedRef<UploadFile[]>;
  currentChatId: Ref<string>;
  getChatState: (dialogueId: string) => any;
  senderRef: Ref<any>;
  scrollToBottom: () => void;
}) {
  const { fileList, currentChatId, getChatState, senderRef, scrollToBottom } =
    opts;

  // 监听文件列表 控制列表显示
  watch(
    () => fileList.value,
    (newVal, oldVal) => {
      if (newVal?.length > 0 && senderRef.value) {
        senderRef.value.openHeader();
      } else if (senderRef.value) {
        senderRef.value.closeHeader();
      }
    }
  );

  // 文件处理相关函数
  const handleFileChange = (file: any) => {
    if (!currentChatId.value) {
      return;
    }

    const chatState = getChatState(currentChatId.value);
    if (!chatState) {
      return;
    }

    const newFile: UploadFile = {
      name: file.name,
      size: file.size,
      type: file.type,
      file: file.raw,
    };

    // 使用响应式更新方式
    chatState.fileList = [...chatState.fileList, newFile];

    // 确保文件列表更新后立即显示
    nextTick(() => {
      if (senderRef.value && chatState.fileList.length > 0) {
        senderRef.value.openHeader();
      }

      // 确保滚动到底部
      scrollToBottom();
    });
  };

  const removeFile = (index: number) => {
    if (!currentChatId.value) return;

    const chatState = getChatState(currentChatId.value);
    if (!chatState) return;

    // 使用响应式更新方式
    const newFileList = [...chatState.fileList];
    newFileList.splice(index, 1);
    chatState.fileList = newFileList;

    // 如果文件列表为空，关闭header
    nextTick(() => {
      if (senderRef.value && chatState.fileList.length === 0) {
        senderRef.value.closeHeader();
      }

      // 确保滚动到底部
      scrollToBottom();
    });
  };

  return { handleFileChange, removeFile };
}
