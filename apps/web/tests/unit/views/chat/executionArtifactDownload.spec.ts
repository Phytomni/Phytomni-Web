import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/chat", () => ({
  getExecutionTargetFile: vi.fn(),
}));
vi.mock("file-saver", () => ({
  saveAs: vi.fn(),
}));

import { getExecutionTargetFile } from "@/api/chat";
import { saveAs } from "file-saver";
import {
  downloadExecutionArtifact,
  executionArtifactDownloadName,
} from "@/views/chat/executionArtifactDownload";

const getTargetFile = vi.mocked(getExecutionTargetFile);
const saveFile = vi.mocked(saveAs);

describe("execution artifact download", () => {
  beforeEach(() => {
    getTargetFile.mockReset();
    saveFile.mockReset();
  });

  it("recovers the original filename from the result with the same typed target", () => {
    expect(
      executionArtifactDownloadName(
        { kind: "artifact", id: "artifact-1" },
        undefined,
        [
          {
            eventId: "event-result-1",
            name: "TO_0000011_network_class.txt",
            mediaType: "text/plain",
            sizeBytes: 530_383,
            target: { kind: "artifact", id: "artifact-1" },
          },
          {
            eventId: "event-result-2",
            name: "other-result.csv",
            mediaType: "text/csv",
            sizeBytes: 10,
            target: { kind: "artifact", id: "artifact-2" },
          },
        ]
      )
    ).toBe("TO_0000011_network_class.txt");
  });

  it("saves the raw Blob returned by the authenticated interceptor", async () => {
    const blob = new Blob(["Node\thormone_type\tTO_type"]);
    getTargetFile.mockResolvedValueOnce(blob as never);

    await downloadExecutionArtifact({
      deliveryUrl:
        "/api/v1/executions/turn-1/targets/artifact/artifact-1/content",
      name: "TO_0000011_network_class.txt",
      requestId: "execution-download-artifact-1",
    });

    expect(saveFile).toHaveBeenCalledWith(blob, "TO_0000011_network_class.txt");
  });

  it("downloads through the authenticated blob transport and preserves the filename", async () => {
    const blob = new Blob(["result"]);
    getTargetFile.mockResolvedValueOnce({ data: blob, headers: {} } as never);

    await downloadExecutionArtifact({
      deliveryUrl:
        "/api/v1/executions/turn-1/targets/artifact/artifact-1/content",
      name: "network-report.pdf",
      requestId: "execution-download-artifact-1",
    });

    expect(getTargetFile).toHaveBeenCalledWith(
      "/api/v1/executions/turn-1/targets/artifact/artifact-1/content",
      { requestId: "execution-download-artifact-1" }
    );
    expect(saveFile).toHaveBeenCalledWith(blob, "network-report.pdf");
  });

  it("rejects a non-blob response instead of saving untrusted content", async () => {
    getTargetFile.mockResolvedValueOnce({
      data: "forbidden",
      headers: {},
    } as never);

    await expect(
      downloadExecutionArtifact({
        deliveryUrl:
          "/api/v1/executions/turn-1/targets/artifact/artifact-1/content",
        name: "../unsafe.pdf",
        requestId: "execution-download-artifact-1",
      })
    ).rejects.toThrow("Invalid execution target content");
    expect(saveFile).not.toHaveBeenCalled();
  });
});
