import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";

const requestMock = vi.hoisted(() => vi.fn());
vi.mock("@/utils/request", () => ({
  default: requestMock,
  createAbortableRequest: requestMock,
}));

import BotArtifactList from "@/components/research/BotArtifactList.vue";
import { downloadArtifact } from "@/api/chat";
import type { BotArtifact } from "@/views/chat/botProjection";

describe("BotArtifactList provenance boundary", () => {
  it("uses the approved server-issued OBS download action", async () => {
    requestMock.mockResolvedValueOnce({ code: 200, data: "signed" });

    await downloadArtifact("/obs/bucket/run-1");

    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/api/v1/downloads/analyst-agent/obs-file",
        method: "get",
        params: { obs_path: "/obs/bucket/run-1" },
      })
    );
    const requestConfig = JSON.stringify(requestMock.mock.calls[0]);
    expect(requestConfig).not.toContain("href");
    expect(requestConfig).not.toContain("downloadUrl");
    expect(requestConfig).not.toContain("provider_secret");
    requestMock.mockClear();
  });

  it("calls the approved download API instead of constructing an href", async () => {
    const downloadArtifact = vi.fn();
    const artifacts: BotArtifact[] = [
      {
        outputDir: "/obs/bucket/run-1",
        paths: ["/obs/bucket/run-1/output.zip"],
      },
    ];
    const wrapper = mount(BotArtifactList, {
      props: {
        artifacts,
        runId: "run-1",
        downloadArtifact,
        emptyLabel: "No artifacts",
      },
    });

    await wrapper.get('[data-test="bot-artifact-download"]').trigger("click");

    expect(downloadArtifact).toHaveBeenCalledWith("run-1", "output.zip");
    expect(wrapper.element.querySelector('a[href*="obs"]')).toBeNull();
    expect(wrapper.html()).not.toContain("/obs/");
  });

  it("keeps malformed paths warning-only and never exposes private diagnostics", () => {
    const wrapper = mount(BotArtifactList, {
      props: {
        artifacts: [
          {
            outputDir: "/obs/bucket/run-1",
            paths: [
              "/obs/bucket/run-1/../private.txt",
              "http://private/secret",
            ],
          },
        ],
        runId: "run-1",
        downloadArtifact: vi.fn(),
        emptyLabel: "No artifacts",
      },
    });

    expect(wrapper.get('[data-test="bot-artifact-warning"]').text()).toBe(
      "No artifacts"
    );
    expect(wrapper.find('[data-test="bot-artifact-download"]').exists()).toBe(
      false
    );
    expect(wrapper.text()).not.toContain("private");
    expect(wrapper.text()).not.toContain("provider_secret");
  });
});
