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
import { useFileUpload } from "@/views/chat/composables/useFileUpload";
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
    });
  }

  it("handleFileChange adds a file to chatState.fileList and calls openHeader", async () => {
    const { handleFileChange } = makeComposable();

    const browserFile = rawFile("a.txt");
    handleFileChange({ ...elementFile("a.txt", browserFile), size: 10 });

    expect(chatState.fileList).toHaveLength(1);
    const uploaded = mustGet(chatState.fileList[0], "uploaded file");
    expect(uploaded.name).toBe("a.txt");
    expect(uploaded.size).toBe(10);
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
