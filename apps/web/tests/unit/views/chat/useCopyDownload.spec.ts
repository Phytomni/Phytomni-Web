import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ref } from "vue";
import { useCopyDownload } from "@/views/chat/composables/useCopyDownload";

// Mock element-plus ElMessage
vi.mock("element-plus", () => ({
  ElMessage: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock both download API modules
vi.mock("@/api/chat", () => ({
  getChatdownloadURL: vi.fn(),
  getFileDownUrlApi: vi.fn(),
}));

import { ElMessage } from "element-plus";
import { getChatdownloadURL, getFileDownUrlApi } from "@/api/chat";

const mockGetChatdownloadURL = vi.mocked(getChatdownloadURL);
const mockGetFileDownUrlApi = vi.mocked(getFileDownUrlApi);
const mockElSuccess = vi.mocked(ElMessage.success);

describe("useCopyDownload", () => {
  let copyVisible: ReturnType<typeof ref<number>>;
  let copyTimeRef: ReturnType<typeof ref<ReturnType<typeof setTimeout> | undefined>>;
  const t = (k: string) => k;

  beforeEach(() => {
    vi.clearAllMocks();
    copyVisible = ref(0);
    copyTimeRef = ref<ReturnType<typeof setTimeout> | undefined>(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function makeComposable() {
    return useCopyDownload({
      copyVisible: copyVisible as any,
      copyTimeRef: copyTimeRef as any,
      t,
    });
  }

  describe("fallbackCopyText", () => {
    it("secure context → calls clipboard.writeText, sets copyVisible, shows success message", () => {
      vi.useFakeTimers();
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal("isSecureContext", true);
      vi.stubGlobal("navigator", { clipboard: { writeText } });

      const { fallbackCopyText } = makeComposable();
      fallbackCopyText("hello", 2);

      expect(writeText).toHaveBeenCalledWith("hello");
      expect(copyVisible.value).toBe(2);
      expect(mockElSuccess).toHaveBeenCalledWith("chat.copySuccess");

      vi.useRealTimers();
    });
  });

  describe("downloadFile", () => {
    it("API returns 200 → window.open opens the returned download link", async () => {
      const open = vi.fn();
      vi.stubGlobal("open", open);
      mockGetChatdownloadURL.mockResolvedValueOnce({
        code: 200,
        data: "http://dl",
      } as any);

      const { downloadFile } = makeComposable();
      await downloadFile("obs://x");

      expect(mockGetChatdownloadURL).toHaveBeenCalledWith({ obs_path: "obs://x" });
      expect(open).toHaveBeenCalledWith(
        "http://dl",
        "_blank",
        "noopener,noreferrer"
      );
    });

    it("API not 200 → does not open a window", async () => {
      const open = vi.fn();
      vi.stubGlobal("open", open);
      mockGetChatdownloadURL.mockResolvedValueOnce({ code: 500 } as any);

      const { downloadFile } = makeComposable();
      await downloadFile("obs://x");

      expect(open).not.toHaveBeenCalled();
    });
  });

  describe("downloadFileDirect", () => {
    it("with a path → window.open opens directly", () => {
      const open = vi.fn();
      vi.stubGlobal("open", open);

      const { downloadFileDirect } = makeComposable();
      downloadFileDirect("http://p");

      expect(open).toHaveBeenCalledWith(
        "http://p",
        "_blank",
        "noopener,noreferrer"
      );
    });

    it("empty path → does not open a window", () => {
      const open = vi.fn();
      vi.stubGlobal("open", open);

      const { downloadFileDirect } = makeComposable();
      downloadFileDirect("");

      expect(open).not.toHaveBeenCalled();
    });
  });

  describe("getFileDownUrl", () => {
    it("happy path → creates an object URL and clicks the download link", async () => {
      const createObjectURL = vi.fn().mockReturnValue("blob:fake");
      const revokeObjectURL = vi.fn();
      // happy-dom provides window.URL; fill in the object-URL factory to observe calls
      (window.URL as any).createObjectURL = createObjectURL;
      (window.URL as any).revokeObjectURL = revokeObjectURL;

      const clickSpy = vi
        .spyOn(HTMLAnchorElement.prototype, "click")
        .mockImplementation(() => undefined);

      mockGetFileDownUrlApi.mockResolvedValueOnce({
        headers: {
          "content-disposition": 'attachment; filename="report.pdf"',
          "content-type": "application/pdf",
        },
        data: new Blob(["body"]),
      } as any);

      const { getFileDownUrl } = makeComposable();
      await getFileDownUrl("7", "pdf");

      // Verify the FormData parameters
      const formData: FormData = mockGetFileDownUrlApi.mock.calls[0][0] as FormData;
      expect(formData.get("document_format")).toBe("pdf");
      expect(formData.get("id")).toBe("7");

      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:fake");

      clickSpy.mockRestore();
    });
  });
});
