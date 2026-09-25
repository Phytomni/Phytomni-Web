import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ElMessage } from "element-plus";
import { getFileDownUrlApi } from "@/api/chat";
import { downloadRenderingFile } from "@/utils/download-rendering-file";
import {
  clearDownloadTransfers,
  listDownloadTransfers,
} from "@/utils/download-transfers";

vi.mock("@/api/chat", () => ({ getFileDownUrlApi: vi.fn() }));
vi.mock("element-plus", () => ({
  ElMessage: { error: vi.fn(), info: vi.fn() },
}));

const fontFailure = {
  code: 503,
  reason: "academic_report_fonts_unavailable",
  message: "private font path",
};
const t = (key: string) => `localized:${key}`;
const getDownload = vi.mocked(getFileDownUrlApi);
const createURL = vi.fn(() => "blob:fixture");
const revokeURL = vi.fn();

function response(
  data: unknown,
  status = 503,
  contentType = "application/json"
) {
  return { data, status, headers: { "content-type": contentType } };
}

function rejectResponse(
  data: unknown,
  status = 503,
  contentType = "application/json"
) {
  getDownload.mockRejectedValue({
    response: response(data, status, contentType),
  });
}

function expectError(key = "chat.downloadError") {
  expect(ElMessage.error).toHaveBeenCalledExactlyOnceWith(t(key));
  expect(ElMessage.info).not.toHaveBeenCalled();
  expect(createURL).not.toHaveBeenCalled();
  expect(listDownloadTransfers()).toHaveLength(0);
}

describe("downloadRenderingFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearDownloadTransfers();
    vi.spyOn(URL, "createObjectURL").mockImplementation(createURL);
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(revokeURL);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      () => undefined
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearDownloadTransfers();
  });

  it.each(["object", "blob"])(
    "classifies the 503 %s envelope without displaying raw diagnostics",
    async (kind) => {
      rejectResponse(
        kind === "blob"
          ? new Blob([JSON.stringify(fontFailure)], {
              type: "application/json",
            })
          : fontFailure
      );
      const log = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      await downloadRenderingFile("100", "PDF", t);
      expectError();
      expect(log).not.toHaveBeenCalled();
    }
  );

  it.each(["PDF", "Word", "Markdown"])(
    "saves valid %s bytes and owns request-local error reporting",
    async (format) => {
      const source = new Blob([`${format} fixture`]);
      getDownload.mockImplementation(async (form, opts) => {
        expect(form).toBeInstanceOf(FormData);
        expect((form as FormData).get("id")).toBe("100");
        expect((form as FormData).get("document_format")).toBe(format);
        expect(opts).toMatchObject({
          suppressErrorToast: true,
          requestId: expect.any(String),
        });
        opts?.onDownloadProgress?.({
          loaded: 4,
          total: 10,
          bytes: 4,
          lengthComputable: true,
        });
        expect(listDownloadTransfers()).toHaveLength(1);
        return {
          ...response(source, 200, "application/octet-stream"),
          headers: {
            "content-type": "application/octet-stream",
            "content-disposition": `attachment; filename="report.${format}"`,
          },
        } as Awaited<ReturnType<typeof getFileDownUrlApi>>;
      });
      await downloadRenderingFile("100", format, t);
      expect(createURL).toHaveBeenCalledOnce();
      const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
      expect(await blob.text()).toBe(`${format} fixture`);
      const anchor = vi.mocked(HTMLAnchorElement.prototype.click).mock
        .instances[0];
      expect(anchor.download).toBe(`report.${format}`);
      expect(document.body.contains(anchor)).toBe(false);
      expect(revokeURL).toHaveBeenCalledExactlyOnceWith("blob:fixture");
      expect(ElMessage.error).not.toHaveBeenCalled();
      expect(ElMessage.info).not.toHaveBeenCalled();
      expect(listDownloadTransfers()).toHaveLength(0);
    }
  );

  it.each(["object", "blob"])(
    "never saves a resolved JSON %s error as a file",
    async (kind) => {
      getDownload.mockResolvedValue(
        response(
          kind === "blob"
            ? new Blob([JSON.stringify(fontFailure)], {
                type: "application/json",
              })
            : fontFailure,
          200
        ) as Awaited<ReturnType<typeof getFileDownUrlApi>>
      );
      await downloadRenderingFile("100", "PDF", t);
      expectError();
    }
  );

  it("classifies a resolved HTTP failure before saving", async () => {
    getDownload.mockResolvedValue(
      response(
        new Blob([JSON.stringify(fontFailure)], { type: "application/json" })
      ) as Awaited<ReturnType<typeof getFileDownUrlApi>>
    );
    await downloadRenderingFile("100", "PDF", t);
    expectError();
  });

  it.each([400, 401, 403, 404, 500])(
    "does not classify HTTP %i as a font configuration failure",
    async (status) => {
      rejectResponse(fontFailure, status);
      await downloadRenderingFile("100", "PDF", t);
      expectError();
    }
  );

  it.each([
    { code: "503", reason: fontFailure.reason },
    { code: 500, reason: fontFailure.reason },
    { code: 503, reason: "unknown", message: "private diagnostic" },
    { code: 503, reason: { token: "private" } },
    null,
    [fontFailure],
  ])("rejects an unrecognized error envelope: %j", async (data) => {
    rejectResponse(data);
    await downloadRenderingFile("100", "PDF", t);
    expectError();
  });

  it.each(["{malformed", "null", "[]", ""])(
    "handles malformed or empty JSON %j",
    async (data) => {
      rejectResponse(new Blob([data], { type: "application/json" }));
      await downloadRenderingFile("100", "PDF", t);
      expectError();
    }
  );

  it("does not read oversized JSON bodies", async () => {
    const blob = new Blob(
      [JSON.stringify({ ...fontFailure, message: "x".repeat(4096) })],
      { type: "application/json" }
    );
    const read = vi.spyOn(blob, "text");
    rejectResponse(blob);
    await downloadRenderingFile("100", "PDF", t);
    expectError();
    expect(read).not.toHaveBeenCalled();
  });

  it("handles a failed Blob read without a second rejection", async () => {
    const blob = new Blob(["{}"], { type: "application/json" });
    vi.spyOn(blob, "text").mockRejectedValue(new Error("private read error"));
    rejectResponse(blob);
    await downloadRenderingFile("100", "PDF", t);
    expectError();
  });

  it("does not decode non-JSON error content", async () => {
    const blob = new Blob([JSON.stringify(fontFailure)], { type: "text/html" });
    const read = vi.spyOn(blob, "text");
    rejectResponse(blob, 503, "text/html");
    await downloadRenderingFile("100", "PDF", t);
    expectError();
    expect(read).not.toHaveBeenCalled();
  });

  it("uses Blob MIME to reject JSON even with a binary response header", async () => {
    getDownload.mockResolvedValue(
      response(
        new Blob([JSON.stringify(fontFailure)], { type: "application/json" }),
        200,
        "application/octet-stream"
      ) as Awaited<ReturnType<typeof getFileDownUrlApi>>
    );
    await downloadRenderingFile("100", "PDF", t);
    expectError();
  });

  it("reports a network error without logging the raw error", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    getDownload.mockRejectedValue({
      message: "private",
      config: { headers: { Authorization: "private" } },
    });
    await downloadRenderingFile("100", "PDF", t);
    expectError();
    expect(log).not.toHaveBeenCalled();
  });

  it.each([{ code: "ERR_CANCELED" }, { name: "CanceledError" }])(
    "reports cancellation without an error: %j",
    async (error) => {
      getDownload.mockRejectedValue(error);
      await downloadRenderingFile("100", "PDF", t);
      expect(ElMessage.info).toHaveBeenCalledExactlyOnceWith(
        t("chat.downloadCancelled")
      );
      expect(ElMessage.error).not.toHaveBeenCalled();
      expect(createURL).not.toHaveBeenCalled();
      expect(listDownloadTransfers()).toHaveLength(0);
    }
  );
});
