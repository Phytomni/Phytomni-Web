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
  UploadFile,
} from "@/views/chat/types";
import { buildChatState } from "../../../helpers/chatBuilders";
import { mustGet } from "../../../helpers/mockFactories";

describe("useFileUpload", () => {
  let chatState: ChatUIState;
  let fileList: Ref<UploadFile[]>;
  let currentChatId: Ref<string>;
  let getChatState: (dialogueId: string) => ChatUIState;
  let composerRef: Ref<ChatComposerHandle | null>;
  let scrollToBottom: ReturnType<typeof vi.fn<() => Promise<void>>>;
  let onValidationError: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    chatState = buildChatState();
    fileList = ref<UploadFile[]>([]);
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

  function makeComposable() {
    return useFileUpload({
      fileList: writableRef(fileList),
      currentChatId,
      getChatState,
      composerRef,
      scrollToBottom,
      onValidationError,
    });
  }

  function sizedFile(name: string, size: number): File {
    const file = new File(["x"], name, { type: "application/octet-stream" });
    Object.defineProperty(file, "size", { value: size });
    return file;
  }

  it("handleFileChange adds a file to chatState.fileList and calls openHeader", async () => {
    const { handleFileChange } = makeComposable();

    const browserFile = rawFile("a.txt");
    handleFileChange({ ...elementFile("a.txt", browserFile), size: 10 });

    expect(chatState.fileList).toHaveLength(1);
    const uploaded = mustGet(chatState.fileList[0], "uploaded file");
    expect(uploaded.name).toBe("a.txt");
    expect(uploaded.size).toBe(browserFile.size);
    expect(uploaded.type).toBe("text/plain");
    expect(uploaded.file).toBe(browserFile);

    await nextTick();
    expect(
      mustGet(composerRef.value, "composer").openHeader
    ).toHaveBeenCalled();
    expect(scrollToBottom).toHaveBeenCalled();
  });

  it("handleFileChange ignores an Element Plus file without a raw browser File", async () => {
    const { handleFileChange } = makeComposable();

    handleFileChange(elementFile("invalid.txt", undefined, 10));

    expect(chatState.fileList).toHaveLength(0);
    await nextTick();
    expect(
      mustGet(composerRef.value, "composer").openHeader
    ).not.toHaveBeenCalled();
    expect(scrollToBottom).not.toHaveBeenCalled();
  });

  it("accepts pasted files through the same validation path", async () => {
    const { handlePastedFiles } = makeComposable();
    const pasted = sizedFile("notes.docx", 128);

    handlePastedFiles([pasted]);

    expect(chatState.fileList).toEqual([
      expect.objectContaining({ name: "notes.docx", size: 128, file: pasted }),
    ]);
    expect(onValidationError).not.toHaveBeenCalled();
    await nextTick();
    expect(scrollToBottom).toHaveBeenCalled();
  });

  it("rejects unsupported CSV until the agent capability contract advertises a dataset channel", () => {
    const { handlePastedFiles } = makeComposable();

    handlePastedFiles([sizedFile("dataset.csv", 128)]);

    expect(chatState.fileList).toHaveLength(0);
    expect(onValidationError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "unsupported_type",
        fileName: "dataset.csv",
      })
    );
  });

  it("rejects a 58 MB file before upload and enforces the aggregate limit", () => {
    const { handlePastedFiles } = makeComposable();

    handlePastedFiles([sizedFile("oversized.xlsx", 58 * 1024 * 1024)]);
    expect(chatState.fileList).toHaveLength(0);
    expect(onValidationError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "file_too_large" })
    );

    onValidationError.mockClear();
    chatState.fileList = [
      {
        name: "first.xlsx",
        size: CHAT_ATTACHMENT_LIMITS.maxTotalBytes - 10,
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        file: sizedFile(
          "first.xlsx",
          CHAT_ATTACHMENT_LIMITS.maxTotalBytes - 10
        ),
      },
    ];
    handlePastedFiles([sizedFile("second.txt", 11)]);
    expect(chatState.fileList).toHaveLength(1);
    expect(onValidationError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "total_too_large" })
    );
  });

  it("enforces the ten-file limit for selection and paste", () => {
    const { handlePastedFiles } = makeComposable();
    chatState.fileList = Array.from(
      { length: CHAT_ATTACHMENT_LIMITS.maxFiles },
      (_, index) => ({
        name: `existing-${index}.txt`,
        size: 1,
        type: "text/plain",
        file: sizedFile(`existing-${index}.txt`, 1),
      })
    );

    handlePastedFiles([sizedFile("extra.txt", 1)]);

    expect(chatState.fileList).toHaveLength(CHAT_ATTACHMENT_LIMITS.maxFiles);
    expect(onValidationError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "too_many_files" })
    );
  });

  it("removeFile removes a file from chatState.fileList and calls closeHeader when empty", async () => {
    const { removeFile } = makeComposable();

    chatState.fileList = [
      {
        name: "b.txt",
        size: 5,
        type: "text/plain",
        file: rawFile("b.txt", "12345"),
      },
    ];

    removeFile(0);

    expect(chatState.fileList).toHaveLength(0);

    await nextTick();
    expect(
      mustGet(composerRef.value, "composer").closeHeader
    ).toHaveBeenCalled();
    expect(scrollToBottom).toHaveBeenCalled();
  });

  it("watch: openHeader when fileList becomes non-empty", async () => {
    makeComposable();

    fileList.value = [
      {
        name: "c.txt",
        size: 3,
        type: "text/plain",
        file: rawFile("c.txt", "123"),
      },
    ];
    await nextTick();

    expect(
      mustGet(composerRef.value, "composer").openHeader
    ).toHaveBeenCalled();
  });

  it("watch: closeHeader when fileList becomes empty", async () => {
    makeComposable();

    // First make it non-empty to trigger openHeader
    fileList.value = [
      {
        name: "d.txt",
        size: 3,
        type: "text/plain",
        file: rawFile("d.txt", "123"),
      },
    ];
    await nextTick();
    vi.clearAllMocks();

    // Now clear it
    fileList.value = [];
    await nextTick();

    expect(
      mustGet(composerRef.value, "composer").closeHeader
    ).toHaveBeenCalled();
  });
});
