import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import ExecutionActivityPanel from "@/views/chat/components/ExecutionActivityPanel.vue";
import ExecutionRail from "@/views/chat/components/ExecutionRail.vue";
import ExecutionTimeline from "@/views/chat/components/ExecutionTimeline.vue";
import {
  createExecutionRunState,
  type ExecutionEvent,
  type ExecutionOperationRecord,
  type ExecutionRunState,
} from "@/views/chat/streaming/executionEvents";
import { createTestAppContext } from "../helpers/test-app-context";

function operation(
  overrides: Partial<ExecutionOperationRecord> = {}
): ExecutionOperationRecord {
  return {
    schemaVersion: 1,
    operationId: "operation-search",
    workUnitId: "work-search",
    operationKey: "knowledge.search",
    labelKey: "execution.operation.knowledge.search",
    fallbackLabel: "Search knowledge",
    status: "retrying",
    startedAt: "2026-08-22T08:00:00Z",
    lastObservationAt: "2026-08-22T08:00:20Z",
    completedAt: null,
    durationMs: 20_000,
    currentAttempt: 2,
    attempts: [
      {
        attempt: 1,
        status: "failed",
        startedAt: "2026-08-22T08:00:00Z",
        completedAt: "2026-08-22T08:00:10Z",
        durationMs: 10_000,
        failure: { code: "UPSTREAM_BUSY", retryable: true },
        retry: { delayMs: 1_000 },
      },
      {
        attempt: 2,
        status: "running",
        startedAt: "2026-08-22T08:00:11Z",
        completedAt: null,
        durationMs: 9_000,
        failure: null,
        retry: null,
      },
    ],
    progress: { completed: 2, total: 4, unit: "repositories" },
    detail: { repository_count: 2 },
    summary: { kind: "operation", text: "Search retry scheduled" },
    target: { kind: "artifact", id: "artifact-search" },
    ...overrides,
  };
}

function run(overrides: Partial<ExecutionRunState> = {}): ExecutionRunState {
  return {
    ...createExecutionRunState("turn-detail", 2),
    status: "running",
    startedAt: "2026-08-22T08:00:00Z",
    lastActivityAt: "2026-08-22T08:00:05Z",
    lastContactAt: "2026-08-22T08:00:29Z",
    operations: [operation()],
    executionStage: {
      stage: "scientific_execution",
      childStatus: null,
      rootStatus: "running",
      answerAvailable: false,
      todos: [
        { id: "planning", status: "completed" },
        { id: "analysis", status: "in_progress" },
        { id: "consolidation", status: "pending" },
        { id: "response", status: "pending" },
      ],
      pendingStatusKey: "execution.pending.running",
      clocks: {
        lastExecutionFactAt: "2026-08-22T08:00:05Z",
        lastProviderContactAt: "2026-08-22T08:00:20Z",
        lastStreamContactAt: "2026-08-22T08:00:29Z",
      },
    },
    ...overrides,
  };
}

function event(
  seq: number,
  kind: string,
  overrides: Partial<ExecutionEvent> = {}
): ExecutionEvent {
  return {
    schemaVersion: 2,
    eventId: `event-${seq}`,
    executionId: "turn-detail",
    runId: "turn-detail",
    seq,
    occurredAt: `2026-08-22T08:00:${String(seq).padStart(2, "0")}Z`,
    kind,
    known: true,
    ignorable: false,
    status: "running",
    summary: { key: kind, text: kind },
    payload: {},
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("ExecutionTimeline", () => {
  it("exposes one keyboard-expandable operation with approved detail and target", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-22T08:00:30Z"));
    const wrapper = createTestAppContext({ elementPlus: false }).mount(
      ExecutionTimeline,
      { props: { run: run() } }
    );

    expect(wrapper.findAll(".execution-timeline__operation")).toHaveLength(1);
    const summary = wrapper.get("summary");
    expect(summary.text()).toContain("Search knowledge");
    expect(summary.text()).toContain("Retrying");
    await summary.trigger("click");
    expect(wrapper.get("details").attributes()).toHaveProperty("open");
    expect(wrapper.get(".execution-timeline__attempts").text()).toContain(
      "UPSTREAM_BUSY"
    );
    expect(wrapper.text()).toContain("2/4 repositories");
    await wrapper.get(".execution-timeline__target").trigger("click");
    expect(wrapper.emitted("open-target")?.[0]).toEqual([
      { kind: "artifact", id: "artifact-search" },
      "Search knowledge",
    ]);
    wrapper.unmount();
  });

  it("keeps semantic progress, provider contact and stream connectivity separate", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-22T08:00:30Z"));
    const wrapper = createTestAppContext({ elementPlus: false }).mount(
      ExecutionTimeline,
      { props: { run: run() } }
    );

    expect(wrapper.get("[role='status']").text()).toContain(
      "last activity 25s ago"
    );
    expect(wrapper.get("[data-clock='provider']").text()).toContain("10s ago");
    expect(wrapper.get("[data-clock='stream']").text()).toBe(
      "Event stream connected"
    );
    wrapper.unmount();
  });

  it("retains a responsive narrow-screen detail layout", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/views/chat/components/ExecutionTimeline.vue"),
      "utf8"
    );
    expect(source).toContain("@media (max-width: 640px)");
    expect(source).toContain("grid-template-columns: 1fr");
  });

  it("renders one semantic workflow and opens protocol facts in the workspace", async () => {
    const wrapper = createTestAppContext({ elementPlus: false }).mount(
      ExecutionTimeline,
      {
        props: {
          run: run({
            operations: [
              operation({
                status: "succeeded",
                startedAt: "2026-08-22T08:00:03Z",
                lastObservationAt: "2026-08-22T08:00:05Z",
                completedAt: "2026-08-22T08:00:05Z",
                durationMs: 2_000,
                currentAttempt: 1,
              }),
            ],
            events: [
              event(1, "execution.started"),
              event(2, "todo.snapshot", {
                payload: {
                  items: [
                    {
                      id: "search",
                      label_key: "todo.search",
                      status: "pending",
                    },
                  ],
                },
                target: { kind: "todo", id: "todo-1" },
              }),
              event(6, "message.snapshot"),
              event(7, "reasoning.summary", {
                payload: { text: "Safe public summary" },
              }),
            ],
          }),
        },
      }
    );

    const workflow = wrapper.get(".execution-timeline__workflow");
    const rows = workflow.findAll(".execution-timeline__item");
    expect(rows).toHaveLength(3);
    expect(rows[0].text()).toContain("Todo");
    expect(rows[1].text()).toContain("Search knowledge");
    expect(rows[2].text()).toContain("Reasoning summary");
    expect(
      workflow.findAll(
        ".execution-timeline__workflow-event .execution-timeline__label"
      )
    ).toHaveLength(2);

    const technical = wrapper.get(".execution-timeline__technical");
    expect(technical.text()).toContain("Technical details");
    expect(technical.text()).toContain("4 protocol events");
    expect(wrapper.find(".execution-timeline__technical ol").exists()).toBe(
      false
    );
    expect(wrapper.text()).not.toContain("message.snapshot");
    await technical.trigger("click");
    expect(wrapper.emitted("open-diagnostics")?.[0]).toEqual([]);
    wrapper.unmount();
  });

  it("renders sibling knowledge searches as one progress row while retaining their protocol facts", () => {
    const searches = Array.from({ length: 19 }, (_, index) =>
      operation({
        operationId: `operation-search-${index + 1}`,
        workUnitId: `work-search-${index + 1}`,
        status: "succeeded",
        startedAt: `2026-08-22T08:00:${String(index).padStart(2, "0")}Z`,
        lastObservationAt: `2026-08-22T08:00:${String(index + 1).padStart(2, "0")}Z`,
        completedAt: `2026-08-22T08:00:${String(index + 1).padStart(2, "0")}Z`,
        durationMs: 1_000,
        currentAttempt: 1,
        attempts: [],
        progress: null,
        detail: { result_count: 128 },
        summary: null,
        target: null,
      })
    );
    const protocolEvents = Array.from({ length: 114 }, (_, index) =>
      event(index + 1, "work_unit.registered", {
        occurredAt: new Date(
          Date.parse("2026-08-22T08:00:00Z") + index * 10
        ).toISOString(),
        workUnitId: `work-search-${Math.floor(index / 6) + 1}`,
        payload: { operation_key: "knowledge.search" },
      })
    );
    const wrapper = createTestAppContext({ elementPlus: false }).mount(
      ExecutionTimeline,
      {
        props: { run: run({ operations: searches, events: protocolEvents }) },
      }
    );

    expect(wrapper.findAll(".execution-timeline__operation")).toHaveLength(1);
    expect(wrapper.get(".execution-timeline__operation").text()).toContain(
      "19/19 searches"
    );
    expect(wrapper.get(".execution-timeline__technical").text()).toContain(
      "114 protocol events"
    );
    expect(wrapper.findAll(".execution-timeline__technical li")).toHaveLength(
      0
    );
    wrapper.unmount();
  });

  it("keeps healthy operation metadata concise and retry metadata diagnostic", () => {
    const healthy = operation({
      status: "succeeded",
      completedAt: "2026-08-22T08:00:02Z",
      lastObservationAt: "2026-08-22T08:00:02Z",
      durationMs: 2_000,
      currentAttempt: 1,
      attempts: [
        {
          attempt: 1,
          status: "succeeded",
          startedAt: "2026-08-22T08:00:00Z",
          completedAt: "2026-08-22T08:00:02Z",
          durationMs: 2_000,
          failure: null,
          retry: null,
        },
      ],
    });
    const healthyWrapper = createTestAppContext({ elementPlus: false }).mount(
      ExecutionTimeline,
      { props: { run: run({ operations: [healthy] }) } }
    );
    const healthySummary = healthyWrapper.get(
      ".execution-timeline__operation summary"
    );
    expect(healthySummary.text()).toContain("Completed");
    expect(healthySummary.text()).toContain("2.0 s");
    expect(healthySummary.text()).not.toContain("attempt 1");
    expect(healthySummary.text()).not.toContain("observed");
    healthyWrapper.unmount();

    const retryWrapper = createTestAppContext({ elementPlus: false }).mount(
      ExecutionTimeline,
      { props: { run: run() } }
    );
    const retrySummary = retryWrapper.get(
      ".execution-timeline__operation summary"
    );
    expect(retrySummary.text()).toContain("Retrying");
    expect(retrySummary.text()).toContain("attempt 2");
    expect(retrySummary.text()).toContain("observed");
    retryWrapper.unmount();
  });

  it("opens the latest coalesced Todo target in the existing workspace route", async () => {
    const wrapper = createTestAppContext({ elementPlus: false }).mount(
      ExecutionTimeline,
      {
        props: {
          run: run({
            operations: [],
            events: [
              event(1, "todo.snapshot", {
                payload: {
                  items: [
                    {
                      id: "search",
                      label_key: "todo.search",
                      status: "pending",
                    },
                  ],
                },
                target: { kind: "todo", id: "todo-initial" },
              }),
              event(2, "todo.snapshot", {
                payload: {
                  items: [
                    {
                      id: "search",
                      label_key: "todo.search",
                      status: "completed",
                    },
                    {
                      id: "report",
                      label_key: "todo.report",
                      status: "in_progress",
                    },
                  ],
                },
                target: { kind: "todo", id: "todo-latest" },
              }),
            ],
          }),
        },
      }
    );

    const plan = wrapper.get(
      ".execution-timeline__workflow-event .execution-timeline__row"
    );
    expect(plan.text()).toContain("Todo plan");
    expect(plan.text()).toContain("2 steps");
    await plan.trigger("click");
    expect(wrapper.emitted("open-target")?.[0]).toEqual([
      { kind: "todo", id: "todo-latest" },
      "Todo plan",
    ]);
    wrapper.unmount();
  });

  it("opens a targetable Run analysis row while protocol details remain collapsed", async () => {
    const traceTarget = {
      kind: "trace" as const,
      id: "trc_A1b2C3d4E5f6G7h8",
    };
    const wrapper = createTestAppContext({ elementPlus: false }).mount(
      ExecutionTimeline,
      {
        props: {
          run: run({
            operations: [
              operation({
                operationId: "operation-analysis",
                workUnitId: "work-analysis",
                operationKey: "remote.analysis",
                labelKey: "execution.operation.remote.analysis",
                fallbackLabel: "Run analysis",
                target: traceTarget,
              }),
            ],
            events: [event(1, "work_unit.registered")],
          }),
        },
      }
    );

    const summary = wrapper.get(".execution-timeline__operation summary");
    await summary.trigger("click");
    expect(wrapper.emitted("open-target")?.[0]).toEqual([
      traceTarget,
      "Run analysis",
    ]);
    expect(
      wrapper.get(".execution-timeline__operation details").attributes()
    ).not.toHaveProperty("open");
    expect(
      wrapper.get(".execution-timeline__technical").attributes()
    ).not.toHaveProperty("open");
  });

  it("renders provider submission as attempt detail under its owning analysis", async () => {
    const analysis = operation({
      operationId: "operation-analysis",
      workUnitId: "work-analysis",
      operationKey: "remote.analysis",
      labelKey: "execution.operation.remote.analysis",
      fallbackLabel: "Run analysis",
      status: "running",
      target: null,
    });
    const submission = operation({
      operationId: "operation-submit",
      workUnitId: "work-submit",
      operationKey: "remote.submit",
      labelKey: "execution.operation.remote.submit",
      fallbackLabel: "Submit analysis",
      status: "succeeded",
      target: null,
    });
    const wrapper = createTestAppContext({ elementPlus: false }).mount(
      ExecutionTimeline,
      {
        props: {
          run: run({
            operations: [analysis, submission],
            spans: {
              "span-analysis": {
                spanId: "span-analysis",
                parentSpanId: "span-root",
                workUnitId: "work-analysis",
                attempt: 1,
                status: "running",
                lastEventId: "evt-analysis",
              },
              "span-submit": {
                spanId: "span-submit",
                parentSpanId: "span-analysis",
                workUnitId: "work-submit",
                attempt: 1,
                status: "succeeded",
                lastEventId: "evt-submit",
              },
            },
          }),
        },
      }
    );

    expect(wrapper.findAll(".execution-timeline__operation")).toHaveLength(1);
    await wrapper
      .get(".execution-timeline__operation summary")
      .trigger("click");
    expect(wrapper.get(".execution-timeline__related").text()).toContain(
      "Submit analysis"
    );
  });

  it("keeps a multi-hour remote fan-out bounded without fake percent or ETA", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-24T12:00:00Z"));
    const analyses = [1, 2].map((index) =>
      operation({
        operationId: `operation-analysis-${index}`,
        workUnitId: `work-analysis-${index}`,
        operationKey: "remote.analysis",
        labelKey: "execution.operation.remote.analysis",
        fallbackLabel: "Run analysis",
        status: "running",
        startedAt: `2026-08-24T0${index}:00:00Z`,
        lastObservationAt: "2026-08-24T11:59:30Z",
        completedAt: null,
        durationMs: index * 10_000_000,
        currentAttempt: 1,
        attempts: [],
        progress: null,
        detail: {},
        summary: null,
        target: {
          kind: "trace",
          id: `trc_LongRunningBranch000${index}`,
        },
      })
    );
    const submissions = [1, 2].map((index) =>
      operation({
        operationId: `operation-submit-${index}`,
        workUnitId: `work-submit-${index}`,
        operationKey: "remote.submit",
        labelKey: "execution.operation.remote.submit",
        fallbackLabel: "Submit analysis",
        status: "succeeded",
        startedAt: `2026-08-24T0${index}:00:00Z`,
        lastObservationAt: `2026-08-24T0${index}:00:05Z`,
        completedAt: `2026-08-24T0${index}:00:05Z`,
        durationMs: 5_000,
        currentAttempt: 1,
        attempts: [],
        progress: null,
        detail: {},
        summary: null,
        target: null,
      })
    );
    const spans = Object.fromEntries(
      [1, 2].flatMap((index) => [
        [
          `span-analysis-${index}`,
          {
            spanId: `span-analysis-${index}`,
            parentSpanId: "span-design-fanout",
            workUnitId: `work-analysis-${index}`,
            attempt: 1,
            status: "running" as const,
            lastEventId: `evt-analysis-${index}`,
          },
        ],
        [
          `span-submit-${index}`,
          {
            spanId: `span-submit-${index}`,
            parentSpanId: `span-analysis-${index}`,
            workUnitId: `work-submit-${index}`,
            attempt: 1,
            status: "succeeded" as const,
            lastEventId: `evt-submit-${index}`,
          },
        ],
      ])
    );
    const protocolEvents = Array.from({ length: 1200 }, (_, index) =>
      event(index + 1, "work_unit.progress", {
        occurredAt: new Date(
          Date.parse("2026-08-24T01:00:00Z") + index * 30_000
        ).toISOString(),
        workUnitId: `work-analysis-${(index % 2) + 1}`,
        source: "provider",
        payload: { observation: "provider_contact" },
      })
    );
    const wrapper = createTestAppContext({ elementPlus: false }).mount(
      ExecutionTimeline,
      {
        props: {
          run: run({
            agentSlug: "design",
            operations: [...analyses, ...submissions],
            spans,
            events: protocolEvents,
          }),
        },
      }
    );

    expect(wrapper.findAll(".execution-timeline__operation")).toHaveLength(1);
    const activityText = wrapper.get(".execution-timeline__operation").text();
    expect(activityText).toContain("0/2 analyses");
    expect(activityText).not.toMatch(/\d+%/);
    expect(activityText).not.toContain("ETA");
    expect(wrapper.get(".execution-timeline__technical").text()).toContain(
      "1200 protocol events"
    );
    await wrapper
      .get(".execution-timeline__operation summary")
      .trigger("click");
    expect(wrapper.findAll(".execution-timeline__branches li")).toHaveLength(2);
    expect(wrapper.findAll(".execution-timeline__related li")).toHaveLength(2);
    wrapper.unmount();
  });
});

describe("Execution activity surfaces", () => {
  it("shows the Todo empty state instead of execution-stage lifecycle phases", () => {
    const context = createTestAppContext({ elementPlus: false });
    const withoutLog = context.mount(ExecutionRail, { props: { run: run() } });
    expect(withoutLog.text()).toContain(
      "This Agent did not declare a Todo plan."
    );
    expect(withoutLog.text()).not.toContain("Plan the work");
    expect(withoutLog.text()).not.toContain("Run the analysis");
    expect(withoutLog.text()).not.toContain("Consolidate the results");
    expect(withoutLog.text()).not.toContain("Prepare the response");
    expect(withoutLog.text()).not.toContain("Execution log");
    withoutLog.unmount();

    const logRun = run({
      results: [
        {
          eventId: "event-log",
          name: "execution-log.json",
          mediaType: "application/json",
          sizeBytes: 512,
          target: { kind: "artifact", id: "log-1" },
        },
      ],
    });
    const withLog = context.mount(ExecutionRail, { props: { run: logRun } });
    expect(withLog.text()).toContain("Execution log");
    withLog.unmount();
  });

  it("shows exactly the declared Agent Todo while execution-stage state exists", () => {
    const wrapper = createTestAppContext({ elementPlus: false }).mount(
      ExecutionRail,
      {
        props: {
          run: run({
            todoDeclared: true,
            todos: [
              {
                id: "drafting",
                labelKey: "chat.execution.todoPhase.drafting",
                status: "completed",
              },
              {
                id: "revising",
                labelKey: "chat.execution.todoPhase.revising",
                status: "in_progress",
              },
            ],
          }),
        },
      }
    );

    expect(wrapper.text()).toContain("Draft the report");
    expect(wrapper.text()).toContain("Review and revise");
    expect(wrapper.text()).not.toContain("Plan the work");
    expect(wrapper.text()).not.toContain("Run the analysis");
    expect(wrapper.findAll(".execution-rail__list li")).toHaveLength(2);
    wrapper.unmount();
  });

  it("renders pending state outside answer content and hides it once an answer exists", async () => {
    const wrapper = createTestAppContext({ elementPlus: false }).mount(
      ExecutionActivityPanel,
      {
        props: { run: run(), expanded: true },
        global: {
          stubs: {
            ChatActivity: { template: "<section><slot /></section>" },
            ExecutionTimeline: true,
          },
        },
      }
    );
    expect(wrapper.get(".execution-pending").text()).toBe(
      "The analysis is running…"
    );
    await wrapper.setProps({ run: run({ outputText: "Answer" }) });
    expect(wrapper.find(".execution-pending").exists()).toBe(false);
    wrapper.unmount();
  });
});
