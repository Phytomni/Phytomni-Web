import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class CanceledError extends Error {
    code = "ERR_CANCELED";
  }

  return {
    post: vi.fn(),
    saveAs: vi.fn(),
    blobValidate: vi.fn(async () => true),
    elMessage: vi.fn(),
    elMessageError: vi.fn(),
    elMessageInfo: vi.fn(),
    loadingService: vi.fn(() => ({ close: vi.fn() })),
    CanceledError,
    responseError: undefined as
      undefined | ((error: unknown) => Promise<never>),
  };
});

vi.mock("axios", () => ({
  default: {
    CancelToken: {
      source: vi.fn(() => ({ token: "token", cancel: vi.fn() })),
    },
    CanceledError: mocks.CanceledError,
    create: vi.fn(() => {
      const client = Object.assign(
        vi.fn((config: { url: string; data?: unknown }) =>
          mocks.post(config.url, config.data, config)
        ),
        {
          post: mocks.post,
          defaults: {},
          interceptors: {
            request: { use: vi.fn() },
            response: {
              use: vi.fn((_success, error) => {
                mocks.responseError = error;
              }),
            },
          },
        }
      );
      return client;
    }),
    isCancel: vi.fn(
      (error: { code?: string }) => error?.code === "ERR_CANCELED"
    ),
    isAxiosError: vi.fn(() => false),
  },
}));

vi.mock("element-plus", () => ({
  ElMessage: Object.assign(mocks.elMessage, {
    error: mocks.elMessageError,
    info: mocks.elMessageInfo,
  }),
  ElMessageBox: { alert: vi.fn() },
  ElLoading: { service: mocks.loadingService },
}));

vi.mock("@/stores", () => ({
  userStore: () => ({ FedLogOut: vi.fn(() => Promise.resolve()) }),
}));

vi.mock("@/utils/auth", () => ({ getToken: vi.fn(() => "token") }));

vi.mock("@/utils", () => ({
  tansParams: vi.fn(() => "encoded=1&"),
  blobValidate: mocks.blobValidate,
}));

vi.mock("@/plugins/cache", () => ({
  default: {
    session: {
      getJSON: vi.fn(() => null),
      setJSON: vi.fn(),
    },
  },
}));

vi.mock("file-saver", () => ({ saveAs: mocks.saveAs }));

vi.mock("@/locales", () => ({
  default: {
    global: {
      locale: { value: "en-US" },
      t: (key: string) => key,
    },
  },
  i18n: {
    global: {
      t: (key: string) => key,
    },
  },
}));

import { download } from "@/utils/request";
import {
  clearDownloadTransfers,
  listDownloadTransfers,
} from "@/utils/download-transfers";

describe("download", () => {
  afterEach(() => {
    clearDownloadTransfers();
    vi.clearAllMocks();
    mocks.blobValidate.mockResolvedValue(true);
  });

  it("tracks progress while saving a valid blob", async () => {
    mocks.post.mockImplementation((_url, _params, config) => {
      expect(config.signal).toBeInstanceOf(AbortSignal);
      expect(config.responseType).toBe("blob");
      expect(typeof config.onDownloadProgress).toBe("function");

      config.onDownloadProgress({ loaded: 50, total: 100 });
      expect(listDownloadTransfers()).toHaveLength(1);

      return Promise.resolve(new Blob(["data"]));
    });

    await download("/api/v1/export", { id: 1 }, "export.xlsx");

    expect(mocks.saveAs).toHaveBeenCalledWith(expect.any(Blob), "export.xlsx");
    expect(listDownloadTransfers()).toHaveLength(0);
    expect(mocks.loadingService).not.toHaveBeenCalled();
  });

  it("saves AxiosResponse.data when the interceptor keeps the envelope", async () => {
    const blob = new Blob(["zip-bytes"]);
    mocks.post.mockResolvedValue({
      data: blob,
      status: 200,
      headers: { "content-type": "application/zip" },
    });

    await download("/api/v1/export", { id: 1 }, "network-results.zip");

    expect(mocks.saveAs).toHaveBeenCalledWith(
      expect.any(Blob),
      "network-results.zip"
    );
  });

  it("drops hostile non-string error fields before showing a download error", async () => {
    const secret = "download-error-secret";
    mocks.blobValidate.mockResolvedValue(false);
    mocks.post.mockResolvedValue(
      new Blob([JSON.stringify({ code: "unknown", msg: { token: secret } })])
    );

    await download("/api/v1/export", { id: 1 }, "export.xlsx");

    expect(JSON.stringify(mocks.elMessageError.mock.calls)).not.toContain(
      secret
    );
    expect(mocks.elMessageError).toHaveBeenCalledWith("errorCode.default");
  });

  it("reports cancellation without the generic download error", async () => {
    const canceled = new mocks.CanceledError("canceled");
    mocks.post.mockRejectedValue(canceled);

    await download("/api/v1/export", { id: 1 }, "export.xlsx");

    expect(mocks.elMessageInfo).toHaveBeenCalledWith("chat.downloadCancelled");
    expect(mocks.elMessageError).not.toHaveBeenCalledWith("chat.downloadError");
    expect(listDownloadTransfers()).toHaveLength(0);
  });

  it("does not show a global error toast for canceled response errors", async () => {
    const canceled = new mocks.CanceledError("canceled");
    const consoleLog = vi.spyOn(console, "log").mockImplementation(vi.fn());

    try {
      await expect(mocks.responseError?.(canceled)).rejects.toBe(canceled);
    } finally {
      consoleLog.mockRestore();
    }

    expect(mocks.elMessage).not.toHaveBeenCalled();
    expect(mocks.elMessageError).not.toHaveBeenCalled();
  });
});
