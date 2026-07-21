import { watch, nextTick } from "vue";
import type { Ref, WritableComputedRef } from "vue";
import type { UploadFile as ElementUploadFile } from "element-plus";
import type { ChatComposerHandle, ChatUIState, UploadFile } from "../types";

export const CHAT_ATTACHMENT_LIMITS = Object.freeze({
  maxFileBytes: 25 * 1024 * 1024,
  maxTotalBytes: 50 * 1024 * 1024,
  maxFiles: 10,
});

export const CHAT_ATTACHMENT_ACCEPT =
  ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.png";

export type ChatAttachmentValidationError = {
  code:
    | "unsupported_type"
    | "file_too_large"
    | "total_too_large"
    | "too_many_files";
  fileName?: string;
};

const supportedExtensions = new Set(CHAT_ATTACHMENT_ACCEPT.split(","));

const fileExtension = (name: string): string => {
  const dotIndex = name.lastIndexOf(".");
  return dotIndex >= 0 ? name.slice(dotIndex).toLowerCase() : "";
};

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
  scrollToBottom: () => Promise<void>;
  onValidationError?: (error: ChatAttachmentValidationError) => void;
}) {
  const {
    fileList,
    currentChatId,
    getChatState,
    composerRef,
    scrollToBottom,
    onValidationError,
  } = opts;

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

  const appendBrowserFiles = (files: readonly File[]) => {
    if (!currentChatId.value) {
      return;
    }

    const chatState = getChatState(currentChatId.value);
    if (!chatState) {
      return;
    }

    const nextFiles = [...chatState.fileList];
    let totalBytes = nextFiles.reduce((total, file) => total + file.size, 0);
    let added = false;
    for (const file of files) {
      if (nextFiles.length >= CHAT_ATTACHMENT_LIMITS.maxFiles) {
        onValidationError?.({ code: "too_many_files", fileName: file.name });
        continue;
      }
      if (!supportedExtensions.has(fileExtension(file.name))) {
        onValidationError?.({ code: "unsupported_type", fileName: file.name });
        continue;
      }
      if (file.size > CHAT_ATTACHMENT_LIMITS.maxFileBytes) {
        onValidationError?.({ code: "file_too_large", fileName: file.name });
        continue;
      }
      if (totalBytes + file.size > CHAT_ATTACHMENT_LIMITS.maxTotalBytes) {
        onValidationError?.({ code: "total_too_large", fileName: file.name });
        continue;
      }

      nextFiles.push({
        name: file.name,
        size: file.size,
        type: file.type,
        file,
      });
      totalBytes += file.size;
      added = true;
    }

    if (!added) return;
    chatState.fileList = nextFiles;

    // show the list immediately after it updates
    nextTick(() => {
      if (composerRef.value && chatState.fileList.length > 0) {
        composerRef.value.openHeader();
      }

      // ensure it scrolls to the bottom
      scrollToBottom().catch(() => undefined);
    }).catch(() => undefined);
  };

  // File picker and clipboard paste deliberately share one validation path.
  const handleFileChange = (file: unknown) => {
    if (!isElementUploadFile(file) || !file.raw) return;
    appendBrowserFiles([file.raw]);
  };

  const handlePastedFiles = (files: readonly File[]) => {
    appendBrowserFiles(files);
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
      scrollToBottom().catch(() => undefined);
    }).catch(() => undefined);
  };

  return { handleFileChange, handlePastedFiles, removeFile };
}
