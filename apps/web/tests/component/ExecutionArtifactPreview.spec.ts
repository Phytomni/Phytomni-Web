import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";

vi.mock("@/api/chat", () => ({
  getExecutionTargetFile: vi.fn(),
}));

import { getExecutionTargetFile } from "@/api/chat";
import ExecutionWorkspace from "@/views/chat/components/ExecutionWorkspace.vue";
import {
  applyExecutionEvent,
  createExecutionRunState,
  type ExecutionEvent,
} from "@/views/chat/streaming/executionEvents";
import { mountWithApp } from "../helpers/test-app-context";

const getTargetFile = vi.mocked(getExecutionTargetFile);
const createObjectURL = vi.fn(() => "blob:execution-preview");
const revokeObjectURL = vi.fn();

function imageRun() {
  const event: ExecutionEvent = {
    schemaVersion: 2,
    eventId: "evt-image",
    executionId: "turn-1",
    runId: "turn-1",
    seq: 1,
    occurredAt: "2026-08-23T03:00:00Z",
    kind: "artifact.published",
    known: true,
    ignorable: false,
    status: "succeeded",
    summary: { key: "artifact.published", text: "Result published" },
    payload: {
      name: "network.svg",
      media_type: "application/octet-stream",
      size_bytes: 32,
    },
    target: { kind: "artifact", id: "artifact-image" },
  };
  return applyExecutionEvent(createExecutionRunState("turn-1"), event);
}

function pdfRun() {
  const event: ExecutionEvent = {
    schemaVersion: 2,
    eventId: "evt-pdf",
    executionId: "turn-1",
    runId: "turn-1",
    seq: 1,
    occurredAt: "2026-08-23T03:00:00Z",
    kind: "artifact.published",
    known: true,
    ignorable: false,
    status: "succeeded",
    summary: { key: "artifact.published", text: "Result published" },
    payload: {
      name: "network-report.pdf",
      media_type: "application/octet-stream",
      size_bytes: 8,
    },
    target: { kind: "artifact", id: "artifact-pdf" },
  };
  return applyExecutionEvent(createExecutionRunState("turn-1"), event);
}

describe("Execution workspace artifact preview", () => {
  beforeEach(() => {
    getTargetFile.mockReset();
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL,
      revokeObjectURL,
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("renders SVG only through an image Blob URL and revokes it", async () => {
    const svg = new Blob(['<svg onload="alert(1)"></svg>'], {
      type: "image/svg+xml",
    });
    getTargetFile.mockResolvedValueOnce({ data: svg, headers: {} } as never);
    const target = { kind: "artifact" as const, id: "artifact-image" };
    const wrapper = mountWithApp(ExecutionWorkspace, {
      props: {
        tabs: [
          { key: "artifact:artifact-image", target, title: "network.svg" },
        ],
        activeKey: "artifact:artifact-image",
        run: imageRun(),
        detail: {
          schemaVersion: 2 as const,
          executionId: "turn-1",
          kind: "artifact" as const,
          id: "artifact-image",
          eventId: "artifact-image",
          name: "network.svg",
          mediaType: "application/octet-stream",
          sizeBytes: svg.size,
          deliveryUrl:
            "/api/v1/executions/turn-1/targets/artifact/artifact-image/content",
          previewAvailable: true,
          todos: [],
        },
      },
    });

    await flushPromises();
    const image = wrapper.get<HTMLImageElement>(".execution-workspace__image");
    expect(image.attributes("src")).toBe("blob:execution-preview");
    expect(wrapper.html()).not.toContain('onload="alert(1)"');
    expect(createObjectURL).toHaveBeenCalledWith(svg);

    wrapper.unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:execution-preview");
  });

  it("does not embed a protected delivery URL when Blob URLs are unavailable", async () => {
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: undefined,
      revokeObjectURL,
    });
    const png = new Blob(["png"], { type: "image/png" });
    getTargetFile.mockResolvedValueOnce({ data: png, headers: {} } as never);
    const target = { kind: "artifact" as const, id: "artifact-image" };
    const deliveryUrl =
      "/api/v1/executions/turn-1/targets/artifact/artifact-image/content";
    const wrapper = mountWithApp(ExecutionWorkspace, {
      props: {
        tabs: [
          { key: "artifact:artifact-image", target, title: "network.png" },
        ],
        activeKey: "artifact:artifact-image",
        run: imageRun(),
        detail: {
          schemaVersion: 2 as const,
          executionId: "turn-1",
          kind: "artifact" as const,
          id: "artifact-image",
          eventId: "artifact-image",
          name: "network.png",
          mediaType: "image/png",
          sizeBytes: png.size,
          deliveryUrl,
          previewAvailable: true,
          todos: [],
        },
      },
    });

    await flushPromises();
    expect(wrapper.find(".execution-workspace__image").exists()).toBe(false);
    expect(wrapper.get(".execution-workspace__notice").text()).toContain(
      "safe preview"
    );
    expect(wrapper.html()).not.toContain(`src="${deliveryUrl}"`);
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it("renders a generic-media PDF through an authenticated Blob URL", async () => {
    const pdf = new Blob(["%PDF-1.7"], { type: "application/octet-stream" });
    getTargetFile.mockResolvedValueOnce({ data: pdf, headers: {} } as never);
    const target = { kind: "artifact" as const, id: "artifact-pdf" };
    const wrapper = mountWithApp(ExecutionWorkspace, {
      props: {
        tabs: [
          {
            key: "artifact:artifact-pdf",
            target,
            title: "network-report.pdf",
          },
        ],
        activeKey: "artifact:artifact-pdf",
        run: pdfRun(),
        detail: {
          schemaVersion: 2 as const,
          executionId: "turn-1",
          kind: "artifact" as const,
          id: "artifact-pdf",
          eventId: "artifact-pdf",
          name: "network-report.pdf",
          mediaType: "application/octet-stream",
          sizeBytes: pdf.size,
          deliveryUrl:
            "/api/v1/executions/turn-1/targets/artifact/artifact-pdf/content",
          previewAvailable: true,
          todos: [],
        },
      },
    });

    await flushPromises();
    expect(
      wrapper
        .get<HTMLObjectElement>(".execution-workspace__pdf")
        .attributes("data")
    ).toBe("blob:execution-preview");
    expect(wrapper.find(".execution-workspace__notice").exists()).toBe(false);
  });
});
