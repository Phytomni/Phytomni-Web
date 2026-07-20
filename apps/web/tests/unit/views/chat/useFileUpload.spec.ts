import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref, nextTick } from "vue";
import { useFileUpload } from "@/views/chat/composables/useFileUpload";
import type { ChatComposerHandle } from "@/views/chat/types";

describe("useFileUpload", () => {
  let chatState: { fileList: any[] };
  let fileList: ReturnType<typeof ref<any[]>>;
  let currentChatId: ReturnType<typeof ref<string>>;
  let getChatState: (dialogueId: string) => any;
  let composerRef: ReturnType<typeof ref<ChatComposerHandle | null>>;
  let scrollToBottom: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    chatState = { fileList: [] };
    fileList = ref([]);
    currentChatId = ref("d1");
    getChatState = () => chatState;
    composerRef = ref({
      openHeader: vi.fn(),
      closeHeader: vi.fn(),
      popoverVisible: false,
    });
    scrollToBottom = vi.fn();
  });

  function makeComposable() {
    return useFileUpload({
      fileList: fileList as any,
      currentChatId,
      getChatState,
      composerRef,
      scrollToBottom,
    });
  }

  it("handleFileChange adds a file to chatState.fileList and calls openHeader", async () => {
    const { handleFileChange } = makeComposable();

    const rawFile = new File(["content"], "a.txt", { type: "text/plain" });
    handleFileChange({
      name: "a.txt",
      size: 10,
      type: "text/plain",
      raw: rawFile,
    });

    expect(chatState.fileList).toHaveLength(1);
    expect(chatState.fileList[0].name).toBe("a.txt");
    expect(chatState.fileList[0].size).toBe(10);
    expect(chatState.fileList[0].type).toBe("text/plain");
    expect(chatState.fileList[0].file).toBe(rawFile);

    await nextTick();
    expect(composerRef.value!.openHeader).toHaveBeenCalled();
    expect(scrollToBottom).toHaveBeenCalled();
  });

  it("handleFileChange ignores an Element Plus file without a raw browser File", async () => {
    const { handleFileChange } = makeComposable();

    handleFileChange({
      name: "invalid.txt",
      size: 10,
      type: "text/plain",
      raw: undefined,
    });

    expect(chatState.fileList).toHaveLength(0);
    await nextTick();
    expect(composerRef.value!.openHeader).not.toHaveBeenCalled();
    expect(scrollToBottom).not.toHaveBeenCalled();
  });

  it("removeFile removes a file from chatState.fileList and calls closeHeader when empty", async () => {
    const { removeFile } = makeComposable();

    chatState.fileList = [
      { name: "b.txt", size: 5, type: "text/plain", file: null },
    ];

    removeFile(0);

    expect(chatState.fileList).toHaveLength(0);

    await nextTick();
    expect(composerRef.value!.closeHeader).toHaveBeenCalled();
    expect(scrollToBottom).toHaveBeenCalled();
  });

  it("watch: openHeader when fileList becomes non-empty", async () => {
    makeComposable();

    fileList.value = [
      { name: "c.txt", size: 3, type: "text/plain", file: null },
    ];
    await nextTick();

    expect(composerRef.value!.openHeader).toHaveBeenCalled();
  });

  it("watch: closeHeader when fileList becomes empty", async () => {
    makeComposable();

    // First make it non-empty to trigger openHeader
    fileList.value = [
      { name: "d.txt", size: 3, type: "text/plain", file: null },
    ];
    await nextTick();
    vi.clearAllMocks();

    // Now clear it
    fileList.value = [];
    await nextTick();

    expect(composerRef.value!.closeHeader).toHaveBeenCalled();
  });
});
