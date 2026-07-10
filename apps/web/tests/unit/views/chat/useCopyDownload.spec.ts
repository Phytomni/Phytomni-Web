import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ref } from "vue";
import { useCopyDownload } from "@/views/chat/composables/useCopyDownload";
import {
  clearDownloadTransfers,
  listDownloadTransfers,
} from "@/utils/download-transfers";

// Mock element-plus ElMessage
vi.mock("element-plus", () => ({
  ElMessage: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
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
const mockElError = vi.mocked(ElMessage.error);
const mockElInfo = vi.mocked(ElMessage.info);

describe("useCopyDownload", () => {
  let copyVisible: ReturnType<typeof ref<number>>;
  let copyTimeRef: ReturnType<
    typeof ref<ReturnType<typeof setTimeout> | undefined>
  >;
  const t = (k: string) => k;

  beforeEach(() => {
    vi.clearAllMocks();
    clearDownloadTransfers();
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

  function stubBlobDownload() {
    const createObjectURL = vi.fn().mockReturnValue("blob:fake");
    const revokeObjectURL = vi.fn();
    (window.URL as any).createObjectURL = createObjectURL;
    (window.URL as any).revokeObjectURL = revokeObjectURL;
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    return { createObjectURL, revokeObjectURL, clickSpy };
  }

  function blobResponse(filename: string) {
    return {
      headers: {
        "content-disposition": `attachment; filename="${filename}"`,
        "content-type": "application/octet-stream",
      },
      data: new Blob(["body"]),
    };
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

      expect(mockGetChatdownloadURL).toHaveBeenCalledWith({
        obs_path: "obs://x",
      });
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

  describe("download_path signing", () => {
    it("downloadFile signs the internal path and opens only the returned relay URL", async () => {
      const open = vi.fn();
      vi.stubGlobal("open", open);
      mockGetChatdownloadURL.mockResolvedValueOnce({
        code: 200,
        data: "/api/v1/downloads/relay-file?t=signed",
      } as any);

      const { downloadFile } = makeComposable();
      await downloadFile("/obs/internal/run/out");

      expect(mockGetChatdownloadURL).toHaveBeenCalledWith({
        obs_path: "/obs/internal/run/out",
      });
      expect(open).toHaveBeenCalledWith(
        "/api/v1/downloads/relay-file?t=signed",
        "_blank",
        "noopener,noreferrer"
      );
      expect(open).not.toHaveBeenCalledWith(
        "/obs/internal/run/out",
        "_blank",
        "noopener,noreferrer"
      );
    });

    it("downloadFile with an empty path does not call the signer or open a window", async () => {
      const open = vi.fn();
      vi.stubGlobal("open", open);

      const { downloadFile } = makeComposable();
      await downloadFile("");

      expect(mockGetChatdownloadURL).not.toHaveBeenCalled();
      expect(open).not.toHaveBeenCalled();
    });
  });

  describe("getFileDownUrl", () => {
    it("happy path → creates an object URL and clicks the download link", async () => {
      const { createObjectURL, revokeObjectURL, clickSpy } = stubBlobDownload();

      mockGetFileDownUrlApi.mockResolvedValueOnce(
        blobResponse("report.pdf") as any
      );

      const { getFileDownUrl } = makeComposable();
      await getFileDownUrl("7", "pdf");

      // Verify the FormData parameters
      const formData: FormData = mockGetFileDownUrlApi.mock
        .calls[0][0] as FormData;
      expect(formData.get("document_format")).toBe("pdf");
      expect(formData.get("id")).toBe("7");

      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:fake");

      clickSpy.mockRestore();
    });

    it("tracks two parallel rendering-file downloads independently", async () => {
      const { clickSpy } = stubBlobDownload();
      const responses = [blobResponse("one.pdf"), blobResponse("two.pdf")];
      const resolvers: Array<(value: any) => void> = [];
      mockGetFileDownUrlApi.mockImplementation((_data, opts) => {
        opts?.onDownloadProgress?.({ loaded: 25, total: 100 } as any);
        const index = resolvers.length;
        return new Promise((resolve) => {
          resolvers.push(() => resolve(responses[index]));
        }) as any;
      });

      const { getFileDownUrl } = makeComposable();
      const first = getFileDownUrl("7", "pdf");
      const second = getFileDownUrl("8", "pdf");

      const inFlight = listDownloadTransfers();
      expect(inFlight).toHaveLength(2);
      expect(new Set(inFlight.map((snap) => snap.requestId)).size).toBe(2);
      expect(inFlight.map((snap) => snap.percent)).toEqual([25, 25]);

      resolvers[0](undefined);
      resolvers[1](undefined);
      await Promise.all([first, second]);

      expect(listDownloadTransfers()).toHaveLength(0);
      expect(clickSpy).toHaveBeenCalledTimes(2);
      clickSpy.mockRestore();
    });

    it("cancels one rendering-file download without reporting a download error", async () => {
      const { clickSpy } = stubBlobDownload();
      const resolvers: Array<(value: any) => void> = [];
      const rejecters: Array<(reason: unknown) => void> = [];
      mockGetFileDownUrlApi.mockImplementation((_data, opts) => {
        opts?.onDownloadProgress?.({ loaded: 50, total: 100 } as any);
        const index = resolvers.length;
        return new Promise((resolve, reject) => {
          resolvers.push(() => resolve(blobResponse(`report-${index}.pdf`)));
          rejecters.push(reject);
        }) as any;
      });

      const { getFileDownUrl } = makeComposable();
      const first = getFileDownUrl("7", "pdf");
      const second = getFileDownUrl("8", "pdf");
      const [firstRequestId, secondRequestId] = listDownloadTransfers().map(
        (snap) => snap.requestId
      );

      rejecters[0]({ code: "ERR_CANCELED" });
      await first;

      expect(listDownloadTransfers().map((snap) => snap.requestId)).toEqual([
        secondRequestId,
      ]);
      expect(listDownloadTransfers()[0].requestId).not.toBe(firstRequestId);
      expect(mockElInfo).toHaveBeenCalledWith("chat.downloadCancelled");
      expect(mockElError).not.toHaveBeenCalledWith("chat.downloadError");

      resolvers[1](undefined);
      await second;

      expect(listDownloadTransfers()).toHaveLength(0);
      clickSpy.mockRestore();
    });
  });
});
