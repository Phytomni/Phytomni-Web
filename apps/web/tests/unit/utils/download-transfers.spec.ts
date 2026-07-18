import { describe, it, expect } from "vitest";
import {
  upsertDownloadTransfer,
  removeDownloadTransfer,
  listDownloadTransfers,
  clearDownloadTransfers,
} from "@/utils/download-transfers";
import type { TransferSnapshot } from "@/utils/transfer-progress";

function snap(id: string, pct: number): TransferSnapshot {
  return {
    loaded: pct,
    total: 100,
    percent: pct,
    etaSec: 1,
    indeterminate: false,
    phase: "download",
    requestId: id,
  };
}

describe("download-transfers", () => {
  it("tracks parallel downloads and removes one id", () => {
    clearDownloadTransfers();
    upsertDownloadTransfer(snap("a", 10));
    upsertDownloadTransfer(snap("b", 20));
    expect(listDownloadTransfers()).toHaveLength(2);
    removeDownloadTransfer("a");
    expect(listDownloadTransfers().map((s) => s.requestId)).toEqual(["b"]);
  });
});
