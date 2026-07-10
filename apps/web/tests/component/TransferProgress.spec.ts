import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import TransferProgress from "@/components/TransferProgress.vue";
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

describe("TransferProgress.vue", () => {
  it("renders percent and emits cancel with requestId", async () => {
    const wrapper = mount(TransferProgress, {
      props: { snapshot: base },
      global: {
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
        stubs: {
          "el-progress": true,
        },
      },
    });
    expect(wrapper.find('[data-test="transfer-eta"]').exists()).toBe(false);
  });
});
