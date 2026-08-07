import { describe, expect, it } from "vitest";
import { nextTick } from "vue";
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

const mountStrip = (
  items: readonly ResumableUploadItem[],
  announcement = "",
  announcementNonce = 0
) =>
  mountWithApp(AttachmentChipStrip, {
    props: { items, announcement, announcementNonce },
  });

async function observeLiveRegionMutations(
  element: Element,
  update: () => Promise<void>
): Promise<MutationRecord[]> {
  const records: MutationRecord[] = [];
  const observer = new MutationObserver((mutations) =>
    records.push(...mutations)
  );
  observer.observe(element, {
    characterData: true,
    characterDataOldValue: true,
    childList: true,
    subtree: true,
  });
  await update();
  await nextTick();
  await nextTick();
  await Promise.resolve();
  records.push(...observer.takeRecords());
  observer.disconnect();
  return records;
}

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

  it("opens bounded details from direct, overflow, Enter, and Space controls", async () => {
    const wrapper = mountStrip(
      Array.from({ length: 4 }, (_, index) => makeItem(index + 1))
    );
    const direct = wrapper.get('[data-testid="attachment-chip"]');
    const overflow = wrapper.get('[data-testid="attachment-chip-overflow"]');

    await direct.trigger("click");
    expect(
      wrapper.get('[data-testid="attachment-chip-detail"]').text()
    ).toContain("sample-1.fastq.gz");

    await wrapper
      .get('[data-testid="attachment-chip-detail"]')
      .trigger("keydown", {
        key: "Escape",
      });
    expect(
      wrapper.find('[data-testid="attachment-chip-detail"]').exists()
    ).toBe(false);

    await overflow.trigger("keydown", { key: "Enter" });
    expect(
      wrapper.get('[data-testid="attachment-chip-detail"]').text()
    ).toContain("sample-4.fastq.gz");

    await wrapper
      .get('[data-testid="attachment-chip-detail"]')
      .trigger("keydown", {
        key: "Escape",
      });
    await direct.trigger("keydown", { key: " " });
    expect(
      wrapper.get('[data-testid="attachment-chip-detail"]').text()
    ).toContain("sample-1.fastq.gz");
  });

  it("lets the overflow detail select every retained hidden attachment", async () => {
    const wrapper = mountStrip(
      Array.from({ length: 6 }, (_, index) => makeItem(index + 1))
    );

    await wrapper
      .get('[data-testid="attachment-chip-overflow"]')
      .trigger("click");
    const hiddenItems = wrapper.findAll(
      '[data-testid="attachment-chip-overflow-item"]'
    );

    expect(hiddenItems).toHaveLength(3);
    await hiddenItems[2].trigger("keydown", { key: "Enter" });
    expect(
      wrapper.get('[data-testid="attachment-chip-detail"]').text()
    ).toContain("sample-6.fastq.gz");
    expect(wrapper.emitted("select")?.at(-1)).toEqual(["upload-6"]);
  });

  it("shows transfer facts and state-specific actions with exact local IDs", async () => {
    const item = makeItem(1);
    const wrapper = mountStrip([item]);

    await wrapper.get('[data-testid="attachment-chip"]').trigger("click");

    expect(
      wrapper.get('[data-testid="attachment-chip-detail-progress"]').text()
    ).toContain("2.0 KB / 4.0 KB (50%)");
    expect(
      wrapper.get('[data-testid="attachment-chip-detail-speed"]').text()
    ).toContain("512 B/s");
    expect(
      wrapper.get('[data-testid="attachment-chip-detail-eta"]').text()
    ).toContain("About 4s left");

    await wrapper
      .get('[data-testid="attachment-chip-detail-pause"]')
      .trigger("click");
    await wrapper
      .get('[data-testid="attachment-chip-detail-cancel"]')
      .trigger("click");
    await wrapper
      .get('[data-testid="attachment-chip-detail-remove"]')
      .trigger("click");

    expect(wrapper.emitted("pause")).toEqual([[item.localId]]);
    expect(wrapper.emitted("cancel")).toEqual([[item.localId]]);
    expect(wrapper.emitted("remove")).toEqual([[item.localId]]);
  });

  it("emits resume, retry, reselect, and remove from their appropriate detail states", async () => {
    const paused = makeItem(1, { status: "paused" });
    const failed = makeItem(2, { status: "failed", file: null });
    const wrapper = mountStrip([paused, failed]);

    await wrapper.get('[data-testid="attachment-chip"]').trigger("click");
    await wrapper
      .get('[data-testid="attachment-chip-detail-resume"]')
      .trigger("click");
    expect(wrapper.emitted("resume")).toEqual([[paused.localId]]);

    await wrapper
      .get('[data-testid="attachment-chip-detail"]')
      .trigger("keydown", {
        key: "Escape",
      });
    await wrapper
      .findAll('[data-testid="attachment-chip"]')[1]
      .trigger("click");
    await wrapper
      .get('[data-testid="attachment-chip-detail-retry"]')
      .trigger("click");
    await wrapper
      .get('[data-testid="attachment-chip-detail-reselect"]')
      .trigger("click");

    const input = wrapper.get('[data-testid="attachment-chip-reselect-input"]');
    expect(input.attributes("accept")).toBeUndefined();
    const replacement = new File(["replacement"], "replacement.fastq.gz", {
      type: "application/gzip",
    });
    Object.defineProperty(input.element, "files", {
      configurable: true,
      value: [replacement],
    });
    await input.trigger("change");

    expect(wrapper.emitted("retry")).toEqual([[failed.localId]]);
    expect(wrapper.emitted("reselect")).toEqual([
      [failed.localId, replacement],
    ]);
    expect((input.element as HTMLInputElement).value).toBe("");
  });

  it("restores origin focus after Escape and keeps details above the editor", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const wrapper = mountWithApp(AttachmentChipStrip, {
      attachTo: host,
      props: { items: [makeItem(1)] },
    });
    const chip = wrapper.get('[data-testid="attachment-chip"]');
    const strip = wrapper.get('[data-testid="attachment-chip-strip"]');
    Object.defineProperty(strip.element, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ top: 240 }),
    });
    (chip.element as HTMLButtonElement).focus();

    await chip.trigger("click");
    const detail = wrapper.get('[data-testid="attachment-chip-detail"]');
    expect(document.activeElement).toBe(detail.element);
    expect(detail.element.parentElement).toBe(strip.element);
    expect(detail.element.parentElement).not.toBe(
      wrapper.get(".attachment-chip-strip__row").element
    );
    expect(detail.attributes("style")).toContain(
      "--attachment-chip-detail-max-block-size: 224px"
    );

    await detail.trigger("keydown", { key: "Escape" });
    expect(
      wrapper.find('[data-testid="attachment-chip-detail"]').exists()
    ).toBe(false);
    expect(document.activeElement).toBe(chip.element);
    expect(STRIP_SOURCE).toContain("attachment-chip-strip__row");
    expect(STRIP_SOURCE).toContain("overflow: visible");
    expect(STRIP_SOURCE).toContain("overflow-y: auto");
    expect(STRIP_SOURCE).not.toContain("inset-block-start");

    wrapper.unmount();
    host.remove();
  });

  it.each([
    ["completed", "4.0 KB / 4.0 KB (100%)"],
    ["failed", "1.0 KB / 4.0 KB (25%)"],
    ["expired", "1.0 KB / 4.0 KB (25%)"],
  ] as const)(
    "keeps exact progress while suppressing stale speed and ETA for %s details",
    async (status, progress) => {
      const wrapper = mountStrip([
        makeItem(1, {
          status,
          loadedBytes: status === "completed" ? 4 * 1024 : 1024,
          speedBytesPerSecond: 1024,
          etaSeconds: 0,
        }),
      ]);

      await wrapper.get('[data-testid="attachment-chip"]').trigger("click");

      expect(
        wrapper.find('[data-testid="attachment-chip-detail-speed"]').exists()
      ).toBe(false);
      expect(
        wrapper.find('[data-testid="attachment-chip-detail-eta"]').exists()
      ).toBe(false);
      expect(
        wrapper.get('[data-testid="attachment-chip-detail-progress"]').text()
      ).toContain(progress);
    }
  );

  it("uses one non-wrapping scroll row, semantic tokens, and installed icons", () => {
    expect(STRIP_SOURCE).toContain("flex-wrap: nowrap");
    expect(STRIP_SOURCE).toContain("overflow-x: auto");
    expect(STRIP_SOURCE).toContain("@element-plus/icons-vue");
    expect(STRIP_SOURCE).toMatch(/var\(--phy-[^)]+\)/);
    expect(STRIP_SOURCE).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(STRIP_SOURCE).not.toMatch(/<svg\b/i);
  });

  it("keeps direct chips, overflow, hidden items, and detail actions in logical tab order", async () => {
    const wrapper = mountStrip(
      Array.from({ length: 5 }, (_, index) => makeItem(index + 1))
    );

    expect(
      wrapper
        .findAll("button")
        .map((button) => button.attributes("data-testid"))
    ).toEqual([
      "attachment-chip",
      "attachment-chip",
      "attachment-chip",
      "attachment-chip-overflow",
    ]);

    await wrapper
      .get('[data-testid="attachment-chip-overflow"]')
      .trigger("click");

    const focusableControls = wrapper.findAll("button");
    expect(
      focusableControls.map((button) => button.attributes("data-testid"))
    ).toEqual([
      "attachment-chip",
      "attachment-chip",
      "attachment-chip",
      "attachment-chip-overflow",
      "attachment-chip-overflow-item",
      "attachment-chip-overflow-item",
      "attachment-chip-detail-pause",
      "attachment-chip-detail-cancel",
      "attachment-chip-detail-remove",
    ]);
    expect(
      focusableControls.every(
        (button) => button.attributes("tabindex") === undefined
      )
    ).toBe(true);
    expect(
      wrapper
        .get('[data-testid="attachment-chip-detail"]')
        .attributes("tabindex")
    ).toBe("-1");
  });

  it("includes the file name in every file-specific compact control name", async () => {
    const item = makeItem(1);
    const wrapper = mountStrip([item]);
    const chip = wrapper.get('[data-testid="attachment-chip"]');

    expect(chip.attributes("aria-label")).toContain(item.name);
    await chip.trigger("click");

    for (const testId of [
      "attachment-chip-detail-pause",
      "attachment-chip-detail-cancel",
      "attachment-chip-detail-remove",
    ]) {
      expect(
        wrapper.get(`[data-testid="${testId}"]`).attributes("aria-label")
      ).toContain(item.name);
    }
    expect(STRIP_SOURCE).toContain('aria-hidden="true"');
  });

  it("exposes determinate transfer progress with numeric and textual semantics", async () => {
    const wrapper = mountStrip([makeItem(1)]);

    await wrapper.get('[data-testid="attachment-chip"]').trigger("click");
    const progress = wrapper.get(
      '[data-testid="attachment-chip-detail-progress"]'
    );

    expect(progress.attributes("role")).toBe("progressbar");
    expect(progress.attributes("aria-valuemin")).toBe("0");
    expect(progress.attributes("aria-valuemax")).toBe("100");
    expect(progress.attributes("aria-valuenow")).toBe("50");
    expect(progress.attributes("aria-valuetext")).toContain(
      "2.0 KB / 4.0 KB (50%)"
    );
  });

  it.each([
    ["completed", "Ready to send"],
    ["failed", "Upload failed"],
    ["paused", "Paused"],
    ["expired", "Session expired"],
  ] as const)(
    "announces a meaningful %s state transition without relying on color",
    async (status, label) => {
      const item = makeItem(1);
      const wrapper = mountStrip([item]);

      await wrapper.setProps({ items: [{ ...item, status }] });

      const liveRegion = wrapper.get(
        '[data-testid="attachment-chip-live-region"]'
      );
      expect(liveRegion.attributes("role")).toBe("status");
      expect(liveRegion.attributes("aria-live")).toBe("polite");
      expect(liveRegion.attributes("aria-atomic")).toBe("true");
      expect(liveRegion.text()).toContain(item.name);
      expect(liveRegion.text()).toContain(label);
      expect(
        wrapper.get('[data-testid="attachment-chip"]').attributes()
      ).toMatchObject({
        "data-state": status,
      });
      expect(wrapper.get('[data-testid="attachment-chip-status"]').text()).toBe(
        label
      );
    }
  );

  it("does not announce byte-by-byte progress updates", async () => {
    const item = makeItem(1);
    const wrapper = mountStrip([item]);
    const liveRegion = wrapper.get(
      '[data-testid="attachment-chip-live-region"]'
    );

    expect(liveRegion.text()).toBe("");
    await wrapper.setProps({
      items: [{ ...item, loadedBytes: item.loadedBytes + 512 }],
    });

    expect(liveRegion.text()).toBe("");
  });

  it("routes duplicate and rejection copy through the single polite live region", async () => {
    const item = makeItem(1);
    const wrapper = mountStrip(
      [item, makeItem(2)],
      `Already attached: ${item.name}`
    );
    const liveRegions = wrapper.findAll(
      '[data-testid="attachment-chip-live-region"]'
    );

    expect(liveRegions).toHaveLength(1);
    expect(liveRegions[0].text()).toBe(`Already attached: ${item.name}`);

    await wrapper.setProps({ announcement: "sample-2.fastq.gz was rejected" });
    expect(liveRegions[0].text()).toBe("sample-2.fastq.gz was rejected");
  });

  it.each([
    ["failed", "creating", "Upload failed"],
    ["paused", "uploading", "Paused"],
  ] as const)(
    "mutates the live region when %s recurs after an intermediate state",
    async (status, intermediateStatus, label) => {
      const item = makeItem(1);
      const wrapper = mountStrip([item]);
      await wrapper.setProps({ items: [{ ...item, status }] });
      const liveRegion = wrapper.get(
        '[data-testid="attachment-chip-live-region"]'
      );
      expect(liveRegion.text()).toContain(label);

      await wrapper.setProps({
        items: [{ ...item, status: intermediateStatus }],
      });
      const mutations = await observeLiveRegionMutations(
        liveRegion.element,
        () => wrapper.setProps({ items: [{ ...item, status }] })
      );

      expect(mutations.length).toBeGreaterThanOrEqual(2);
      expect(liveRegion.text()).toContain(item.name);
      expect(liveRegion.text()).toContain(label);
    }
  );

  it.each([
    `Already attached: sample-1.fastq.gz`,
    `sample-1.fastq.gz was rejected`,
  ])(
    "re-announces identical external text when its bounded nonce changes: %s",
    async (announcement) => {
      const wrapper = mountStrip([makeItem(1)], announcement, 1);
      const liveRegion = wrapper.get(
        '[data-testid="attachment-chip-live-region"]'
      );
      expect(liveRegion.text()).toBe(announcement);

      const mutations = await observeLiveRegionMutations(
        liveRegion.element,
        () => wrapper.setProps({ announcement, announcementNonce: 2 })
      );

      expect(mutations.length).toBeGreaterThanOrEqual(2);
      expect(liveRegion.text()).toBe(announcement);
    }
  );

  it("announces a rejected first file without rendering an empty strip", () => {
    const wrapper = mountStrip([], "unsupported.fastq was rejected");

    expect(wrapper.find('[data-testid="attachment-chip-strip"]').exists()).toBe(
      false
    );
    expect(
      wrapper.get('[data-testid="attachment-chip-live-region"]').text()
    ).toBe("unsupported.fastq was rejected");
  });

  it("uses token-sized touch targets and explicit reduced-motion and forced-color rules", () => {
    expect(STRIP_SOURCE).toMatch(
      /\.attachment-chip\s*\{[\s\S]*?min-block-size:\s*var\(--phy-control-height-default\)/
    );
    expect(STRIP_SOURCE).toMatch(
      /\.attachment-chip-detail__action\s*\{[\s\S]*?min-block-size:\s*var\(--phy-control-height-default\)/
    );
    expect(STRIP_SOURCE).toContain("@media (prefers-reduced-motion: reduce)");
    expect(STRIP_SOURCE).toContain("transition: none");
    expect(STRIP_SOURCE).toContain("@media (forced-colors: active)");
    expect(STRIP_SOURCE).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});
