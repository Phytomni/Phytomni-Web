import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

interface TraceDetailFixture {
  schema_version: number;
  records: Record<
    string,
    {
      attempts: Array<{ status: string }>;
      progress: Record<string, unknown> | null;
      detail: Record<string, unknown>;
    }
  >;
  execution_log: {
    artifact_role: string;
    target: { kind: string; id: string };
  };
  invalid_payloads: Array<{ reason: string }>;
  redacted_record: { detail: Record<string, unknown> };
  stage_contract: { stages: string[] };
  stage_transition_cases: Array<{
    name: string;
    previous?: {
      clocks: Record<string, string>;
    };
    state: {
      child_status?: string;
      root_status: string;
      pending_status_key: string | null;
      clocks: Record<string, string>;
    };
  }>;
  invalid_stage_cases: Array<{ reason: string }>;
}

function loadFixture(): TraceDetailFixture {
  const path = resolve(
    process.cwd(),
    "../../docs/reference/execution-trace-detail.v1.fixtures.json"
  );
  return JSON.parse(readFileSync(path, "utf8")) as TraceDetailFixture;
}

describe("execution trace detail shared contract", () => {
  it("freezes grouped, retry, progress, fallback, log, and redaction cases", () => {
    const fixtures = loadFixture();
    const grouped = fixtures.records.grouped_operation;

    expect(fixtures.schema_version).toBe(1);
    expect(Object.keys(fixtures.records).sort()).toEqual([
      "grouped_operation",
      "unknown_presenter",
    ]);
    expect(grouped.attempts.map((attempt) => attempt.status)).toEqual([
      "failed",
      "running",
    ]);
    expect(grouped.progress).toEqual({
      completed: 2,
      total: 4,
      unit: "dimensions",
    });
    expect(fixtures.records.unknown_presenter.detail).toEqual({});
    expect(fixtures.execution_log).toMatchObject({
      artifact_role: "execution_log",
      target: { kind: "artifact" },
    });
    expect(fixtures.invalid_payloads).toHaveLength(9);
    expect(Object.keys(fixtures.redacted_record.detail).sort()).toEqual([
      "ordinal",
      "total",
    ]);
  });

  it("freezes non-regressing stage, terminal, surface, and clock semantics", () => {
    const fixtures = loadFixture();
    const cases = Object.fromEntries(
      fixtures.stage_transition_cases.map((item) => [item.name, item])
    );

    expect(fixtures.stage_contract.stages).toEqual([
      "orchestration",
      "scientific_execution",
      "consolidation",
      "response_settlement",
    ]);
    expect(cases.child_submission_succeeded.state).toMatchObject({
      child_status: "succeeded",
      root_status: "running",
      pending_status_key: "execution.pending.submitted",
    });
    expect(
      cases.unchanged_provider_poll.state.clocks.last_execution_fact_at
    ).toBe(
      cases.unchanged_provider_poll.previous?.clocks.last_execution_fact_at
    );
    expect(cases.stream_heartbeat.state.clocks).toMatchObject({
      last_execution_fact_at:
        cases.stream_heartbeat.previous?.clocks.last_execution_fact_at,
      last_provider_contact_at:
        cases.stream_heartbeat.previous?.clocks.last_provider_contact_at,
    });
    expect(
      fixtures.invalid_stage_cases.map((item) => item.reason).sort()
    ).toEqual([
      "child_terminal_closes_root",
      "pending_answer_mismatch",
      "root_terminal_before_settlement",
      "stage_regression",
      "stream_contact_mutates_execution_clocks",
      "todo_stage_mismatch",
      "unchanged_provider_mutates_execution_clock",
    ]);
  });
});
