import { describe, it, expect } from "vitest";
import {
  createTransferTracker,
  formatBytes,
  formatEta,
} from "@/utils/transfer-progress";

describe("transfer-progress", () => {
  it("formatBytes renders KB/MB", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
  });

  it("formatEta returns null for null/negative", () => {
    expect(formatEta(null)).toBeNull();
    expect(formatEta(-1)).toBeNull();
  });

  it("known total → percent and eventually ETA", () => {
    const t = createTransferTracker({
      phase: "upload",
      requestId: "r1",
    });
    const s0 = t.update({ loaded: 0, total: 1000 }, 1_000);
    expect(s0.indeterminate).toBe(false);
    expect(s0.percent).toBe(0);
    expect(s0.etaSec).toBeNull(); // cold start

    const s1 = t.update({ loaded: 500, total: 1000 }, 2_000); // 500 B/s
    expect(s1.percent).toBe(50);
    expect(s1.loaded).toBe(500);
    expect(s1.total).toBe(1000);
    expect(s1.etaSec).toBeGreaterThan(0);
    expect(s1.phase).toBe("upload");
    expect(s1.requestId).toBe("r1");
  });

  it("total 0 → indeterminate, null ETA, still tracks loaded", () => {
    const t = createTransferTracker({
      phase: "download",
      requestId: "d1",
    });
    const s = t.update({ loaded: 4096, total: 0 }, 1_000);
    expect(s.indeterminate).toBe(true);
    expect(s.percent).toBe(0);
    expect(s.etaSec).toBeNull();
    expect(s.loaded).toBe(4096);
  });

  it("reset clears samples", () => {
    const t = createTransferTracker({ phase: "upload", requestId: "r1" });
    t.update({ loaded: 100, total: 1000 }, 1_000);
    t.reset();
    const s = t.update({ loaded: 0, total: 1000 }, 5_000);
    expect(s.etaSec).toBeNull();
  });
});
