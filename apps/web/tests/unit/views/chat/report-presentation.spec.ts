import { describe, expect, it } from "vitest";
import { reportPresentationFor } from "@/views/chat/utils/report-presentation";
import type { ReportPresentationFacts } from "@/views/chat/utils/report-presentation";

describe("report presentation", () => {
  it.each([
    [
      { status: "FAILED", intermediateReport: "# Scientific observation" },
      "degraded",
      "chat.botReport.partial",
    ],
    [
      { status: "SUCCEEDED", reportWarningCodes: ["report_synthesis_failed"] },
      "degraded",
      "chat.botReport.unavailable",
    ],
    [
      {
        status: "SUCCEEDED",
        finalReport: "# Final science",
        report: { state: "final", degraded: false, sourceArtifactCount: 1 },
      },
      "complete",
      "chat.botReport.complete",
    ],
    [{ status: "FAILED" }, "failed", "chat.botReport.failed"],
    [
      {
        status: "SUCCEEDED",
        finalReport: "Task created: synthetic",
        report: { state: "final", degraded: false, sourceArtifactCount: 1 },
      },
      "degraded",
      "chat.botReport.unavailable",
    ],
    [
      {
        status: "SUCCEEDED",
        trackingDegraded: true,
        finalReport: "# Final science",
      },
      "complete",
      "chat.botReport.complete",
    ],
    [{ status: "SUCCEEDED" }, "degraded", "chat.botReport.unavailable"],
    [{ status: "RUNNING" }, "loading", "chat.botReport.waiting"],
    [{ status: "INPUT_REQUIRED" }, "loading", "chat.botReport.inputRequired"],
  ] as const)("decides %j", (facts, state, labelKey) => {
    expect(
      reportPresentationFor(facts as ReportPresentationFacts)
    ).toMatchObject({ state, labelKey });
  });

  it("keeps partial failure context out of science and ignores unknown warnings", () => {
    const decision = reportPresentationFor(
      {
        status: "FAILED",
        reportWarningCodes: ["report_synthesis_failed", "private raw warning"],
      },
      { report: "# Science [1]", source: "intermediate" }
    );
    expect(decision.reportText).toBe("# Science [1]");
    expect(decision.warningKeys).toEqual([
      "chat.botReport.warnings.report_synthesis_failed",
      "chat.botReport.executionFailed",
    ]);
  });

  it("does not promote unclassified historical text based on run success alone", () => {
    expect(
      reportPresentationFor(
        { status: "SUCCEEDED" },
        { report: "# Retained science", source: "message" }
      ).state
    ).toBe("degraded");
  });

  it("does not call a retained intermediate final when metadata claims a missing final", () => {
    expect(
      reportPresentationFor({
        status: "SUCCEEDED",
        report: { state: "final", degraded: false, sourceArtifactCount: 1 },
        intermediateReport: "# Retained intermediate",
      }).state
    ).toBe("degraded");
  });
});
