import { describe, expect, it } from "vitest";

import intermediateFixture from "../../../fixtures/bot-head/projection-intermediate.json";
import finalFixture from "../../../fixtures/bot-head/projection-final.json";
import degradedFixture from "../../../fixtures/bot-head/projection-degraded.json";
import {
  MAX_BOT_ARTIFACTS,
  MAX_BOT_FAILURES,
  MAX_BOT_FAILURE_LENGTH,
  MAX_BOT_REPORT_LENGTH,
  parseBotProjection,
  visibleBotReport,
} from "@/views/chat/botProjection";

describe("parseBotProjection", () => {
  it("prefers final report and keeps revision metadata", () => {
    const projection = parseBotProjection(intermediateFixture);

    expect(projection.reportRevision).toBe(2);
    expect(visibleBotReport(projection)).toBe("# Intermediate");
    expect(visibleBotReport(parseBotProjection(finalFixture))).toBe("# Final");
    expect(projection.runId).toBe("run-dg-1");
    expect(projection.status).toBe("RUNNING");
  });

  it("keeps degraded failures and the explicit null tracking identity", () => {
    const projection = parseBotProjection(degradedFixture);

    expect(projection.runId).toBeNull();
    expect(projection.trackingDegraded).toBe(true);
    expect(projection.degraded).toBe(true);
    expect(projection.degradedReason).toBe("Final synthesis unavailable");
    expect(projection.failures).toEqual([
      "final synthesis failed",
      "Optional analysis unavailable",
    ]);
    expect(visibleBotReport(projection)).toBe("# Partial report");
  });

  it("preserves legacy revision -1", () => {
    expect(parseBotProjection({ report_revision: -1 }).reportRevision).toBe(-1);
    expect(() => parseBotProjection({ report_revision: -2 })).toThrow(
      /report_revision/
    );
  });

  it("preserves sanitized Markdown line breaks", () => {
    expect(
      visibleBotReport(
        parseBotProjection({
          status: "RUNNING",
          intermediate_report: "# Heading\n\n- one\n- two",
        })
      )
    ).toBe("# Heading\n\n- one\n- two");
  });

  it("accepts bounded OBS paths in both documented forms and never creates a download URL", () => {
    const projection = parseBotProjection(finalFixture);

    expect(projection.artifacts).toEqual([
      {
        outputDir: "/obs/synthetic-bucket/run-dg-1",
        paths: [
          "/obs/synthetic-bucket/run-dg-1/report.md",
          "/obs/synthetic-bucket/run-dg-1/data.tsv",
        ],
      },
    ]);
    expect(
      parseBotProjection({
        artifacts: [
          {
            output_dir: "obs://bucket/run",
            paths: ["obs://bucket/run/report.md"],
          },
        ],
      }).artifacts
    ).toEqual([
      {
        outputDir: "obs://bucket/run",
        paths: ["obs://bucket/run/report.md"],
      },
    ]);
    expect(projection.artifacts[0]).not.toHaveProperty("downloadUrl");
    expect(parseBotProjection(degradedFixture).artifacts).toEqual([]);
    expect(
      parseBotProjection({
        artifacts: [{ output_dir: "/obs/bucket/empty", paths: [] }],
      }).artifacts
    ).toEqual([{ outputDir: "/obs/bucket/empty", paths: [] }]);
    expect(() =>
      parseBotProjection({
        artifacts: [{ output_dir: "https://evil.invalid/x", paths: [] }],
      })
    ).toThrow(/artifact/);
    expect(parseBotProjection({ artifacts: {} }).artifacts).toEqual([]);
    expect(
      parseBotProjection({
        artifacts: {
          directories: ["/obs/bucket/run"],
          output_dirs: ["/obs/bucket/run"],
          paths: ["/obs/bucket/run/report.md"],
        },
      }).artifacts
    ).toEqual([
      {
        outputDir: "/obs/bucket/run",
        paths: ["/obs/bucket/run/report.md"],
      },
    ]);
    expect(() =>
      parseBotProjection({
        artifacts: {
          directories: ["https://evil.invalid/run"],
          paths: [],
        },
      })
    ).toThrow(/artifact/);
    expect(() =>
      parseBotProjection({
        artifacts: {
          output_dirs: Array.from(
            { length: MAX_BOT_ARTIFACTS + 1 },
            () => "/obs/bucket/duplicate"
          ),
        },
      })
    ).toThrow(/artifact/);
    expect(
      parseBotProjection({
        artifacts: {
          directories: [],
          output_dirs: ["/obs/bucket/fallback"],
        },
      }).artifacts
    ).toEqual([{ outputDir: "/obs/bucket/fallback", paths: [] }]);
    expect(() =>
      parseBotProjection({
        artifacts: {
          directories: Array.from(
            { length: MAX_BOT_ARTIFACTS + 1 },
            (_, index) => `/obs/bucket/run-${index}`
          ),
        },
      })
    ).toThrow(/artifact/);
    expect(
      parseBotProjection({
        artifacts: {
          directories: Array.from(
            { length: MAX_BOT_ARTIFACTS },
            () => "/obs/bucket/duplicate"
          ),
          output_dirs: Array.from(
            { length: MAX_BOT_ARTIFACTS },
            () => "/obs/bucket/duplicate"
          ),
        },
      }).artifacts
    ).toEqual([{ outputDir: "/obs/bucket/duplicate", paths: [] }]);
    expect(() =>
      parseBotProjection({
        artifacts: [
          { output_dir: "/obs/bucket/x", paths: ["/obs/bucket/../secret"] },
        ],
      })
    ).toThrow(/artifact/);
    for (const path of [
      "obs://user:secret@bucket/run/report.md",
      "obs://bucket/run?token=secret",
      "obs://bucket/run/../private.txt",
      "obs://bucket//private.txt",
    ]) {
      expect(() =>
        parseBotProjection({
          artifacts: [{ output_dir: "obs://bucket/run", paths: [path] }],
        })
      ).toThrow(/artifact/);
    }
    expect(() =>
      parseBotProjection({
        artifacts: [
          {
            output_dir: "obs://bucket/run",
            paths: ["obs://bucket/other/report.md"],
          },
        ],
      })
    ).toThrow(/artifact/);
  });

  it("rejects non-objects and oversized bounded values", () => {
    expect(() => parseBotProjection(null)).toThrow(/object/);
    expect(() => parseBotProjection([])).toThrow(/object/);
    expect(() =>
      parseBotProjection({
        intermediate_report: "x".repeat(MAX_BOT_REPORT_LENGTH + 1),
      })
    ).toThrow(/intermediate_report/);
    expect(() =>
      parseBotProjection({ failures: ["x".repeat(MAX_BOT_FAILURE_LENGTH + 1)] })
    ).toThrow(/failures/);
    expect(() =>
      parseBotProjection({
        failures: Array.from({ length: MAX_BOT_FAILURES + 1 }, () => "x"),
      })
    ).toThrow(/failures/);
  });

  it("does not retain unknown raw payload fields", () => {
    const projection = parseBotProjection({
      bot_run_id: "run-safe",
      status: "succeeded",
      answer: "# Safe",
      raw: { phytomni_state: "secret" },
      provider_trace: "private",
    });

    expect(projection).toEqual(
      expect.objectContaining({
        runId: "run-safe",
        finalReport: "# Safe",
        intermediateReport: "",
      })
    );
    expect(JSON.stringify(projection)).not.toContain("phytomni_state");
    expect(JSON.stringify(projection)).not.toContain("provider_trace");
  });

  it("falls back to answer when reports contain only whitespace", () => {
    const projection = parseBotProjection({
      status: "SUCCEEDED",
      answer: "# Answer fallback",
      intermediate_report: "\n  ",
      final_report: "  \n",
    });

    expect(visibleBotReport(projection)).toBe("# Answer fallback");
  });

  it("normalizes known failure statuses and rejects unknown empty objects", () => {
    expect(
      parseBotProjection({
        failures: [
          { status: "failed" },
          { status: "timed_out" },
          { status: "cancelled" },
          "already safe",
        ],
      }).failures
    ).toEqual([
      "analysis task failed",
      "analysis task timed out",
      "analysis task cancelled",
      "already safe",
    ]);
    expect(() =>
      parseBotProjection({ failures: [{ status: "unknown" }] })
    ).toThrow(/failures/);
    expect(() => parseBotProjection({ failures: [{}] })).toThrow(/failures/);
  });

  it("requires an actual RFC3339 timestamp shape", () => {
    expect(() =>
      parseBotProjection({ report_updated_at: "2026-07-16" })
    ).toThrow(/report_updated_at/);
    expect(
      parseBotProjection({ report_updated_at: "2026-07-16T00:00:00Z" })
        .reportUpdatedAt
    ).toBe("2026-07-16T00:00:00Z");
  });
});
