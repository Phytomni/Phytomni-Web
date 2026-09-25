import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/chat", () => ({
  getExecutionTargetFile: vi.fn(),
}));

import { getExecutionTargetFile } from "@/api/chat";
import { loadExecutionArtifactPreview } from "@/views/chat/executionArtifactPreview";

const getTargetFile = vi.mocked(getExecutionTargetFile);

describe("execution artifact preview", () => {
  beforeEach(() => getTargetFile.mockReset());

  it("loads text from the raw Blob returned by the authenticated interceptor", async () => {
    const blob = new Blob([
      "Node\thormone_type\tTO_type\ngene-orf160\tothers\tothers",
    ]);
    getTargetFile.mockResolvedValueOnce(blob as never);

    await expect(
      loadExecutionArtifactPreview({
        deliveryUrl:
          "/api/v1/executions/turn-1/targets/artifact/a-text/content",
        renderer: "log",
        name: "TO_0000011_network_class.txt",
        sizeBytes: blob.size,
        requestId: "preview-text",
      })
    ).resolves.toEqual({
      kind: "text",
      text: "Node\thormone_type\tTO_type\ngene-orf160\tothers\tothers",
    });
  });

  it("loads and formats bounded JSON from the authenticated target route", async () => {
    getTargetFile.mockResolvedValueOnce({
      data: new Blob(['{"gene":"AT1G01010","score":2.5}']),
      headers: {},
    } as never);

    await expect(
      loadExecutionArtifactPreview({
        deliveryUrl:
          "/api/v1/executions/turn-1/targets/artifact/a-json/content",
        renderer: "structured",
        name: "network.json",
        sizeBytes: 36,
        requestId: "preview-json",
      })
    ).resolves.toEqual({
      kind: "structured",
      text: '{\n  "gene": "AT1G01010",\n  "score": 2.5\n}',
    });
  });

  it("parses bounded quoted CSV into safe scalar table cells", async () => {
    getTargetFile.mockResolvedValueOnce({
      data: new Blob(['gene,label,score\nAT1G01010,"root, leaf",2.5']),
      headers: {},
    } as never);

    await expect(
      loadExecutionArtifactPreview({
        deliveryUrl: "/api/v1/executions/turn-1/targets/artifact/a-csv/content",
        renderer: "table",
        name: "genes.csv",
        sizeBytes: 44,
        requestId: "preview-csv",
      })
    ).resolves.toEqual({
      kind: "table",
      table: {
        headers: ["gene", "label", "score"],
        rows: [["AT1G01010", "root, leaf", "2.5"]],
      },
    });
  });

  it("returns an opaque image blob and never parses SVG markup", async () => {
    const image = new Blob(['<svg onload="alert(1)"></svg>'], {
      type: "application/octet-stream",
    });
    getTargetFile.mockResolvedValueOnce({ data: image, headers: {} } as never);

    const preview = await loadExecutionArtifactPreview({
      deliveryUrl: "/api/v1/executions/turn-1/targets/artifact/a-svg/content",
      renderer: "image",
      name: "figure.svg",
      sizeBytes: image.size,
      requestId: "preview-svg",
    });

    expect(preview.kind).toBe("image");
    if (preview.kind !== "image") throw new Error("image preview missing");
    expect(preview.blob.type).toBe("image/svg+xml");
    expect(preview).not.toHaveProperty("html");
  });

  it("loads a bounded generic PDF as an opaque PDF blob", async () => {
    getTargetFile.mockResolvedValueOnce({
      data: new Blob(["%PDF-1.7"], { type: "application/octet-stream" }),
      headers: {},
    } as never);

    const preview = await loadExecutionArtifactPreview({
      deliveryUrl: "/api/v1/executions/turn-1/targets/artifact/a-pdf/content",
      renderer: "pdf",
      name: "network-report.pdf",
      sizeBytes: 8,
      requestId: "preview-pdf",
    });

    expect(preview.kind).toBe("pdf");
    if (preview.kind !== "pdf") throw new Error("PDF preview missing");
    expect(preview.blob.type).toBe("application/pdf");
  });

  it.each([
    ["figure.png", "image/png"],
    ["figure.jpg", "image/jpeg"],
    ["figure.jpeg", "image/jpeg"],
  ] as const)(
    "normalizes generic %s delivery to safe image type %s",
    async (name, mediaType) => {
      getTargetFile.mockResolvedValueOnce({
        data: new Blob(["image"], { type: "application/octet-stream" }),
        headers: {},
      } as never);

      const preview = await loadExecutionArtifactPreview({
        deliveryUrl: `/api/v1/executions/turn-1/targets/artifact/${name}/content`,
        renderer: "image",
        name,
        sizeBytes: 5,
        requestId: `preview-${name}`,
      });

      expect(preview.kind).toBe("image");
      if (preview.kind !== "image") throw new Error("image preview missing");
      expect(preview.blob.type).toBe(mediaType);
    }
  );

  it("keeps ZIP as download-only metadata without fetching a preview", async () => {
    await expect(
      loadExecutionArtifactPreview({
        deliveryUrl: "/api/v1/executions/turn-1/targets/artifact/a-zip/content",
        renderer: "metadata",
        name: "results.zip",
        sizeBytes: 1024,
        requestId: "preview-zip",
      })
    ).resolves.toEqual({ kind: "unavailable", reason: "unsupported" });
    expect(getTargetFile).not.toHaveBeenCalled();
  });

  it("does not fetch unsupported or oversized previews", async () => {
    await expect(
      loadExecutionArtifactPreview({
        deliveryUrl:
          "/api/v1/executions/turn-1/targets/artifact/a-html/content",
        renderer: "metadata",
        name: "unsafe.html",
        sizeBytes: 10,
        requestId: "preview-html",
      })
    ).resolves.toEqual({ kind: "unavailable", reason: "unsupported" });
    await expect(
      loadExecutionArtifactPreview({
        deliveryUrl:
          "/api/v1/executions/turn-1/targets/artifact/a-large/content",
        renderer: "structured",
        name: "large.json",
        sizeBytes: 2_000_000,
        requestId: "preview-large",
      })
    ).resolves.toEqual({ kind: "unavailable", reason: "too_large" });
    expect(getTargetFile).not.toHaveBeenCalled();
  });
});
