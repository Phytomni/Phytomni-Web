import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mountWithApp } from "../helpers/test-app-context";
import AttachmentChipStrip from "@/views/chat/components/AttachmentChipStrip.vue";
import type { ResumableUploadItem } from "@/views/chat/upload/types";

const STRIP_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/components/AttachmentChipStrip.vue"),
  "utf8"
);

function makeItem(
  index: number,
  overrides: Partial<ResumableUploadItem> = {}
): ResumableUploadItem {
  const name = `sample-${index}.fastq.gz`;
  const size = 4 * 1024;
  return {
    localId: `upload-${index}`,
    file: new File([new Uint8Array(size)], name, {
      type: "application/gzip",
    }),
    assetId: null,
    name,
    size,
    type: "application/gzip",
    lastModified: index,
    status: "uploading",
    partSize: size,
    partCount: 1,
    receivedParts: [],
    loadedBytes: size / 2,
    instantaneousSpeedBytesPerSecond: 512,
    speedBytesPerSecond: 512,
    etaSeconds: 4,
    retryCount: 0,
    errorCode: null,
    ...overrides,
  };
}

const mountStrip = (items: readonly ResumableUploadItem[]) =>
  mountWithApp(AttachmentChipStrip, { props: { items } });

describe("AttachmentChipStrip", () => {
  it("renders no strip when there are no attachments", () => {
    const wrapper = mountStrip([]);

    expect(wrapper.find('[data-testid="attachment-chip-strip"]').exists()).toBe(
      false
    );
  });

  it.each([1, 2, 3])("renders %s direct chip(s) without overflow", (count) => {
    const wrapper = mountStrip(
      Array.from({ length: count }, (_, index) => makeItem(index + 1))
    );

    expect(wrapper.findAll('[data-testid="attachment-chip"]')).toHaveLength(
      count
    );
    expect(
      wrapper.find('[data-testid="attachment-chip-overflow"]').exists()
    ).toBe(false);
  });

  it.each([
    [4, 1],
    [10, 7],
  ])(
    "renders exactly three direct chips and the exact overflow for %s items",
    (count, hiddenCount) => {
      const wrapper = mountStrip(
        Array.from({ length: count }, (_, index) => makeItem(index + 1))
      );

      expect(wrapper.findAll('[data-testid="attachment-chip"]')).toHaveLength(
        3
      );
      expect(
        wrapper.get('[data-testid="attachment-chip-overflow"]').text()
      ).toContain(`+${hiddenCount} more`);
    }
  );

  it("retains the bounded full basename in the chip accessible name", () => {
    const longName = `${"long-gene-sequence-".repeat(10)}reads.fastq.gz`;
    const wrapper = mountStrip([makeItem(1, { name: longName })]);
    const chip = wrapper.get('[data-testid="attachment-chip"]');

    expect(chip.attributes("aria-label")).toContain(longName);
    expect(wrapper.get('[data-testid="attachment-chip-name"]').text()).toBe(
      longName
    );
    expect(STRIP_SOURCE).toContain("text-overflow: ellipsis");
  });

  it("shows a file glyph, suffix, status, size and real progress without purpose", () => {
    const wrapper = mountStrip([makeItem(1)]);
    const chip = wrapper.get('[data-testid="attachment-chip"]');

    expect(
      chip.find('[data-testid="attachment-chip-file-icon"]').exists()
    ).toBe(true);
    expect(chip.get('[data-testid="attachment-chip-suffix"]').text()).toBe(
      "GZ"
    );
    expect(chip.get('[data-testid="attachment-chip-status"]').text()).toBe(
      "Uploading"
    );
    expect(chip.get('[data-testid="attachment-chip-metric"]').text()).toMatch(
      /2\.0 KB \/ 4\.0 KB \(50%\)/
    );
    expect(chip.text()).not.toMatch(
      /Reference material|Analysis data|dataset|document/i
    );
  });

  it("includes hidden failed and expired counts in visible and accessible overflow text", () => {
    const items = [
      makeItem(1, { status: "completed" }),
      makeItem(2, { status: "completed" }),
      makeItem(3, { status: "completed" }),
      makeItem(4, { status: "failed" }),
      makeItem(5, { status: "expired" }),
      makeItem(6, { status: "failed" }),
      makeItem(7, { status: "completed" }),
    ];
    const wrapper = mountStrip(items);
    const overflow = wrapper.get('[data-testid="attachment-chip-overflow"]');

    expect(overflow.text()).toContain("+4 more");
    expect(overflow.text()).toContain("2 failed");
    expect(overflow.text()).toContain("1 expired");
    expect(overflow.attributes("aria-label")).toContain("+4 more");
    expect(overflow.attributes("aria-label")).toContain("2 failed");
    expect(overflow.attributes("aria-label")).toContain("1 expired");
  });

  it("emits the selected attachment identity from direct and overflow controls", async () => {
    const wrapper = mountStrip(
      Array.from({ length: 4 }, (_, index) => makeItem(index + 1))
    );

    await wrapper.get('[data-testid="attachment-chip"]').trigger("click");
    await wrapper
      .get('[data-testid="attachment-chip-overflow"]')
      .trigger("click");

    expect(wrapper.emitted("select")?.[0]).toEqual(["upload-1"]);
    expect(wrapper.emitted("select")?.[1]).toEqual(["upload-4"]);
  });

  it("uses one non-wrapping scroll row, semantic tokens, and installed icons", () => {
    expect(STRIP_SOURCE).toContain("flex-wrap: nowrap");
    expect(STRIP_SOURCE).toContain("overflow-x: auto");
    expect(STRIP_SOURCE).toContain("@element-plus/icons-vue");
    expect(STRIP_SOURCE).toMatch(/var\(--phy-[^)]+\)/);
    expect(STRIP_SOURCE).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(STRIP_SOURCE).not.toMatch(/<svg\b/i);
  });
});
