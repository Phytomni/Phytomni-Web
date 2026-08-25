import { describe, expect, it } from "vitest";

import { mountWithApp } from "../helpers/test-app-context";
import ExecutionRail from "@/views/chat/components/ExecutionRail.vue";
import ExecutionTimeline from "@/views/chat/components/ExecutionTimeline.vue";
import ExecutionWorkspace from "@/views/chat/components/ExecutionWorkspace.vue";
import {
  applyExecutionEvent,
  createExecutionRunState,
  decodeExecutionEvent,
  openExecutionTarget,
  type ExecutionRunState,
} from "@/views/chat/streaming/executionEvents";

function add(
  state: ExecutionRunState,
  seq: number,
  kind: string,
  payload: Record<string, unknown>,
  target?: { kind: string; id: string }
): ExecutionRunState {
  const decoded = decodeExecutionEvent({
    schema_version: 1,
    event_id: `evt-${seq}`,
    run_id: "run-1",
    seq,
    occurred_at: `2026-08-18T00:00:0${seq}Z`,
    kind,
    status: kind === "artifact.published" ? "succeeded" : "running",
    summary: { key: `activity.${kind}`, text: `${kind} summary` },
    payload,
    ignorable: false,
    ...(target ? { target } : {}),
  });
  if (!decoded.ok) throw new Error(decoded.reason);
  return applyExecutionEvent(state, decoded.value);
}

function runFixture(): ExecutionRunState {
  let run = createExecutionRunState("run-1");
  run = add(run, 1, "reasoning.summary", { text: "Compared safe evidence." });
  run = add(
    run,
    2,
    "todo.snapshot",
    {
      items: [
        { id: "prepare", label_key: "todo.prepare", status: "completed" },
        { id: "analyze", label_key: "todo.analyze", status: "in_progress" },
      ],
    },
    { kind: "todo", id: "todo-1" }
  );
  return add(
    run,
    3,
    "artifact.published",
    { name: "result.csv", media_type: "text/csv", size_bytes: 128 },
    { kind: "artifact", id: "artifact-1" }
  );
}

describe("Execution workbench", () => {
  it("renders safe reasoning summary and emits only decoded typed targets", async () => {
    const wrapper = mountWithApp(ExecutionTimeline, {
      props: { run: runFixture() },
    });
    expect(wrapper.text()).toContain("Compared safe evidence.");
    await wrapper.get(".execution-timeline__workflow button").trigger("click");
    expect(wrapper.emitted("open-target")?.[0]?.[0]).toEqual({
      kind: "todo",
      id: "todo-1",
    });
    wrapper.unmount();
  });

  it("renders persisted provider observations as meaningful work", () => {
    const decoded = decodeExecutionEvent({
      schema_version: 2,
      event_id: "evt-provider-running",
      execution_id: "turn-1",
      seq: 1,
      occurred_at: "2026-08-20T15:39:29Z",
      type: "work_unit.acknowledged",
      status: "running",
      source: "provider",
      span_id: "span-provider",
      parent_span_id: "span-agent",
      work_unit_id: "work-provider",
      attempt: 1,
      summary: {
        key: "provider.observation.running",
        text: "Provider status observed",
      },
      public_payload: { operation_key: "remote.analysis" },
    });
    if (!decoded.ok) throw new Error(decoded.reason);
    const run = applyExecutionEvent(
      createExecutionRunState("turn-1"),
      decoded.value
    );

    const wrapper = mountWithApp(ExecutionTimeline, { props: { run } });

    const workflow = wrapper.get(".execution-timeline__workflow");
    expect(workflow.text()).toContain("Run analysis");
    expect(workflow.text()).not.toContain("Provider status observed");
    wrapper.unmount();
  });

  it("renders semantic phase progress instead of protocol event names", () => {
    const decoded = decodeExecutionEvent({
      schema_version: 2,
      event_id: "evt-review-retrieving",
      execution_id: "turn-review",
      seq: 1,
      occurred_at: "2026-08-22T02:20:24Z",
      type: "span.progress",
      status: "running",
      source: "compatibility",
      span_id: "span-review",
      parent_span_id: "span-root",
      work_unit_id: null,
      attempt: 1,
      summary: { key: "activity.phase.progress", text: "phase.progress" },
      public_payload: { phase: "retrieving", completed: 4, total: 4 },
    });
    if (!decoded.ok) throw new Error(decoded.reason);
    const run = applyExecutionEvent(
      {
        ...createExecutionRunState("turn-review"),
        agentSlug: "review",
      },
      decoded.value
    );

    const wrapper = mountWithApp(ExecutionTimeline, { props: { run } });

    const workflow = wrapper.get(".execution-timeline__workflow");
    expect(workflow.text()).toContain("Retrieve evidence and data · 4/4");
    expect(workflow.text()).not.toContain("phase.progress");
    wrapper.unmount();
  });

  it("replaces Todo with the latest snapshot and opens result targets", async () => {
    const wrapper = mountWithApp(ExecutionRail, {
      props: { run: runFixture() },
    });
    expect(wrapper.text()).toContain("todo.prepare");
    expect(wrapper.text()).toContain("result.csv");
    await wrapper.find(".execution-rail__results button").trigger("click");
    expect(wrapper.emitted("open-target")?.[0]?.[0]).toEqual({
      kind: "artifact",
      id: "artifact-1",
    });
  });

  it("uses accessible tabs and supports arrow-key selection", async () => {
    const run = runFixture();
    const tabs = [
      {
        key: "todo:todo-1",
        target: { kind: "todo" as const, id: "todo-1" },
        title: "Todo",
      },
      {
        key: "artifact:artifact-1",
        target: { kind: "artifact" as const, id: "artifact-1" },
        title: "Result",
      },
    ];
    const wrapper = mountWithApp(ExecutionWorkspace, {
      props: { tabs, activeKey: tabs[0].key, run },
    });
    expect(wrapper.find('[role="tablist"]').exists()).toBe(true);
    expect(wrapper.findAll('[role="tab"]')[0].attributes("aria-selected")).toBe(
      "true"
    );
    await wrapper
      .find('[role="tablist"]')
      .trigger("keydown", { key: "ArrowRight" });
    expect(wrapper.emitted("select-tab")?.[0]).toEqual([tabs[1].key]);
  });

  it("renders bounded grouped diagnostics with accurate totals and paging", async () => {
    const base = runFixture();
    const first = base.events[0];
    const events = Array.from({ length: 1200 }, (_, index) => ({
      ...first,
      eventId: `evt-diagnostic-${index + 1}`,
      seq: index + 1,
      occurredAt: new Date(
        Date.parse("2026-08-18T00:00:00Z") + index * 30_000
      ).toISOString(),
      kind: "work_unit.progress",
      source: "provider",
      workUnitId: "work-analysis",
      summary: {
        key: "remote.analysis.active",
        text: "Run analysis is active",
      },
    }));
    const run = { ...base, events, latestSeq: 1200 };
    const tab = {
      key: "diagnostics:run-1",
      target: { kind: "event" as const, id: "diagnostics-run-1" },
      title: "Technical details",
      localView: "diagnostics" as const,
    };
    const wrapper = mountWithApp(ExecutionWorkspace, {
      props: { tabs: [tab], activeKey: tab.key, run },
    });

    expect(wrapper.get('[data-test="diagnostics-total"]').text()).toBe("1200");
    expect(wrapper.get('[data-test="diagnostics-displayed"]').text()).toBe(
      "100"
    );
    expect(wrapper.findAll(".execution-diagnostics__event")).toHaveLength(100);
    expect(wrapper.get(".execution-diagnostics__group").text()).toContain(
      "1200"
    );
    expect(wrapper.find('[data-test="diagnostics-export"]').exists()).toBe(
      true
    );
    await wrapper.get('[data-test="diagnostics-next"]').trigger("click");
    expect(wrapper.get(".execution-diagnostics__event").text()).toContain(
      "evt-diagnostic-101"
    );
  });

  it("shows the Todo empty state when a Todo workspace has no declared items", () => {
    const tab = {
      key: "todo:todo-empty",
      target: { kind: "todo" as const, id: "todo-empty" },
      title: "Todo",
    };
    const wrapper = mountWithApp(ExecutionWorkspace, {
      props: {
        tabs: [tab],
        activeKey: tab.key,
        run: createExecutionRunState("run-empty"),
      },
    });

    expect(wrapper.text()).toContain("This Agent did not declare a Todo plan.");
    expect(wrapper.find(".execution-workspace__todo").exists()).toBe(false);
    wrapper.unmount();
  });

  it("hosts message reports in a closable workspace tab without an execution run", async () => {
    const tabs = [
      {
        key: "report:message-42",
        target: { kind: "report" as const, id: "message-42" },
        title: "Review result",
      },
    ];
    const wrapper = mountWithApp(ExecutionWorkspace, {
      props: { tabs, activeKey: tabs[0].key },
      slots: {
        report: '<article data-test="message-report">Rendered report</article>',
      },
    });

    expect(wrapper.get('[data-test="message-report"]').text()).toBe(
      "Rendered report"
    );
    await wrapper.get(".execution-workspace__tab-close").trigger("click");
    expect(wrapper.emitted("close-tab")?.[0]).toEqual([tabs[0].key]);
  });

  it("renders bounded log detail and retains authorized download fallback", () => {
    const run = runFixture();
    const tab = {
      key: "artifact:artifact-1",
      target: { kind: "artifact" as const, id: "artifact-1" },
      title: "Execution log",
    };
    const wrapper = mountWithApp(ExecutionWorkspace, {
      props: {
        tabs: [tab],
        activeKey: tab.key,
        run,
        detail: {
          schemaVersion: 1 as const,
          kind: "artifact" as const,
          id: "artifact-1",
          eventId: "evt-3",
          name: "execution.log",
          mediaType: "text/plain",
          messageId: 42,
          artifactId: "artifact-download",
          previewAvailable: true,
          todos: [],
          event: {
            ...run.events[2],
            payload: { text: "safe tool output" },
          },
        },
      },
    });

    expect(wrapper.get(".execution-workspace__log").text()).toBe(
      "safe tool output"
    );
    expect(wrapper.find(".execution-workspace__action").exists()).toBe(true);
  });

  it("offers V2 delivery download without a legacy artifact id", async () => {
    const run = runFixture();
    const tab = {
      key: "artifact:artifact-1",
      target: { kind: "artifact" as const, id: "artifact-1" },
      title: "Result",
    };
    const wrapper = mountWithApp(ExecutionWorkspace, {
      props: {
        tabs: [tab],
        activeKey: tab.key,
        run,
        detail: {
          schemaVersion: 2 as const,
          executionId: "run-1",
          kind: "artifact" as const,
          id: "artifact-1",
          eventId: "artifact-1",
          name: "result.csv",
          mediaType: "application/octet-stream",
          sizeBytes: 2_000_000,
          deliveryUrl:
            "/api/v1/executions/run-1/targets/artifact/artifact-1/content",
          previewAvailable: true,
          todos: [],
        },
      },
    });

    await wrapper.get(".execution-workspace__action").trigger("click");
    expect(wrapper.emitted("authorize-target")?.[0]?.[0]).toEqual(tab.target);
  });

  it.each([
    "result.json",
    "result.csv",
    "result.png",
    "result.jpg",
    "result.jpeg",
    "result.svg",
    "result.zip",
  ])("keeps authorized download available for %s", async (name) => {
    const run = runFixture();
    const target = { kind: "artifact" as const, id: "artifact-1" };
    const wrapper = mountWithApp(ExecutionWorkspace, {
      props: {
        tabs: [{ key: "artifact:artifact-1", target, title: name }],
        activeKey: "artifact:artifact-1",
        run,
        detail: {
          schemaVersion: 2 as const,
          executionId: "run-1",
          kind: "artifact" as const,
          id: "artifact-1",
          eventId: "artifact-1",
          name,
          mediaType: "application/octet-stream",
          sizeBytes: 20_000_000,
          deliveryUrl:
            "/api/v1/executions/run-1/targets/artifact/artifact-1/content",
          previewAvailable: true,
          todos: [],
        },
      },
    });

    await wrapper.get(".execution-workspace__action").trigger("click");
    expect(wrapper.emitted("authorize-target")?.[0]?.[0]).toEqual(target);
  });

  it("adds trace activity and a trace tab without changing result state", () => {
    const before = runFixture();
    const traceTarget = {
      kind: "trace" as const,
      id: "trc_A1b2C3d4E5f6G7h8",
    };
    const decoded = decodeExecutionEvent({
      schema_version: 2,
      event_id: "evt-trace-operation",
      execution_id: "run-1",
      seq: 4,
      occurred_at: "2026-08-18T00:00:04Z",
      type: "work_unit.acknowledged",
      status: "running",
      source: "provider",
      span_id: "span-trace",
      parent_span_id: "span-root",
      work_unit_id: "work-trace",
      attempt: 1,
      summary: { key: "trace.running", text: "Run analysis" },
      public_payload: { operation_key: "remote.analysis" },
      target: traceTarget,
      idempotency_key: "trace-operation-running",
    });
    if (!decoded.ok) throw new Error(decoded.reason);
    const after = applyExecutionEvent(before, decoded.value);

    expect(after.results).toEqual(before.results);
    expect(after.todos).toEqual(before.todos);
    expect(after.operations[0].target).toEqual(traceTarget);
    const opened = openExecutionTarget(
      [
        {
          key: "artifact:artifact-1",
          target: { kind: "artifact", id: "artifact-1" },
          title: "result.csv",
        },
      ],
      traceTarget,
      "Run analysis"
    );
    expect(opened.tabs.map((tab) => tab.key)).toEqual([
      "artifact:artifact-1",
      "trace:trc_A1b2C3d4E5f6G7h8",
    ]);
  });

  it("renders a work-trace header, clocks, feed, counters, attempts and result link", async () => {
    const target = {
      kind: "trace" as const,
      id: "trc_A1b2C3d4E5f6G7h8",
    };
    const resultTarget = { kind: "artifact" as const, id: "artifact-result" };
    const wrapper = mountWithApp(ExecutionWorkspace, {
      props: {
        tabs: [{ key: `trace:${target.id}`, target, title: "Run analysis" }],
        activeKey: `trace:${target.id}`,
        detail: {
          schemaVersion: 1 as const,
          kind: "trace" as const,
          id: target.id,
          eventId: target.id,
          previewAvailable: false,
          todos: [],
          trace: {
            schemaVersion: 1 as const,
            target,
            health: "healthy" as const,
            operation: {
              operationId: "op-analysis",
              operationKey: "remote.analysis",
              labelKey: "execution.operation.remote.analysis",
              fallbackLabel: "Run analysis",
              status: "running" as const,
              startedAt: "2026-08-23T08:00:00Z",
              lastObservationAt: "2026-08-23T08:00:02Z",
              completedAt: null,
              durationMs: 2000,
              currentAttempt: 1,
              attempts: [],
              progress: null,
              detail: { provider_state: "running" },
              summary: null,
              target,
            },
            lastSemanticActivityAt: "2026-08-23T08:00:02Z",
            lastProviderContactAt: "2026-08-23T08:00:03Z",
            items: [
              {
                schemaVersion: 1 as const,
                itemId: "item-result",
                seq: 7,
                kind: "tool" as const,
                operationKey: "gene_network.infer_network",
                labelKey: "execution.trace.geneNetwork.inferNetwork",
                fallbackLabel: "provider.internal.infer_network",
                status: "succeeded" as const,
                attempt: 1,
                occurredAt: "2026-08-23T08:00:02Z",
                durationMs: 1200,
                progress: { completed: 8, total: 8, unit: "genes" },
                attempts: [
                  {
                    attempt: 1,
                    status: "succeeded" as const,
                    startedAt: "2026-08-23T08:00:01Z",
                    completedAt: "2026-08-23T08:00:02Z",
                    durationMs: 1200,
                    failure: null,
                    retry: null,
                  },
                ],
                detail: { gene_count: 8 },
                summary: "Network inference completed",
                target: resultTarget,
              },
              {
                schemaVersion: 1 as const,
                itemId: "item-reasoning",
                seq: 8,
                kind: "reasoning_summary" as const,
                operationKey: "gene_network.target_validated",
                labelKey: "execution.trace.reasoning_summary",
                fallbackLabel: "provider.internal.reasoning",
                status: "running" as const,
                attempt: 1,
                occurredAt: "2026-08-23T08:00:03Z",
                durationMs: null,
                progress: null,
                attempts: [],
                detail: {},
                summary:
                  "Validated the trait target and species for network analysis.",
                target: null,
              },
            ],
            nextAfterSeq: 8,
            hasMore: false,
          },
        },
      },
    });

    expect(wrapper.get(".execution-work-trace__header").text()).toContain(
      "Run analysis"
    );
    expect(wrapper.get(".execution-work-trace__clocks").text()).toContain(
      "2026-08-23"
    );
    expect(wrapper.get(".execution-work-trace__feed").text()).toContain(
      "Infer regulatory network"
    );
    expect(wrapper.get(".execution-work-trace__feed").text()).toContain(
      "Reasoning summary"
    );
    expect(wrapper.get(".execution-work-trace__feed").text()).not.toContain(
      "provider.internal"
    );
    expect(wrapper.get(".execution-work-trace__feed").text()).toContain("8/8");
    await wrapper.get(".execution-work-trace__result").trigger("click");
    expect(wrapper.emitted("open-target")?.[0]?.[0]).toEqual(resultTarget);
    const firstFeedItem = wrapper.findAll(
      ".execution-work-trace__feed details"
    )[0];
    await firstFeedItem.get("summary").trigger("click");
    expect(firstFeedItem.attributes()).toHaveProperty("open");
    const initialDetail = wrapper.props("detail");
    if (!initialDetail?.trace) throw new Error("trace fixture missing");
    await wrapper.setProps({
      detail: {
        ...initialDetail,
        trace: {
          ...initialDetail.trace,
          health: "degraded",
          operation: {
            ...initialDetail.trace.operation,
            status: "succeeded",
            completedAt: "2026-08-23T08:00:05Z",
            durationMs: 5000,
          },
        },
      },
    });
    expect(wrapper.get(".execution-work-trace__header").text()).toContain(
      "Completed"
    );
    expect(wrapper.get(".execution-work-trace__header").text()).toContain(
      "Trace delayed"
    );
    expect(
      wrapper.findAll(".execution-work-trace__feed details")[0].attributes()
    ).toHaveProperty("open");
  });
});
