import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  computed,
  ref,
  nextTick,
  type Ref,
  type WritableComputedRef,
} from "vue";
import type {
  UploadFile as ElementUploadFile,
  UploadRawFile,
} from "element-plus";
import {
  CHAT_ATTACHMENT_LIMITS,
  useFileUpload,
} from "@/views/chat/composables/useFileUpload";
import type {
  ChatComposerHandle,
  ChatUIState,
  ResumableUploadItem,
} from "@/views/chat/types";
import { buildChatState } from "../../../helpers/chatBuilders";
import { mustGet } from "../../../helpers/mockFactories";

describe("useFileUpload", () => {
  let chatState: ChatUIState;
  let fileList: Ref<ResumableUploadItem[]>;
  let currentChatId: Ref<string>;
  let getChatState: (dialogueId: string) => ChatUIState;
  let composerRef: Ref<ChatComposerHandle | null>;
  let scrollToBottom: ReturnType<typeof vi.fn<() => Promise<void>>>;
  let onValidationError: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    chatState = buildChatState();
    fileList = ref<ResumableUploadItem[]>([]);
    currentChatId = ref("d1");
    getChatState = () => chatState;
    composerRef = ref({
      openHeader: vi.fn(),
      closeHeader: vi.fn(),
      popoverVisible: false,
    });
    scrollToBottom = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    onValidationError = vi.fn();
  });

  function writableRef<T>(source: Ref<T>): WritableComputedRef<T> {
    return computed({
      get: () => source.value,
      set: (value: T) => {
        source.value = value;
      },
    });
  }

  function rawFile(name: string, content = "content"): UploadRawFile {
    return Object.assign(new File([content], name, { type: "text/plain" }), {
      uid: 1,
    });
  }

  function elementFile(
    name: string,
    raw: UploadRawFile | undefined,
    size = raw?.size
  ): ElementUploadFile {
    return {
      name,
      status: "ready",
      uid: 1,
      size,
      raw,
    };
  }

  function uploadItem(
    file: File,
    localId = "upload-fixture"
  ): ResumableUploadItem {
    return {
      localId,
      file,
      assetId: null,
      name: file.name,
      size: file.size,
      type: file.type,
      lastModified: file.lastModified,
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

  function makeComposable(
    overrides: Partial<Parameters<typeof useFileUpload>[0]> = {}
  ) {
    return useFileUpload({
      fileList: writableRef(fileList),
      currentChatId,
      getChatState,
      composerRef,
      scrollToBottom,
      onValidationError,
      ...overrides,
    });
  }

  function sizedFile(
    name: string,
    size: number,
    type = "application/octet-stream"
  ): File {
    const file = new File(["x"], name, { type });
    Object.defineProperty(file, "size", { value: size });
    return file;
  }

  it("adapts picker files into the resumable queue item shape", async () => {
    const { handleFileChange } = makeComposable();
    const browserFile = rawFile("a.txt");

    handleFileChange(elementFile("a.txt", browserFile));

    expect(chatState.fileList).toHaveLength(1);
    expect(chatState.fileList[0]).toEqual(
      expect.objectContaining({
        name: "a.txt",
        size: browserFile.size,
        type: "text/plain",
        file: browserFile,
        status: "queued",
      })
    );
    await nextTick();
    expect(
      mustGet(composerRef.value, "composer").openHeader
    ).toHaveBeenCalled();
    expect(scrollToBottom).toHaveBeenCalled();
  });

  it("forwards accepted files to the queue without applying an extension allowlist", () => {
    const queueFiles = vi.fn();
    const { handlePastedFiles } = makeComposable({ queueFiles });
    const pasted = sizedFile("reads.fastq.gz", 128, "application/gzip");

    handlePastedFiles([pasted]);

    expect(queueFiles).toHaveBeenCalledWith([pasted], "document");
    expect(chatState.fileList).toHaveLength(0);
    expect(onValidationError).not.toHaveBeenCalled();
  });

  it("accepts files through the inclusive 10 GiB limit and rejects only larger files", () => {
    const { handlePastedFiles } = makeComposable();
    const max = CHAT_ATTACHMENT_LIMITS.maxFileBytes;

    handlePastedFiles([
      sizedFile("sample.bam", max, "application/octet-stream"),
    ]);
    expect(chatState.fileList).toHaveLength(1);
    expect(onValidationError).not.toHaveBeenCalled();

    chatState.fileList = [];
    onValidationError.mockClear();
    handlePastedFiles([sizedFile("sample.bam", max + 1)]);
    expect(chatState.fileList).toHaveLength(0);
    expect(onValidationError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "invalid_size", fileName: "sample.bam" })
    );
  });

  it("enforces the ten-file limit for selection and paste", () => {
    const { handlePastedFiles } = makeComposable();
    chatState.fileList = Array.from(
      { length: CHAT_ATTACHMENT_LIMITS.maxFiles },
      (_, index) =>
        uploadItem(sizedFile(`existing-${index}.txt`, 1), `existing-${index}`)
    );

    handlePastedFiles([sizedFile("extra.txt", 1)]);

    expect(chatState.fileList).toHaveLength(CHAT_ATTACHMENT_LIMITS.maxFiles);
    expect(onValidationError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "too_many_files" })
    );
  });

  it("removes a queued item and closes the composer when the queue becomes empty", async () => {
    const { removeFile } = makeComposable();
    chatState.fileList = [uploadItem(rawFile("b.txt", "12345"))];

    removeFile(0);

    expect(chatState.fileList).toHaveLength(0);
    await nextTick();
    expect(
      mustGet(composerRef.value, "composer").closeHeader
    ).toHaveBeenCalled();
    expect(scrollToBottom).toHaveBeenCalled();
  });

  it("uses the supplied remove callback for an engine-owned item", async () => {
    const removeUpload = vi.fn();
    const item = uploadItem(rawFile("c.txt"));
    chatState.fileList = [item];
    const { removeFile } = makeComposable({ removeUpload });

    removeFile(0);
    await Promise.resolve();

    expect(removeUpload).toHaveBeenCalledWith(item);
    expect(chatState.fileList).toEqual([item]);
  });

  it("ignores an Element Plus file without a raw browser File", async () => {
    const { handleFileChange } = makeComposable();

    handleFileChange(elementFile("invalid.txt", undefined, 10));

    expect(chatState.fileList).toHaveLength(0);
    await nextTick();
    expect(
      mustGet(composerRef.value, "composer").openHeader
    ).not.toHaveBeenCalled();
    expect(scrollToBottom).not.toHaveBeenCalled();
  });

  it("keeps the header synchronized with the queue", async () => {
    makeComposable();
    fileList.value = [uploadItem(rawFile("d.txt", "123"))];
    await nextTick();
    expect(
      mustGet(composerRef.value, "composer").openHeader
    ).toHaveBeenCalled();

    vi.clearAllMocks();
    fileList.value = [];
    await nextTick();
    expect(
      mustGet(composerRef.value, "composer").closeHeader
    ).toHaveBeenCalled();
  });
});
