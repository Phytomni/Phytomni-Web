import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mountWithApp } from "../helpers/test-app-context";
import ChatUploadCard from "@/views/chat/components/ChatUploadCard.vue";
import type {
  ResumableUploadItem,
  UploadStatus,
} from "@/views/chat/upload/types";

const CARD_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/components/ChatUploadCard.vue"),
  "utf8"
);

function makeItem(
  overrides: Partial<ResumableUploadItem> = {}
): ResumableUploadItem {
  return {
    localId: "upload-1",
    file: new File([new Uint8Array(1024)], "sample.bam", {
      type: "application/octet-stream",
    }),
    assetId: null,
    name: "sample.bam",
    size: 1024,
    type: "application/octet-stream",
    lastModified: 1,
    purpose: "document",
    status: "uploading",
    partSize: 1024,
    partCount: 1,
    receivedParts: [],
    loadedBytes: 512,
    speedBytesPerSecond: 256,
    etaSeconds: 2,
    retryCount: 0,
    errorCode: null,
    ...overrides,
  };
}

const statusLabels: Array<[UploadStatus, string]> = [
  ["queued", "Queued"],
  ["creating", "Preparing"],
  ["uploading", "Uploading"],
  ["paused", "Paused"],
  ["failed", "Upload failed"],
  ["completing", "Finalizing"],
  ["completed", "Ready to send"],
  ["expired", "Session expired"],
];

function mountCard(item: ResumableUploadItem, attachToDocument = false) {
  return mountWithApp(ChatUploadCard, {
    props: { item },
    attachTo: attachToDocument ? document.body : undefined,
  });
}

describe("ChatUploadCard", () => {
  it.each([
    ["document", "Reference material"],
    ["dataset", "Analysis data"],
  ] as const)(
    "renders the localized immutable %s purpose",
    (purpose, label) => {
      const wrapper = mountCard(makeItem({ purpose }));

      expect(wrapper.get('[data-testid="chat-upload-purpose"]').text()).toBe(
        label
      );
      expect(
        wrapper.find('[data-testid="chat-upload-purpose"] button').exists()
      ).toBe(false);
    }
  );

  it.each(statusLabels)(
    "renders the %s lifecycle status with real progress semantics",
    (status, label) => {
      const wrapper = mountCard(
        makeItem({
          status,
          loadedBytes: status === "completed" ? 1024 : 512,
        })
      );

      expect(wrapper.get('[data-testid="chat-upload-status"]').text()).toBe(
        label
      );
      expect(
        wrapper.get('[data-testid="chat-upload-status"]').attributes("role")
      ).toBe("status");
      expect(
        wrapper
          .get('[data-testid="chat-upload-status"]')
          .attributes("aria-live")
      ).toBe("polite");

      const progress = wrapper.get('[data-testid="chat-upload-progress"]');
      expect(progress.attributes("aria-valuemin")).toBe("0");
      expect(progress.attributes("aria-valuemax")).toBe("100");
      expect(progress.attributes("aria-valuenow")).toBe(
        status === "completed" ? "100" : "50"
      );
      expect(progress.attributes("aria-valuetext")).toContain("%");
      expect(wrapper.get('[data-testid="chat-upload-metrics"]').text()).toMatch(
        /512 B|1.0 KB/
      );
    }
  );

  it("exposes every recovery action as a labeled button", async () => {
    const pause = mountCard(makeItem({ status: "uploading" }), true);
    await pause.get('[data-testid="chat-upload-pause"]').trigger("click");
    await pause.get('[data-testid="chat-upload-cancel"]').trigger("click");
    await pause.get('[data-testid="chat-upload-remove"]').trigger("click");
    expect(pause.emitted("pause")?.[0]).toEqual(["upload-1"]);
    expect(pause.emitted("cancel")?.[0]).toEqual(["upload-1"]);
    expect(pause.emitted("remove")?.[0]).toEqual(["upload-1"]);

    const resume = mountCard(makeItem({ status: "paused" }));
    await resume.get('[data-testid="chat-upload-resume"]').trigger("click");
    expect(resume.emitted("resume")?.[0]).toEqual(["upload-1"]);

    const retry = mountCard(makeItem({ status: "failed" }));
    await retry.get('[data-testid="chat-upload-retry"]').trigger("click");
    expect(retry.emitted("retry")?.[0]).toEqual(["upload-1"]);

    for (const button of pause.findAll("button")) {
      expect(button.attributes("type")).toBe("button");
      expect(button.attributes("aria-label")).toBeTruthy();
      (button.element as HTMLButtonElement).focus();
      expect(document.activeElement).toBe(button.element);
    }
  });

  it("lets recovered sessions reselect the original file without an accept filter", async () => {
    const wrapper = mountCard(makeItem({ file: null, status: "expired" }));
    const input = wrapper.get<HTMLInputElement>(
      '[data-testid="chat-upload-card"] input[type="file"]'
    );
    expect(input.attributes("accept")).toBeUndefined();
    expect(input.attributes("tabindex")).toBe("-1");

    const replacement = new File(["restored"], "sample.bam", {
      type: "application/octet-stream",
    });
    Object.defineProperty(input.element, "files", {
      configurable: true,
      value: [replacement],
    });
    await input.trigger("change");

    expect(wrapper.emitted("reselect")?.[0]).toEqual(["upload-1", replacement]);
    expect((input.element as HTMLInputElement).value).toBe("");
  });

  it("keeps focusable controls visible and adaptable at narrow widths", () => {
    expect(CARD_SOURCE).toContain(".chat-upload-card__name");
    expect(CARD_SOURCE).toContain("text-overflow: ellipsis");
    expect(CARD_SOURCE).toContain(".chat-upload-card__actions");
    expect(CARD_SOURCE).toContain("flex-wrap: wrap");
    expect(CARD_SOURCE).toContain("@media (max-width: 359px)");
    expect(CARD_SOURCE).toContain("flex: 1 1 auto");
    expect(CARD_SOURCE).toContain(".chat-upload-card__action:focus-visible");
    expect(CARD_SOURCE).toMatch(/var\(--phy-[^)]+\)/);
    expect(CARD_SOURCE).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it("does not make the whole card a click target", () => {
    const wrapper = mountCard(makeItem({ status: "completed" }));
    expect(
      wrapper.get('[data-testid="chat-upload-card"]').attributes("role")
    ).toBe(undefined);
    expect(
      wrapper.find('[data-testid="chat-upload-card"] button').exists()
    ).toBe(true);
  });

  it("does not emit a pause action for a completed upload", () => {
    const wrapper = mountCard(makeItem({ status: "completed" }));
    expect(wrapper.find('[data-testid="chat-upload-pause"]').exists()).toBe(
      false
    );
    expect(wrapper.find('[data-testid="chat-upload-cancel"]').exists()).toBe(
      false
    );
  });
});
