import { describe, expect, it } from "vitest";
import * as activityPresentation from "@/views/chat/executionActivityPresentation";
import {
  executionActivityIsStreaming,
  presentExecutionActivityEvents,
  presentExecutionActivityOperations,
} from "@/views/chat/executionActivityPresentation";
import {
  applyExecutionEvent,
  createExecutionRunState,
  type ExecutionEvent,
  type ExecutionOperationRecord,
} from "@/views/chat/streaming/executionEvents";

describe("executionActivityIsStreaming", () => {
  it("stops when either the event ledger or message lifecycle is terminal", () => {
    const running = createExecutionRunState("run-1");
    expect(executionActivityIsStreaming(running, false)).toBe(true);
    expect(executionActivityIsStreaming(running, true)).toBe(false);

    const completed = {
      ...running,
      status: "succeeded" as const,
      terminal: { status: "succeeded" as const, eventId: "evt-terminal" },
    };
    expect(executionActivityIsStreaming(completed, false)).toBe(false);
  });

  it("stops for terminal history messages that are no longer lifecycle-polled", () => {
    const staleRun = createExecutionRunState("run-history");

    expect(executionActivityIsStreaming(staleRun, false, "SUCCEEDED")).toBe(
      false
    );
    expect(executionActivityIsStreaming(staleRun, false, "FAILED")).toBe(false);
    expect(executionActivityIsStreaming(staleRun, false, "RUNNING")).toBe(true);
  });
});

describe("presentExecutionActivityEvents", () => {
  const event = (
    seq: number,
    kind: string,
    options: Partial<ExecutionEvent> = {}
  ): ExecutionEvent => ({
    schemaVersion: 2,
    eventId: `evt-${seq}`,
    executionId: "turn-1",
    runId: "turn-1",
    seq,
    occurredAt: `2026-08-20T15:39:${String(seq).padStart(2, "0")}Z`,
    kind,
    known: true,
    ignorable: false,
    status: "running",
    summary: { key: kind, text: kind },
    payload: {},
    ...options,
  });

  it("collapses framework transitions into user-readable logical work", () => {
    const events = [
      event(1, "execution.admitted", { status: "admitted" }),
      event(2, "execution.started"),
      event(3, "span.started", {
        spanId: "root",
        source: "runtime",
      }),
      event(4, "span.created", {
        spanId: "agent",
        parentSpanId: "root",
        source: "agent",
      }),
      event(5, "span.started", {
        spanId: "agent",
        parentSpanId: "root",
        source: "agent",
      }),
      event(6, "span.created", {
        spanId: "graph-1",
        parentSpanId: "agent",
        source: "graph",
      }),
      event(7, "span.started", {
        spanId: "graph-1",
        parentSpanId: "agent",
        source: "graph",
      }),
      event(8, "span.succeeded", {
        spanId: "graph-1",
        parentSpanId: "agent",
        source: "graph",
        status: "succeeded",
      }),
      event(9, "work_unit.attempt_started", {
        spanId: "provider-span",
        workUnitId: "provider-work",
        source: "provider",
        status: "dispatching",
      }),
      event(10, "span.started", {
        spanId: "provider-span",
        workUnitId: "provider-work",
        source: "provider",
      }),
      event(11, "work_unit.acknowledged", {
        spanId: "provider-span",
        workUnitId: "provider-work",
        source: "provider",
        status: "running",
      }),
      event(12, "span.succeeded", {
        spanId: "provider-span",
        workUnitId: "provider-work",
        source: "provider",
        status: "succeeded",
      }),
      event(13, "work_unit.succeeded", {
        spanId: "tool-span",
        workUnitId: "tool-work",
        source: "tool",
        status: "succeeded",
      }),
      event(14, "span.succeeded", {
        spanId: "tool-span",
        workUnitId: "tool-work",
        source: "tool",
        status: "succeeded",
      }),
      event(15, "span.succeeded", {
        spanId: "agent",
        parentSpanId: "root",
        source: "agent",
        status: "succeeded",
      }),
      event(16, "reasoning.summary", {
        source: "agent",
        payload: { text: "Safe public reasoning summary" },
      }),
    ];
    const run = events.reduce(
      applyExecutionEvent,
      createExecutionRunState("turn-1")
    );

    const visible = presentExecutionActivityEvents(run);

    expect(visible.map((item) => item.eventId)).toEqual([
      "evt-2",
      "evt-8",
      "evt-15",
      "evt-16",
    ]);
    expect(presentExecutionActivityOperations(run)).toHaveLength(2);
    expect(visible.filter((item) => item.source === "graph")).toHaveLength(1);
    expect(visible.some((item) => item.kind === "span.created")).toBe(false);
  });

  it("coalesces repeated graph spans by semantic phase", () => {
    const events = [
      event(1, "span.started", {
        spanId: "graph-1",
        parentSpanId: "root",
        source: "graph",
        payload: { phase: "agent.review.workflow" },
      }),
      event(2, "span.succeeded", {
        spanId: "graph-1",
        parentSpanId: "root",
        source: "graph",
        status: "succeeded",
        payload: { phase: "agent.review.workflow" },
      }),
      event(3, "span.started", {
        spanId: "graph-2",
        parentSpanId: "root",
        source: "graph",
        payload: { phase: "agent.review.workflow" },
      }),
    ];
    const run = events.reduce(
      applyExecutionEvent,
      createExecutionRunState("turn-1")
    );

    expect(
      presentExecutionActivityEvents(run).map((item) => item.eventId)
    ).toEqual(["evt-3"]);
  });

  it("renders one grouped operation and suppresses its duplicate lifecycle events", () => {
    const events = [
      event(1, "work_unit.registered", {
        workUnitId: "work-search",
        payload: { operation_key: "knowledge.search" },
        status: "queued",
      }),
      event(2, "work_unit.attempt_started", {
        workUnitId: "work-search",
        payload: { operation_key: "knowledge.search" },
      }),
      event(3, "work_unit.succeeded", {
        workUnitId: "work-search",
        payload: { operation_key: "knowledge.search", duration_ms: 2000 },
        status: "succeeded",
      }),
    ];
    const run = events.reduce(
      applyExecutionEvent,
      createExecutionRunState("turn-1")
    );

    expect(presentExecutionActivityOperations(run)).toMatchObject([
      {
        workUnitId: "work-search",
        operationKey: "knowledge.search",
        status: "succeeded",
        durationMs: 2000,
        lastObservationAt: "2026-08-20T15:39:03Z",
      },
    ]);
    expect(presentExecutionActivityEvents(run)).toEqual([]);
  });

  it("groups high-cardinality knowledge searches without collapsing the audit ledger", () => {
    const lifecycleKinds = [
      "work_unit.registered",
      "span.created",
      "work_unit.attempt_started",
      "span.started",
      "work_unit.succeeded",
      "span.succeeded",
    ] as const;
    let seq = 0;
    const events = Array.from({ length: 19 }, (_, searchIndex) =>
      lifecycleKinds.map((kind) => {
        seq += 1;
        const terminal = kind.endsWith(".succeeded");
        return event(seq, kind, {
          occurredAt: new Date(
            Date.parse("2026-08-20T15:39:00Z") + seq * 10
          ).toISOString(),
          spanId: `search-span-${searchIndex + 1}`,
          workUnitId: `search-work-${searchIndex + 1}`,
          status: terminal ? "succeeded" : "running",
          payload: {
            operation_key: "knowledge.search",
            ...(terminal ? { detail: { result_count: 128 } } : {}),
          },
        });
      })
    ).flat();
    const resultEvent = event(events.length + 1, "result.published", {
      occurredAt: "2026-08-20T15:39:02Z",
      status: "succeeded",
      payload: {
        name: "brief-gene-report.json",
        media_type: "application/json",
        size_bytes: 512,
      },
      target: { kind: "download", id: "brief-gene-report" },
    });
    const run = [...events, resultEvent].reduce(
      applyExecutionEvent,
      createExecutionRunState("turn-1")
    );

    expect(presentExecutionActivityOperations(run)).toHaveLength(19);
    expect(
      activityPresentation.presentExecutionWorkflowItems(run)
    ).toMatchObject([
      {
        kind: "operation",
        operation: {
          operationKey: "knowledge.search",
          status: "succeeded",
          progress: { completed: 19, total: 19, unit: "searches" },
        },
      },
    ]);
    expect(
      activityPresentation.presentExecutionTechnicalEvents(run)
    ).toHaveLength(115);
    expect(run.results).toMatchObject([
      { name: "brief-gene-report.json", mediaType: "application/json" },
    ]);
  });

  it("presents one chronological workflow and keeps protocol facts in technical detail", () => {
    const events = [
      event(1, "execution.started"),
      event(2, "todo.snapshot", {
        payload: {
          items: [
            { id: "search", label_key: "todo.search", status: "pending" },
          ],
        },
        target: { kind: "todo", id: "todo-initial" },
      }),
      event(3, "work_unit.registered", {
        workUnitId: "work-search",
        payload: { operation_key: "knowledge.search" },
        status: "queued",
      }),
      event(4, "work_unit.attempt_started", {
        workUnitId: "work-search",
        payload: { operation_key: "knowledge.search" },
      }),
      event(5, "work_unit.succeeded", {
        workUnitId: "work-search",
        payload: { operation_key: "knowledge.search", duration_ms: 2000 },
        status: "succeeded",
      }),
      event(6, "work_unit.registered", {
        workUnitId: "work-model",
        payload: { operation_key: "model.generate" },
        status: "queued",
      }),
      event(7, "work_unit.succeeded", {
        workUnitId: "work-model",
        payload: { operation_key: "model.generate", duration_ms: 1000 },
        status: "succeeded",
      }),
      event(8, "todo.snapshot", {
        payload: {
          items: [
            {
              id: "search",
              label_key: "todo.search",
              status: "completed",
            },
          ],
        },
        target: { kind: "todo", id: "todo-latest" },
      }),
      event(9, "message.snapshot"),
      event(10, "reasoning.summary", {
        payload: { text: "Safe public summary" },
      }),
      event(11, "work_unit.registered", {
        workUnitId: "work-unknown",
        payload: {},
        status: "queued",
      }),
      event(12, "work_unit.succeeded", {
        workUnitId: "work-unknown",
        payload: { duration_ms: 50 },
        status: "succeeded",
      }),
    ];
    const run = events.reduce(
      applyExecutionEvent,
      createExecutionRunState("turn-1")
    );
    const presentWorkflow = (
      activityPresentation as typeof activityPresentation & {
        presentExecutionWorkflowItems?: (value: typeof run) => Array<{
          kind: "event" | "operation";
          occurredAt: string;
          event?: ExecutionEvent;
          operation?: { operationKey: string };
        }>;
      }
    ).presentExecutionWorkflowItems;
    const presentTechnical = (
      activityPresentation as typeof activityPresentation & {
        presentExecutionTechnicalEvents?: (
          value: typeof run
        ) => ExecutionEvent[];
      }
    ).presentExecutionTechnicalEvents;

    expect(presentWorkflow).toBeTypeOf("function");
    expect(presentTechnical).toBeTypeOf("function");
    if (!presentWorkflow || !presentTechnical) return;

    const workflow = presentWorkflow(run);
    expect(
      workflow.map((item) =>
        item.kind === "operation"
          ? item.operation?.operationKey
          : item.event?.kind
      )
    ).toEqual(["todo.snapshot", "knowledge.search", "reasoning.summary"]);
    expect(workflow.map((item) => item.occurredAt)).toEqual([
      "2026-08-20T15:39:02Z",
      "2026-08-20T15:39:03Z",
      "2026-08-20T15:39:10Z",
    ]);
    expect(workflow[0].event?.target).toEqual({
      kind: "todo",
      id: "todo-latest",
    });
    expect(presentTechnical(run).map((item) => item.eventId)).toEqual(
      events.map((item) => item.eventId)
    );
  });

  it("keeps published resources out of workflow but in bounded technical audit", () => {
    const events = [
      event(1, "artifact.published", {
        status: "succeeded",
        payload: {
          name: "network.svg",
          media_type: "image/svg+xml",
          size_bytes: 42,
        },
        target: { kind: "artifact", id: "artifact-network" },
      }),
      event(2, "result.published", {
        status: "succeeded",
        payload: {
          name: "network.csv",
          media_type: "text/csv",
          size_bytes: 84,
        },
        target: { kind: "download", id: "download-network" },
      }),
    ];
    const run = events.reduce(
      applyExecutionEvent,
      createExecutionRunState("turn-1")
    );

    expect(activityPresentation.presentExecutionWorkflowItems(run)).toEqual([]);
    expect(
      activityPresentation
        .presentExecutionTechnicalEvents(run)
        .map((item) => item.kind)
    ).toEqual(["artifact.published", "result.published"]);
    expect(run.results.map((item) => item.name)).toEqual([
      "network.svg",
      "network.csv",
    ]);
  });

  it("keeps only Agent-declared semantic phases in the default workflow", () => {
    const events = [
      event(1, "span.progress", {
        spanId: "span-retrieving",
        source: "compatibility",
        payload: { phase: "retrieving", completed: 1, total: 2 },
      }),
      event(2, "phase.started", {
        source: "agent",
        payload: { phase: "agent.review.workflow" },
      }),
      event(3, "span.succeeded", {
        spanId: "span-agent",
        source: "agent",
        payload: { phase: "agent.review" },
        status: "succeeded",
      }),
    ];
    const run = events.reduce(applyExecutionEvent, {
      ...createExecutionRunState("turn-1"),
      agentSlug: "review",
    });
    const presentWorkflow = (
      activityPresentation as typeof activityPresentation & {
        presentExecutionWorkflowItems?: (value: typeof run) => Array<{
          kind: "event" | "operation";
          event?: ExecutionEvent;
        }>;
      }
    ).presentExecutionWorkflowItems;

    expect(presentWorkflow).toBeTypeOf("function");
    if (!presentWorkflow) return;
    expect(presentWorkflow(run).map((item) => item.event?.eventId)).toEqual([
      "evt-1",
    ]);

    const undeclared = { ...run, agentSlug: null };
    expect(presentWorkflow(undeclared)).toEqual([]);
  });

  it("groups Review dimension fan-out and hides covered phase summaries", () => {
    const operation = (
      operationKey:
        | "review.retrieve_dimension"
        | "review.draft_dimension"
        | "review.citation_check"
        | "review.final_synthesis",
      index: number
    ): ExecutionOperationRecord => {
      const labels = {
        "review.retrieve_dimension": "Retrieve evidence",
        "review.draft_dimension": "Draft section",
        "review.citation_check": "Check citations",
        "review.final_synthesis": "Synthesize report",
      } as const;
      const startedAt = new Date(
        Date.parse("2026-08-24T10:00:00Z") + index * 1000
      ).toISOString();
      return {
        schemaVersion: 1,
        operationId: `operation-${operationKey}-${index}`,
        workUnitId: `work-${operationKey}-${index}`,
        operationKey,
        labelKey: `execution.operation.${operationKey}`,
        fallbackLabel: labels[operationKey],
        status: "succeeded",
        startedAt,
        lastObservationAt: startedAt,
        completedAt: startedAt,
        durationMs: 1000,
        currentAttempt: 1,
        attempts: [],
        progress: null,
        detail: {},
        summary: null,
        target: null,
      };
    };
    const phases = ["retrieving", "drafting", "revising", "generating"];
    const base = phases
      .map((phase, index) =>
        event(index + 1, "span.progress", {
          spanId: `compatibility-${phase}`,
          source: "compatibility",
          payload: { phase },
        })
      )
      .reduce(applyExecutionEvent, {
        ...createExecutionRunState("turn-1"),
        agentSlug: "review",
      });
    const run = {
      ...base,
      operations: [
        ...Array.from({ length: 4 }, (_, index) =>
          operation("review.retrieve_dimension", index + 1)
        ),
        ...Array.from({ length: 4 }, (_, index) =>
          operation("review.draft_dimension", index + 5)
        ),
        ...Array.from({ length: 4 }, (_, index) =>
          operation("review.citation_check", index + 9)
        ),
        operation("review.final_synthesis", 13),
      ],
    };

    const workflow = activityPresentation.presentExecutionWorkflowItems(run);
    expect(workflow).toHaveLength(4);
    expect(workflow.every((item) => item.kind === "operation")).toBe(true);
    expect(workflow).toMatchObject([
      {
        operation: {
          operationKey: "review.retrieve_dimension",
          progress: { completed: 4, total: 4, unit: "dimensions" },
        },
        groupedOperations: [{}, {}, {}, {}],
      },
      {
        operation: {
          operationKey: "review.draft_dimension",
          progress: { completed: 4, total: 4, unit: "dimensions" },
        },
        groupedOperations: [{}, {}, {}, {}],
      },
      {
        operation: {
          operationKey: "review.citation_check",
          progress: { completed: 4, total: 4, unit: "batches" },
        },
        groupedOperations: [{}, {}, {}, {}],
      },
      {
        operation: { operationKey: "review.final_synthesis" },
      },
    ]);
  });

  it("groups declared remote fan-out by parent and attaches submissions as detail", () => {
    const operation = (
      workUnitId: string,
      operationKey: "remote.analysis" | "remote.submit",
      startedAt: string
    ): ExecutionOperationRecord => ({
      schemaVersion: 1,
      operationId: `operation-${workUnitId}`,
      workUnitId,
      operationKey,
      labelKey: `execution.operation.${operationKey}`,
      fallbackLabel:
        operationKey === "remote.analysis" ? "Run analysis" : "Submit analysis",
      status: operationKey === "remote.analysis" ? "running" : "succeeded",
      startedAt,
      lastObservationAt: startedAt,
      completedAt: operationKey === "remote.analysis" ? null : startedAt,
      durationMs: 1000,
      currentAttempt: 1,
      attempts: [],
      progress: null,
      detail: {},
      summary: null,
      target: null,
    });
    const run = {
      ...createExecutionRunState("turn-remote-grouping"),
      operations: [
        operation("analysis-1", "remote.analysis", "2026-08-24T08:00:00Z"),
        operation("submit-1", "remote.submit", "2026-08-24T08:00:01Z"),
        operation("analysis-2", "remote.analysis", "2026-08-24T08:00:02Z"),
        operation("submit-2", "remote.submit", "2026-08-24T08:00:03Z"),
        operation("analysis-3", "remote.analysis", "2026-08-24T08:00:04Z"),
        operation("submit-3", "remote.submit", "2026-08-24T08:00:05Z"),
        operation("analysis-4", "remote.analysis", "2026-08-24T08:00:06Z"),
        operation("submit-4", "remote.submit", "2026-08-24T08:00:07Z"),
      ],
      spans: {
        "analysis-span-1": {
          spanId: "analysis-span-1",
          parentSpanId: "fanout-a",
          workUnitId: "analysis-1",
          attempt: 1,
          status: "running" as const,
          lastEventId: "evt-a1",
        },
        "submit-span-1": {
          spanId: "submit-span-1",
          parentSpanId: "analysis-span-1",
          workUnitId: "submit-1",
          attempt: 1,
          status: "succeeded" as const,
          lastEventId: "evt-s1",
        },
        "analysis-span-2": {
          spanId: "analysis-span-2",
          parentSpanId: "fanout-a",
          workUnitId: "analysis-2",
          attempt: 1,
          status: "running" as const,
          lastEventId: "evt-a2",
        },
        "submit-span-2": {
          spanId: "submit-span-2",
          parentSpanId: "analysis-span-2",
          workUnitId: "submit-2",
          attempt: 1,
          status: "succeeded" as const,
          lastEventId: "evt-s2",
        },
        "analysis-span-3": {
          spanId: "analysis-span-3",
          parentSpanId: "unrelated-b",
          workUnitId: "analysis-3",
          attempt: 1,
          status: "running" as const,
          lastEventId: "evt-a3",
        },
        "submit-span-3": {
          spanId: "submit-span-3",
          parentSpanId: "analysis-span-3",
          workUnitId: "submit-3",
          attempt: 1,
          status: "succeeded" as const,
          lastEventId: "evt-s3",
        },
        "analysis-span-4": {
          spanId: "analysis-span-4",
          parentSpanId: "unrelated-b",
          workUnitId: "analysis-4",
          attempt: 1,
          status: "running" as const,
          lastEventId: "evt-a4",
        },
        "submit-span-4": {
          spanId: "submit-span-4",
          parentSpanId: "analysis-span-4",
          workUnitId: "submit-4",
          attempt: 1,
          status: "succeeded" as const,
          lastEventId: "evt-s4",
        },
      },
    };

    const workflow = activityPresentation.presentExecutionWorkflowItems(run);
    expect(workflow).toHaveLength(2);
    expect(new Set(workflow.map((item) => item.id)).size).toBe(2);
    expect(workflow[0]).toMatchObject({
      kind: "operation",
      operation: {
        operationKey: "remote.analysis",
        progress: { completed: 0, total: 2, unit: "analyses" },
      },
      relatedOperations: [
        { operationKey: "remote.submit" },
        { operationKey: "remote.submit" },
      ],
    });
    expect(workflow[1]).toMatchObject({
      kind: "operation",
      operation: {
        operationKey: "remote.analysis",
        progress: { completed: 0, total: 2, unit: "analyses" },
      },
      relatedOperations: [
        { workUnitId: "submit-3" },
        { workUnitId: "submit-4" },
      ],
    });
  });

  it("keeps per-file publication in results and diagnostics, not workflow", () => {
    const events = [
      event(1, "artifact.published", {
        target: { kind: "artifact", id: "artifact-json" },
        status: "succeeded",
        payload: {
          name: "network.json",
          media_type: "application/octet-stream",
          size_bytes: 128,
        },
      }),
      event(2, "result.published", {
        target: { kind: "download", id: "network-archive" },
        status: "succeeded",
        payload: {
          name: "network-results.zip",
          media_type: "application/zip",
          size_bytes: 512,
        },
      }),
    ];
    const run = events.reduce(
      applyExecutionEvent,
      createExecutionRunState("turn-1")
    );

    expect(activityPresentation.presentExecutionWorkflowItems(run)).toEqual([]);
    expect(
      activityPresentation
        .presentExecutionTechnicalEvents(run)
        .map((item) => item.eventId)
    ).toEqual(["evt-1", "evt-2"]);
    expect(run.results.map((item) => item.name)).toEqual([
      "network.json",
      "network-results.zip",
    ]);
  });
});
