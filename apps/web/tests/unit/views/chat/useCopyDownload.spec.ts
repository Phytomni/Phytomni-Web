import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { computed, ref, type Ref, type WritableComputedRef } from "vue";
import type { AxiosProgressEvent } from "axios";
import type { BinaryResponse } from "@/api/types";
import { useCopyDownload } from "@/views/chat/composables/useCopyDownload";
import {
  clearDownloadTransfers,
  listDownloadTransfers,
} from "@/utils/download-transfers";
import {
  buildApiEnvelope,
  buildBinaryResponse,
} from "../../../helpers/apiBuilders";
import { deferred, mustGet } from "../../../helpers/mockFactories";

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
  let copyVisible: Ref<number>;
  let copyTimeRef: Ref<ReturnType<typeof setTimeout> | undefined>;
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

  function writableRef<T>(source: Ref<T>): WritableComputedRef<T> {
    return computed({
      get: () => source.value,
      set: (value: T) => {
        source.value = value;
      },
    });
  }

  function makeComposable() {
    return useCopyDownload({
      copyVisible: writableRef(copyVisible),
      copyTimeRef: writableRef(copyTimeRef),
      t,
    });
  }

  function stubBlobDownload() {
    const createObjectURL = vi
      .spyOn(window.URL, "createObjectURL")
      .mockReturnValue("blob:fake");
    const revokeObjectURL = vi
      .spyOn(window.URL, "revokeObjectURL")
      .mockImplementation(() => undefined);
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    return { createObjectURL, revokeObjectURL, clickSpy };
  }

  function progressEvent(loaded: number, total: number): AxiosProgressEvent {
    return { loaded, total, bytes: loaded };
  }

  function formDataCallAt(index: number, label: string): FormData {
    const [data] = mustGet(mockGetFileDownUrlApi.mock.calls[index], label);
    if (!(data instanceof FormData)) {
      throw new Error(`Expected FormData: ${label}`);
    }
    return data;
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
      mockGetChatdownloadURL.mockResolvedValueOnce(
        buildApiEnvelope("http://dl")
      );

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
      mockGetChatdownloadURL.mockResolvedValueOnce(
        buildApiEnvelope<string>("", { code: 500 })
      );

      const { downloadFile } = makeComposable();
      await downloadFile("obs://x");

      expect(open).not.toHaveBeenCalled();
    });
  });

  describe("download_path signing", () => {
    it("downloadFile signs the internal path and opens only the returned relay URL", async () => {
      const open = vi.fn();
      vi.stubGlobal("open", open);
      mockGetChatdownloadURL.mockResolvedValueOnce(
        buildApiEnvelope("/api/v1/downloads/relay-file?t=signed")
      );

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
        buildBinaryResponse("report.pdf")
      );

      const { getFileDownUrl } = makeComposable();
      await getFileDownUrl("7", "pdf");

      // Verify the FormData parameters
      const formData = formDataCallAt(0, "single rendering-file request");
      expect(formData.get("document_format")).toBe("pdf");
      expect(formData.get("id")).toBe("7");

      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:fake");

      clickSpy.mockRestore();
    });

    it("tracks two parallel rendering-file downloads independently", async () => {
      const { clickSpy } = stubBlobDownload();
      const pending: Array<ReturnType<typeof deferred<BinaryResponse>>> = [];
      mockGetFileDownUrlApi.mockImplementation((_data, opts) => {
        opts?.onDownloadProgress?.(progressEvent(25, 100));
        const request = deferred<BinaryResponse>();
        pending.push(request);
        return request.promise;
      });

      const { getFileDownUrl } = makeComposable();
      const first = getFileDownUrl("7", "pdf");
      const second = getFileDownUrl("8", "pdf");

      const inFlight = listDownloadTransfers();
      expect(inFlight).toHaveLength(2);
      expect(new Set(inFlight.map((snap) => snap.requestId)).size).toBe(2);
      expect(inFlight.map((snap) => snap.percent)).toEqual([25, 25]);

      expect(pending).toHaveLength(2);
      mustGet(pending[0], "first rendering-file request").resolve(
        buildBinaryResponse("one.pdf")
      );
      mustGet(pending[1], "second rendering-file request").resolve(
        buildBinaryResponse("two.pdf")
      );
      await Promise.all([first, second]);

      expect(listDownloadTransfers()).toHaveLength(0);
      expect(clickSpy).toHaveBeenCalledTimes(2);
      clickSpy.mockRestore();
    });

    it("cancels one rendering-file download without reporting a download error", async () => {
      const { clickSpy } = stubBlobDownload();
      const pending: Array<ReturnType<typeof deferred<BinaryResponse>>> = [];
      mockGetFileDownUrlApi.mockImplementation((_data, opts) => {
        opts?.onDownloadProgress?.(progressEvent(50, 100));
        const request = deferred<BinaryResponse>();
        pending.push(request);
        return request.promise;
      });

      const { getFileDownUrl } = makeComposable();
      const first = getFileDownUrl("7", "pdf");
      const second = getFileDownUrl("8", "pdf");
      const inFlight = listDownloadTransfers();
      expect(inFlight).toHaveLength(2);
      const firstRequestId = mustGet(inFlight[0], "first transfer").requestId;
      const secondRequestId = mustGet(inFlight[1], "second transfer").requestId;

      mustGet(pending[0], "canceled rendering-file request").reject({
        code: "ERR_CANCELED",
      });
      await first;

      const remaining = listDownloadTransfers();
      expect(remaining.map((snap) => snap.requestId)).toEqual([
        secondRequestId,
      ]);
      expect(mustGet(remaining[0], "remaining transfer").requestId).not.toBe(
        firstRequestId
      );
      expect(mockElInfo).toHaveBeenCalledWith("chat.downloadCancelled");
      expect(mockElError).not.toHaveBeenCalledWith("chat.downloadError");

      mustGet(pending[1], "remaining rendering-file request").resolve(
        buildBinaryResponse("report-1.pdf")
      );
      await second;

      expect(listDownloadTransfers()).toHaveLength(0);
      clickSpy.mockRestore();
    });
  });
});
