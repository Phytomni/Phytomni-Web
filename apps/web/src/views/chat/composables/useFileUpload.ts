import { watch, nextTick } from "vue";
import type { Ref, WritableComputedRef } from "vue";
import type { UploadFile as ElementUploadFile } from "element-plus";
import type { ChatComposerHandle, ChatUIState, UploadFile } from "../types";

const isElementUploadFile = (value: unknown): value is ElementUploadFile => {
  if (typeof value !== "object" || value === null) return false;
  const file = value as Partial<ElementUploadFile>;
  return (
    typeof file.name === "string" &&
    typeof File !== "undefined" &&
    file.raw instanceof File
  );
};

export function useFileUpload(opts: {
  fileList: WritableComputedRef<UploadFile[]>;
  currentChatId: Ref<string>;
  getChatState: (dialogueId: string) => ChatUIState;
  composerRef: Ref<ChatComposerHandle | null>;
  scrollToBottom: () => void;
}) {
  const { fileList, currentChatId, getChatState, composerRef, scrollToBottom } =
    opts;

  // watch the file list to control list visibility
  watch(
    () => fileList.value,
    (newVal) => {
      if (newVal?.length > 0 && composerRef.value) {
        composerRef.value.openHeader();
      } else if (composerRef.value) {
        composerRef.value.closeHeader();
      }
    }
  );

  // file-handling functions
  const handleFileChange = (file: unknown) => {
    if (!currentChatId.value) {
      return;
    }

    if (!isElementUploadFile(file)) {
      return;
    }
    const rawFile = file.raw;
    if (!rawFile) return;

    const chatState = getChatState(currentChatId.value);
    if (!chatState) {
      return;
    }

    const newFile: UploadFile = {
      name: file.name,
      size: file.size ?? rawFile.size,
      type: rawFile.type,
      file: rawFile,
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
