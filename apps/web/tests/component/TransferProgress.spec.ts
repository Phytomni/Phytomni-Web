import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import TransferProgress from "@/components/TransferProgress.vue";
import enUS from "@/locales/langs/en-US";
import type { TransferSnapshot } from "@/utils/transfer-progress";

const base: TransferSnapshot = {
  loaded: 512 * 1024,
  total: 1024 * 1024,
  percent: 50,
  etaSec: 12,
  indeterminate: false,
  phase: "upload",
  requestId: "req-1",
};

const i18n = createI18n({
  legacy: false,
  locale: "en-US",
  messages: { "en-US": enUS },
});

describe("TransferProgress.vue", () => {
  it("renders percent and emits cancel with requestId", async () => {
    const wrapper = mount(TransferProgress, {
      props: { snapshot: base },
      global: {
        plugins: [i18n],
        stubs: {
          "el-progress": {
            props: ["percentage", "indeterminate"],
            template:
              '<div data-test="bar" :data-pct="percentage" :data-ind="indeterminate" />',
          },
        },
      },
    });
    expect(wrapper.find('[data-test="bar"]').attributes("data-pct")).toBe("50");
    expect(wrapper.text()).toMatch(/KB|MB/);
    await wrapper.find('[data-test="transfer-cancel"]').trigger("click");
    expect(wrapper.emitted("cancel")?.[0]).toEqual(["req-1"]);
  });

  it("hides ETA when etaSec is null", () => {
    const wrapper = mount(TransferProgress, {
      props: { snapshot: { ...base, etaSec: null, indeterminate: true } },
      global: {
        plugins: [i18n],
        stubs: {
          "el-progress": true,
        },
      },
    });
    expect(wrapper.find('[data-test="transfer-eta"]').exists()).toBe(false);
  });

  it("exposes localized phase and determinate progress semantics", () => {
    const wrapper = mount(TransferProgress, {
      props: { snapshot: base },
      global: { plugins: [i18n], stubs: { "el-progress": true } },
    });

    const bar = wrapper.get('[role="progressbar"]');
    expect(wrapper.get('[data-test="transfer-phase"]').text()).toBe(
      "Uploading"
    );
    expect(wrapper.get('[data-test="transfer-progress-text"]').text()).toMatch(
      /Uploading:.*50%/
    );
    expect(bar.attributes("aria-valuenow")).toBe("50");
    expect(bar.attributes("aria-valuetext")).toMatch(/Uploading:.*50%/);
    expect(
      wrapper.get('[data-test="transfer-cancel"]').attributes("aria-label")
    ).toBe("Cancel");
  });

  it("exposes an indeterminate transfer without a false percentage", () => {
    const wrapper = mount(TransferProgress, {
      props: {
        snapshot: { ...base, phase: "download", indeterminate: true, total: 0 },
      },
      global: { plugins: [i18n], stubs: { "el-progress": true } },
    });

    const bar = wrapper.get('[role="progressbar"]');
    expect(wrapper.get('[data-test="transfer-phase"]').text()).toBe(
      "Downloading"
    );
    expect(wrapper.get('[data-test="transfer-progress-text"]').text()).toMatch(
      /Downloading:.*transferred/
    );
    expect(bar.attributes("aria-valuenow")).toBeUndefined();
    expect(bar.attributes("aria-valuetext")).toMatch(/Downloading/);
  });
});
