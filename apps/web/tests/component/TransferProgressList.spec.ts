import { describe, it, expect, vi, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import TransferProgressList from "@/components/TransferProgressList.vue";
import type { TransferSnapshot } from "@/utils/transfer-progress";
import {
  upsertDownloadTransfer,
  clearDownloadTransfers,
} from "@/utils/download-transfers";

vi.mock("@/utils/request", () => ({
  abortRequest: vi.fn(),
}));

import { abortRequest } from "@/utils/request";

const snap: TransferSnapshot = {
  loaded: 512 * 1024,
  total: 1024 * 1024,
  percent: 50,
  etaSec: 12,
  indeterminate: false,
  phase: "download",
  requestId: "dl-req-1",
};

describe("TransferProgressList.vue", () => {
  afterEach(() => {
    clearDownloadTransfers();
  });

  it("shows active downloads and aborts on cancel", async () => {
    clearDownloadTransfers();
    upsertDownloadTransfer(snap);

    const wrapper = mount(TransferProgressList, {
      global: {
        stubs: {
          "el-progress": true,
        },
      },
    });

    expect(wrapper.find('[data-test="transfer-progress-list"]').exists()).toBe(
      true,
    );
    expect(wrapper.findAll('[data-test="transfer-progress"]')).toHaveLength(1);

    await wrapper.find('[data-test="transfer-cancel"]').trigger("click");
    expect(abortRequest).toHaveBeenCalledWith("dl-req-1");
  });
});
