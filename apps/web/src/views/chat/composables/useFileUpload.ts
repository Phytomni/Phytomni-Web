import { watch, nextTick } from "vue";
import type { Ref, WritableComputedRef } from "vue";
import type { ChatComposerHandle, UploadFile } from "../types";

export function useFileUpload(opts: {
  fileList: WritableComputedRef<UploadFile[]>;
  currentChatId: Ref<string>;
  getChatState: (dialogueId: string) => any;
  composerRef: Ref<ChatComposerHandle | null>;
  scrollToBottom: () => void;
}) {
  const { fileList, currentChatId, getChatState, composerRef, scrollToBottom } =
    opts;

  // watch the file list to control list visibility
  watch(
    () => fileList.value,
    (newVal, oldVal) => {
      if (newVal?.length > 0 && composerRef.value) {
        composerRef.value.openHeader();
      } else if (composerRef.value) {
        composerRef.value.closeHeader();
      }
    }
  );

  // file-handling functions
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

    // update reactively
    chatState.fileList = [...chatState.fileList, newFile];

    // show the list immediately after it updates
    nextTick(() => {
      if (composerRef.value && chatState.fileList.length > 0) {
        composerRef.value.openHeader();
      }

      // ensure it scrolls to the bottom
      scrollToBottom();
    });
  };

  const removeFile = (index: number) => {
    if (!currentChatId.value) return;

    const chatState = getChatState(currentChatId.value);
    if (!chatState) return;

    // update reactively
    const newFileList = [...chatState.fileList];
    newFileList.splice(index, 1);
    chatState.fileList = newFileList;

    // close the header if the file list is empty
    nextTick(() => {
      if (composerRef.value && chatState.fileList.length === 0) {
        composerRef.value.closeHeader();
      }

      // ensure it scrolls to the bottom
      scrollToBottom();
    });
  };

  return { handleFileChange, removeFile };
}
