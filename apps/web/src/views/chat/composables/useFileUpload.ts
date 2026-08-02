import { nextTick, watch } from "vue";
import type { Ref, WritableComputedRef } from "vue";
import type { UploadFile as ElementUploadFile } from "element-plus";
import type { ChatComposerHandle, ChatUIState } from "../types";
import type { ResumableUploadItem, UploadPurpose } from "../upload/types";
import {
  RESUMABLE_UPLOAD_LIMITS,
  validateUploadFile,
  type UploadValidationErrorCode,
} from "../upload/validation";

/** Legacy names retained for the composer contract until ChatUploadCard lands. */
export const CHAT_ATTACHMENT_LIMITS = Object.freeze({
  maxFileBytes: RESUMABLE_UPLOAD_LIMITS.maxFileBytes,
  maxTotalBytes: RESUMABLE_UPLOAD_LIMITS.maxFileBytes,
  maxFiles: RESUMABLE_UPLOAD_LIMITS.maxAttachments,
});

export type ChatAttachmentValidationError = {
  code: UploadValidationErrorCode | "upload_disabled" | "upload_unavailable";
  fileName?: string;
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

function fallbackItem(
  file: File,
  index: number,
  purpose: UploadPurpose
): ResumableUploadItem {
  return {
    localId: `legacy-upload-${Date.now()}-${index}`,
    file,
    assetId: null,
    name: file.name.normalize("NFC"),
    size: file.size,
    type: file.type,
    lastModified: file.lastModified,
    purpose,
    status: "queued",
    partSize: 0,
    partCount: 0,
    receivedParts: [],
    loadedBytes: 0,
    speedBytesPerSecond: 0,
    etaSeconds: null,
    retryCount: 0,
    errorCode: null,
  };
}
function reportValidation(
  file: File,
  existingCount: number,
  onValidationError?: (error: ChatAttachmentValidationError) => void
): boolean {
  const result = validateUploadFile(file, existingCount);
  if (result.ok) return true;
  onValidationError?.({ code: result.code, fileName: file.name });
  return false;
}

export function useFileUpload(opts: {
  fileList: WritableComputedRef<ResumableUploadItem[]>;
  currentChatId: Ref<string>;
  uploadPurpose: Readonly<Ref<UploadPurpose>>;
  getChatState: (dialogueId: string) => ChatUIState;
  composerRef: Ref<ChatComposerHandle | null>;
  scrollToBottom: () => Promise<void>;
  queueFiles?: (
    files: readonly File[],
    purpose: UploadPurpose
  ) => void | Promise<void>;
  removeUpload?: (item: ResumableUploadItem) => void | Promise<void>;
  onValidationError?: (error: ChatAttachmentValidationError) => void;
}) {
  const {
    fileList,
    currentChatId,
    uploadPurpose,
    getChatState,
    composerRef,
    scrollToBottom,
    queueFiles,
    removeUpload,
    onValidationError,
  } = opts;

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
    if (!currentChatId.value) return;
    const chatState = getChatState(currentChatId.value);
    if (!chatState) return;

    const accepted: File[] = [];
    for (const file of files) {
      if (
        reportValidation(
          file,
          chatState.fileList.length + accepted.length,
          onValidationError
        )
      ) {
        accepted.push(file);
      }
    }
    if (accepted.length === 0) return;
    const purpose = uploadPurpose.value;

    if (queueFiles) {
      Promise.resolve(queueFiles(accepted, purpose)).catch(() => undefined);
    } else {
      chatState.fileList = [
        ...chatState.fileList,
        ...accepted.map((file, index) => fallbackItem(file, index, purpose)),
      ];
    }

    nextTick(() => {
      if (composerRef.value && chatState.fileList.length > 0) {
        composerRef.value.openHeader();
      }
      scrollToBottom().catch(() => undefined);
    }).catch(() => undefined);
  };

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
    const item = chatState.fileList[index];
    if (!item) return;
    if (removeUpload) {
      Promise.resolve(removeUpload(item)).catch(() => undefined);
    } else {
      const nextFiles = [...chatState.fileList];
      nextFiles.splice(index, 1);
      chatState.fileList = nextFiles;
    }

    nextTick(() => {
      if (composerRef.value && chatState.fileList.length === 0) {
        composerRef.value.closeHeader();
      }
      scrollToBottom().catch(() => undefined);
    }).catch(() => undefined);
  };

  return { handleFileChange, handlePastedFiles, removeFile };
}
