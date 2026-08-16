import { describe, expect, it } from "vitest";

import intermediateFixture from "../../../fixtures/bot-head/projection-intermediate.json";
import finalFixture from "../../../fixtures/bot-head/projection-final.json";
import degradedFixture from "../../../fixtures/bot-head/projection-degraded.json";
import {
  MAX_BOT_ARTIFACTS,
  MAX_BOT_FAILURES,
  MAX_BOT_FAILURE_LENGTH,
  MAX_BOT_REPORT_LENGTH,
  MAX_BOT_WORK_STAGE_LENGTH,
  parseBotProjection,
  visibleBotReport,
} from "@/views/chat/botProjection";

describe("parseBotProjection", () => {
  it.each([
    "input_resolution",
    "planning",
    "execution",
    "report_assembly",
  ] as const)("accepts the finite work stage %s", (workStage) => {
    expect(
      parseBotProjection({ status: "RUNNING", work_stage: workStage }).workStage
    ).toBe(workStage);
  });

  it("rejects unknown and overlong work stages", () => {
    expect(() =>
      parseBotProjection({ status: "RUNNING", work_stage: "unknown" })
    ).toThrow(/work_stage/);
    expect(() =>
      parseBotProjection({
        status: "RUNNING",
        work_stage: "x".repeat(MAX_BOT_WORK_STAGE_LENGTH + 1),
      })
    ).toThrow(/work_stage/);
  });

  it("keeps a legacy RUNNING projection generic when work stage is absent", () => {
    const projection = parseBotProjection({ status: "RUNNING" });
    expect(projection.status).toBe("RUNNING");
    expect(projection.workStage).toBeNull();
  });

  it("reads current Bot formatted.metadata.deep_genome when top-level report fields are absent", () => {
    const projection = parseBotProjection({
      status: "RUNNING",
      agent: "deep_genome",
      answer: "# BriefGene",
      result: {
        formatted: {
          answer: "# BriefGene",
          metadata: {
            deep_genome: {
              stage: "intermediate",
              completeness: "partial",
              revision: 23,
              updated_at: "2026-08-16T13:55:24Z",
              progress: { brief_gene_status: "succeeded", total: 12 },
              degraded: false,
            },
          },
        },
      },
    });

    expect(projection.reportStage).toBe("intermediate");
    expect(projection.reportCompleteness).toBe("partial");
    expect(projection.reportRevision).toBe(23);
    expect(visibleBotReport(projection)).toBe("# BriefGene");
  });

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

  it("keeps browser-authorized links out of the legacy OBS projection", () => {
    const projection = parseBotProjection({
      status: "SUCCEEDED",
      answer: "saved",
      artifacts: [
        {
          id: "artifact-1",
          name: "report.pdf",
          kind: "report",
          download_url: "/api/v1/downloads/relay-file?token=signed-token",
        },
      ],
    });

    expect(projection.artifacts).toEqual([]);
    expect(JSON.stringify(projection)).not.toContain("signed-token");
  });

  it("retains bounded v1 delivery but drops raw artifact paths", () => {
    const projection = parseBotProjection({
      agent: "InSilicoResearchAgent",
      status: "SUCCEEDED",
      result_archive_v1: true,
      delivery: {
        schema_version: 1,
        required: true,
        status: "ready",
        revision: 1,
        name: "research-results.zip",
        size_bytes: 1024,
        error_code: null,
        retryable: false,
      },
      artifacts: [
        {
          output_dir: "/obs/private/research",
          paths: ["/obs/private/research/results.tsv"],
        },
      ],
    });

    expect(projection.resultArchiveV1).toBe(true);
    expect(projection.delivery?.name).toBe("research-results.zip");
    expect(projection.artifacts).toEqual([]);
    expect(JSON.stringify(projection)).not.toContain("/obs/private");
  });

  it("reads the query/history archive contract without treating conversation links as OBS paths", () => {
    const projection = parseBotProjection({
      tool_name: "DigitalDesignAgent",
      status: "SUCCEEDED",
      answer: "design answer",
      result_archive_v1: true,
      delivery: {
        schema_version: 1,
        required: true,
        status: "ready",
        revision: 1,
        name: "design-results.zip",
        size_bytes: 4097,
        error_code: null,
        retryable: false,
      },
      artifacts: [
        {
          id: "opaque-archive",
          name: "design-results.zip",
          kind: "archive",
          media_type: "application/zip",
        },
      ],
    });

    expect(projection.resultArchiveV1).toBe(true);
    expect(projection.delivery?.name).toBe("design-results.zip");
    expect(projection.artifacts).toEqual([]);
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
      agent: "InSilicoResearchAgent",
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

  it("does not promote a cited Knowledge answer into a report", () => {
    const raw = '{"content":"No matching evidence was found.","doc_list":[]}';
    const projection = parseBotProjection({
      agent: "KnowledgeAgent",
      status: "SUCCEEDED",
      answer: raw,
    });

    expect(projection.reportPresentation).toBe(false);
    expect(projection.intermediateReport).toBe("");
    expect(projection.finalReport).toBe("");
    expect(visibleBotReport(projection)).toBe("");
  });

  it("keeps analyst-class answer fallback as report compatibility", () => {
    const projection = parseBotProjection({
      agent: "InSilicoResearchAgent",
      status: "SUCCEEDED",
      answer: "# Compatibility report",
    });

    expect(projection.reportPresentation).toBe(true);
    expect(projection.finalReport).toBe("# Compatibility report");
  });

  it("treats an explicit final report as report presentation", () => {
    const projection = parseBotProjection({
      agent: "ReviewAgent",
      status: "SUCCEEDED",
      answer: "Compact answer",
      final_report: "# Explicit report",
    });

    expect(projection.reportPresentation).toBe(true);
    expect(projection.finalReport).toBe("# Explicit report");
  });

  it("falls back to an analyst-class answer when reports contain only whitespace", () => {
    const projection = parseBotProjection({
      agent: "AnalystAgent",
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

  it("parses safe interop provenance from snake and camel case sources", () => {
    const delegated = parseBotProjection({
      agent: "InSilicoResearchAgent",
      interop: {
        mode: "auto",
        status: "delegated",
        target_id: "mcp-peer",
        kind: "mcp",
        code: "no_evidence",
        endpoint: "https://private.invalid",
        credential: "secret",
      },
      degraded_interop: true,
    });
    expect(delegated.interop).toEqual({
      mode: "auto",
      status: "delegated",
      targetId: "mcp-peer",
      kind: "mcp",
      code: "no_evidence",
    });
    expect(delegated.degradedInterop).toBe(true);
    expect(JSON.stringify(delegated)).not.toContain("private.invalid");
    expect(JSON.stringify(delegated)).not.toContain("credential");

    const failed = parseBotProjection({
      tool_name: "DigitalDesignAgent",
      result: {
        interop: {
          mode: "required",
          status: "failed",
          targetId: "a2a-peer",
          kind: "a2a",
          code: "interop_failed",
        },
        degradedInterop: false,
      },
    });
    expect(failed.interop).toEqual({
      mode: "required",
      status: "failed",
      targetId: "a2a-peer",
      kind: "a2a",
      code: "interop_failed",
    });
    expect(failed.degradedInterop).toBe(false);
  });

  it.each([
    ["off", "local"],
    ["auto", "delegated"],
    ["auto", "degraded"],
    ["required", "failed"],
  ] as const)("accepts %s/%s provenance", (mode, status) => {
    expect(
      parseBotProjection({
        agent: "research",
        interop: { mode, status },
      }).interop
    ).toEqual({ mode, status });
  });

  it("uses projection source precedence for persisted interop fields", () => {
    const projection = parseBotProjection({
      tool_name: "InSilicoResearchAgent",
      projection: {
        interop: {
          mode: "off",
          status: "local",
        },
      },
      data: {
        interop: {
          mode: "auto",
          status: "delegated",
          targetId: "mcp-peer",
          kind: "mcp",
        },
      },
    });
    expect(projection.interop).toEqual({ mode: "off", status: "local" });
  });

  it("defaults legacy projections without interop metadata", () => {
    const projection = parseBotProjection({ status: "SUCCEEDED" });
    expect(projection.interop).toBeNull();
    expect(projection.degradedInterop).toBe(false);
  });

  it("rejects malformed interop fields and wrong public shapes", () => {
    const base = { mode: "auto", status: "delegated" };
    for (const [field, value] of [
      ["mode", "unsupported"],
      ["status", "RUNNING"],
      ["kind", "http"],
      ["target_id", "https://private.invalid"],
      ["code", "provider_secret"],
      ["target_id", "x".repeat(65)],
    ] as const) {
      expect(() =>
        parseBotProjection({
          agent: "InSilicoResearchAgent",
          interop: { ...base, [field]: value },
        })
      ).toThrow(/interop/);
    }
    expect(() =>
      parseBotProjection({
        agent: "InSilicoResearchAgent",
        interop: [],
      })
    ).toThrow(/interop/);
    expect(() =>
      parseBotProjection({
        agent: "InSilicoResearchAgent",
        interop: { mode: "auto", status: "delegated", kind: 1 },
      })
    ).toThrow(/interop/);
    expect(() =>
      parseBotProjection({
        agent: "InSilicoResearchAgent",
        interop: { mode: "auto" },
      })
    ).toThrow(/interop.status/);
    expect(() =>
      parseBotProjection({
        agent: "InSilicoResearchAgent",
        degraded_interop: "true",
      })
    ).toThrow(/degraded_interop/);
  });

  it("does not attach interop metadata to ordinary agent projections", () => {
    const projection = parseBotProjection({
      tool_name: "AnalystAgent",
      interop: {
        mode: "auto",
        status: "delegated",
        targetId: "mcp-peer",
        kind: "mcp",
      },
      degradedInterop: true,
    });
    expect(projection.interop).toBeNull();
    expect(projection.degradedInterop).toBe(false);
  });
});
