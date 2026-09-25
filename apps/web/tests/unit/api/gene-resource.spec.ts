import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getGeneResourceCif,
  getGeneResourceMarkdown,
} from "@/api/gene-display";

const request = vi.hoisted(() => vi.fn());
vi.mock("@/utils/request", () => ({
  default: request,
  createAbortableRequest: vi.fn(),
}));
afterEach(() => vi.resetAllMocks());
const id = `gene-${"a".repeat(64)}`;
const response = (content = "# Protocol\r\n\nDetails") => ({
  status: 200,
  headers: { "content-type": "text/markdown; charset=utf-8" },
  data: new TextEncoder().encode(content).buffer,
});

describe("authenticated gene Markdown resource reader", () => {
  it("reads protected CIF text through the authenticated request without a display URL", async () => {
    request.mockResolvedValue({
      ...response("data_model\n_atom_site.id 1"),
      headers: { "content-type": "chemical/x-cif; charset=utf-8" },
    });
    await expect(
      getGeneResourceCif("Os01_result.md", id, new AbortController().signal)
    ).resolves.toBe("data_model\n_atom_site.id 1");
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: `/api/v1/genes/Os01_result.md/resources/${id}`,
        responseType: "arraybuffer",
        suppressErrorToast: true,
      })
    );
  });
  it.each([
    {
      ...response("data_model"),
      headers: { "content-type": "chemical/x-cif; charset=iso-8859-1" },
    },
    { ...response("data_model"), headers: { "content-type": "text/markdown" } },
    {
      ...response("<!DOCTYPE html><html>Fallback</html>"),
      headers: { "content-type": "chemical/x-cif" },
    },
    {
      ...response(),
      headers: { "content-type": "chemical/x-cif" },
      data: new Uint8Array([0xff]).buffer,
    },
    {
      ...response(),
      headers: { "content-type": "chemical/x-cif" },
      data: new ArrayBuffer(8 * 1024 * 1024 + 1),
    },
    {
      ...response(),
      headers: { "content-type": "chemical/x-cif" },
      status: 401,
    },
    {
      ...response(),
      headers: { "content-type": "chemical/x-cif" },
      status: 404,
    },
  ])("rejects invalid protected CIF responses", async (value) => {
    request.mockResolvedValue(value);
    await expect(
      getGeneResourceCif("Os01_result.md", id, new AbortController().signal)
    ).rejects.toThrow();
  });
  it("cancels CIF transfers and rejects pre-cancelled or non-manifest IDs", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      getGeneResourceCif("Os01_result.md", id, controller.signal)
    ).rejects.toThrow();
    await expect(
      getGeneResourceCif(
        "Os01_result.md",
        "../model.cif",
        new AbortController().signal
      )
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
    request.mockImplementation(async (config) => {
      config.onDownloadProgress({ loaded: 8 * 1024 * 1024 + 1 });
      expect(config.signal.aborted).toBe(true);
      return {
        ...response("data_model"),
        headers: { "content-type": "chemical/x-cif" },
      };
    });
    await expect(
      getGeneResourceCif("Os01_result.md", id, new AbortController().signal)
    ).rejects.toThrow();
  });
  it("uses only report/resource IDs and preserves raw UTF8 bytes", async () => {
    request.mockResolvedValue(response());
    const controller = new AbortController();
    const result = await getGeneResourceMarkdown(
      "Os01_result.md",
      id,
      controller.signal
    );
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: `/api/v1/genes/Os01_result.md/resources/${id}`,
        method: "get",
        responseType: "arraybuffer",
        suppressErrorToast: true,
      })
    );
    expect(result.text).toBe("# Protocol\r\n\nDetails");
    expect(new TextDecoder().decode(result.bytes)).toBe(result.text);
  });
  it.each(["../secret", "https://example.test/file", "", `${id}/../x`])(
    "rejects a client path in place of an opaque resource ID",
    async (resourceId) => {
      await expect(
        getGeneResourceMarkdown(
          "Os01_result.md",
          resourceId,
          new AbortController().signal
        )
      ).rejects.toThrow();
      expect(request).not.toHaveBeenCalled();
    }
  );
  it.each([
    { ...response(), status: 404 },
    { ...response(), headers: { "content-type": "text/html" } },
    response("<!DOCTYPE html><html>SPA fallback</html>"),
    { ...response(), data: new Uint8Array([0xff]).buffer },
    { ...response(), data: new ArrayBuffer(8 * 1024 * 1024 + 1) },
    { ...response(), data: "not bytes" },
  ])(
    "rejects failures, wrong type, HTML, invalid UTF8 and oversized bytes",
    async (value) => {
      request.mockResolvedValue(value);
      await expect(
        getGeneResourceMarkdown(
          "Os01_result.md",
          id,
          new AbortController().signal
        )
      ).rejects.toThrow();
    }
  );
  it("forwards cancellation and stops an oversized transfer", async () => {
    let captured:
      | {
          signal: AbortSignal;
          onDownloadProgress: (event: { loaded: number }) => void;
        }
      | undefined;
    request.mockImplementation(async (config) => {
      captured = config;
      return response();
    });
    const controller = new AbortController();
    const pending = getGeneResourceMarkdown(
      "Os01_result.md",
      id,
      controller.signal
    );
    controller.abort();
    expect(captured?.signal.aborted).toBe(true);
    await expect(pending).rejects.toThrow();
    request.mockImplementation(async (config) => {
      config.onDownloadProgress({ loaded: 8 * 1024 * 1024 + 1 });
      expect(config.signal.aborted).toBe(true);
      return response();
    });
    await expect(
      getGeneResourceMarkdown(
        "Os01_result.md",
        id,
        new AbortController().signal
      )
    ).rejects.toThrow();
  });
});
