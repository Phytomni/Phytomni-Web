import { describe, expect, it } from "vitest";

import {
  MAX_BOT_ARTIFACTS,
  MAX_BOT_ARTIFACT_PATHS,
  MAX_BOT_FAILURES,
} from "@/views/chat/botProjection";
import type { BotArtifact, BotRunProjection } from "@/views/chat/botProjection";
import {
  initBotLifecycleState,
  reduceBotFailure,
  reduceBotProjection,
} from "@/views/chat/streaming/botLifecycleReducer";

function projection(
  overrides: Partial<BotRunProjection> = {}
): BotRunProjection {
  return {
    runId: "run-1",
    agent: "DeepGenomeAgent",
    status: "RUNNING",
    reportStage: "intermediate",
    reportCompleteness: "partial",
    reportRevision: 1,
    reportUpdatedAt: null,
    intermediateReport: "",
    finalReport: "",
    progress: {
      completed: 0,
      total: 0,
      failed: 0,
      pending: 0,
      briefGeneStatus: "",
    },
    degraded: false,
    degradedReason: null,
    failures: [],
    artifacts: [],
    requestId: null,
    trackingDegraded: false,
    ...overrides,
  };
}

function artifact(outputDir: string, paths: string[] = []): BotArtifact {
  return { outputDir, paths };
}

describe("bot lifecycle reducer", () => {
  it("accepts a newer revision while status stays RUNNING", () => {
    const state = reduceBotProjection(
      initBotLifecycleState(),
      projection({ reportRevision: 1, intermediateReport: "one" })
    );
    const next = reduceBotProjection(
      state,
      projection({
        reportRevision: 2,
        intermediateReport: "two",
        status: "RUNNING",
      })
    );

    expect(next.visibleReport).toBe("two");
    expect(next.status).toBe("RUNNING");
    expect(next.reportRevision).toBe(2);
  });

  it("ignores older blank content and retains final content", () => {
    const state = reduceBotProjection(
      initBotLifecycleState(),
      projection({
        reportRevision: 3,
        reportStage: "final",
        reportCompleteness: "complete",
        finalReport: "final",
        status: "SUCCEEDED",
      })
    );
    const next = reduceBotProjection(
      state,
      projection({ reportRevision: 2, finalReport: "", status: "RUNNING" })
    );

    expect(next.visibleReport).toBe("final");
    expect(next.finalReport).toBe("final");
    expect(next.status).toBe("SUCCEEDED");
    expect(next.reportRevision).toBe(3);
  });

  it("ignores a stale final report instead of replacing newer intermediate text", () => {
    const state = reduceBotProjection(
      initBotLifecycleState(),
      projection({
        reportRevision: 3,
        intermediateReport: "newer intermediate",
      })
    );
    const next = reduceBotProjection(
      state,
      projection({ reportRevision: 2, finalReport: "stale final" })
    );

    expect(next.intermediateReport).toBe("newer intermediate");
    expect(next.finalReport).toBe("");
    expect(next.visibleReport).toBe("newer intermediate");
    expect(next.reportRevision).toBe(3);
  });

  it("accepts a non-empty equal-revision report without erasing content", () => {
    const state = reduceBotProjection(
      initBotLifecycleState(),
      projection({ reportRevision: 2, intermediateReport: "first" })
    );
    const next = reduceBotProjection(
      state,
      projection({ reportRevision: 2, intermediateReport: "second" })
    );

    expect(next.reportRevision).toBe(2);
    expect(next.visibleReport).toBe("second");
  });

  it("retains a BriefGene failure while the main run is still running", () => {
    const next = reduceBotProjection(
      initBotLifecycleState(),
      projection({
        failures: ["Optional BriefGene analysis unavailable"],
        degraded: true,
      })
    );

    expect(next.status).toBe("RUNNING");
    expect(next.degraded).toBe(true);
    expect(next.failures).toEqual(["Optional BriefGene analysis unavailable"]);
  });

  it("keeps a successful final synthesis marked as optionally degraded", () => {
    const next = reduceBotProjection(
      initBotLifecycleState(),
      projection({
        status: "SUCCEEDED",
        reportStage: "final",
        reportCompleteness: "complete",
        finalReport: "# Final",
        degraded: true,
        failures: ["Optional analysis unavailable"],
      })
    );

    expect(next.status).toBe("SUCCEEDED");
    expect(next.visibleReport).toBe("# Final");
    expect(next.degraded).toBe(true);
    expect(next.failures).toEqual(["Optional analysis unavailable"]);
  });

  it("keeps the intermediate report when final synthesis fails", () => {
    const next = reduceBotProjection(
      initBotLifecycleState(),
      projection({
        status: "FAILED",
        reportStage: "final",
        reportCompleteness: "partial",
        intermediateReport: "# Partial",
        degraded: true,
        degradedReason: "Final synthesis unavailable",
        failures: ["final synthesis failed"],
      })
    );

    expect(next.status).toBe("FAILED");
    expect(next.visibleReport).toBe("# Partial");
    expect(next.degraded).toBe(true);
    expect(next.failures).toEqual(["final synthesis failed"]);
  });

  it("retains artifact warnings and defensively copies artifacts", () => {
    const incomingArtifacts = [
      artifact("/obs/bucket/run", ["/obs/bucket/run/report.md"]),
    ];
    const next = reduceBotProjection(
      initBotLifecycleState(),
      projection({
        status: "SUCCEEDED",
        finalReport: "# Final",
        artifacts: incomingArtifacts,
        failures: ["artifact export warning"],
      })
    );

    incomingArtifacts[0].paths.push("/obs/bucket/run/secret.tsv");
    incomingArtifacts.push(artifact("/obs/bucket/other"));

    expect(next.artifacts).toEqual([
      artifact("/obs/bucket/run", ["/obs/bucket/run/report.md"]),
    ]);
    expect(next.failures).toEqual(["artifact export warning"]);
  });

  it("marks a null-id projection as degraded when tracking is unavailable", () => {
    const next = reduceBotProjection(
      initBotLifecycleState(),
      projection({ runId: null, trackingDegraded: true })
    );

    expect(next.runId).toBeNull();
    expect(next.degraded).toBe(true);
    expect(next.status).toBe("RUNNING");
  });

  it("maps non-terminal Bot statuses into the lifecycle status union", () => {
    expect(
      reduceBotProjection(
        initBotLifecycleState(),
        projection({ status: "QUEUED" })
      ).status
    ).toBe("RUNNING");
    expect(
      reduceBotProjection(
        initBotLifecycleState(),
        projection({ status: "INPUT_REQUIRED" })
      ).status
    ).toBe("INPUT_REQUIRED");
    expect(
      reduceBotProjection(
        initBotLifecycleState(),
        projection({ status: "CANCELLED" })
      ).status
    ).toBe("FAILED");
  });

  it("folds a terminal failure without exposing the raw error", () => {
    const state = reduceBotProjection(
      initBotLifecycleState(),
      projection({ finalReport: "# Final" })
    );
    const next = reduceBotFailure(
      state,
      new Error("secret token and provider stack trace")
    );

    expect(next.status).toBe("FAILED");
    expect(next.degraded).toBe(true);
    expect(next.visibleReport).toBe("# Final");
    expect(next.failures).toHaveLength(1);
    expect(next.failures[0]).not.toContain("secret token");
    expect(next.failures[0]).not.toContain("provider stack trace");

    const fromRawString = reduceBotFailure(
      state,
      "provider secret token and stack trace"
    );
    expect(fromRawString.failures).toEqual(["analysis task failed"]);
  });

  it("does not reopen a terminal lifecycle state when folding a failure", () => {
    const succeeded = reduceBotProjection(
      initBotLifecycleState(),
      projection({ status: "SUCCEEDED", finalReport: "# Done" })
    );
    const failed = reduceBotProjection(
      initBotLifecycleState(),
      projection({ status: "FAILED", intermediateReport: "# Partial" })
    );

    expect(
      reduceBotFailure(succeeded, new Error("late transport error")).status
    ).toBe("SUCCEEDED");
    expect(reduceBotFailure(failed, new Error("duplicate error")).status).toBe(
      "FAILED"
    );
  });

  it("caps cumulative failures and artifact paths without sharing inputs", () => {
    const failures = Array.from(
      { length: MAX_BOT_FAILURES + 5 },
      (_, index) => `failure-${index}`
    );
    const paths = Array.from(
      { length: MAX_BOT_ARTIFACT_PATHS + 5 },
      (_, index) => `/obs/bucket/run/file-${index}.txt`
    );
    const artifacts = Array.from(
      { length: MAX_BOT_ARTIFACTS + 5 },
      (_, index) => artifact(`/obs/bucket/run-${index}`)
    );
    artifacts[0].paths = paths;

    const next = reduceBotProjection(
      initBotLifecycleState(),
      projection({ failures, artifacts })
    );

    expect(next.failures).toHaveLength(MAX_BOT_FAILURES);
    expect(next.artifacts).toHaveLength(MAX_BOT_ARTIFACTS);
    expect(
      next.artifacts.reduce((total, item) => total + item.paths.length, 0)
    ).toBe(MAX_BOT_ARTIFACT_PATHS);
    expect(next.artifacts[0].paths).not.toBe(paths);
    expect(next.failures[0]).toBe("failure-0");
  });

  it("returns fresh arrays and never mutates the previous state", () => {
    const first = reduceBotProjection(
      initBotLifecycleState(),
      projection({
        failures: ["one"],
        artifacts: [artifact("/obs/bucket/run", ["/obs/bucket/run/a.tsv"])],
      })
    );
    const next = reduceBotProjection(
      first,
      projection({ reportRevision: 2, failures: ["two"] })
    );

    expect(next).not.toBe(first);
    expect(next.failures).not.toBe(first.failures);
    expect(next.artifacts).not.toBe(first.artifacts);
    expect(next.artifacts[0]).not.toBe(first.artifacts[0]);
    expect(next.artifacts[0].paths).not.toBe(first.artifacts[0].paths);
    expect(first.failures).toEqual(["one"]);
  });
});
