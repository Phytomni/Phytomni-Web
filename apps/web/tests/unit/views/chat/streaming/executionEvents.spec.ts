import { describe, expect, it } from "vitest";

import fixtures from "../../../../../../../docs/reference/execution-events.v1.fixtures.json";
import runtimeFixtures from "../../../../../../../docs/reference/execution-runtime.v2.fixtures.json";
import {
  applyExecutionEvent,
  createExecutionRunState,
  decodeExecutionEvent,
  decodeExecutionEventPage,
  decodeExecutionProjection,
  decodeExecutionTargetResolution,
  decodeExecutionTraceResolution,
  executionEventFromAGUI,
  hydrateExecutionProjection,
  mergeExecutionTracePage,
  openExecutionTarget,
} from "@/views/chat/streaming/executionEvents";

function fixtureEvent(overrides: Record<string, unknown>) {
  return {
    ...fixtures.base_event,
    ...overrides,
    payload: overrides.payload ?? fixtures.base_event.payload,
  };
}

describe("execution event V1 decoder", () => {
  it("accepts every shared valid event and the projection", () => {
    for (const [index, item] of fixtures.valid_events.entries()) {
      const decoded = decodeExecutionEvent(
        fixtureEvent({ ...item.event, seq: index + 1 })
      );
      expect(decoded.ok, item.name).toBe(true);
    }
    expect(decodeExecutionProjection(fixtures.projection).ok).toBe(true);
  });

  it("decodes and hydrates the selected agent identity from a V2 projection", () => {
    const rawProjection = {
      schema_version: 2,
      execution_id: "turn-network",
      agent_slug: "network",
      status: "succeeded",
      latest_seq: 1,
      output_revision: 1,
      output_offset: 4,
      operation_revision: 0,
      tracking_health: "healthy",
      active_span_ids: [],
      todo_declared: false,
      todos: [],
      results: [],
      targets: [],
      failed_work_unit_ids: [],
      warnings: [
        { code: "report_context_truncated", work_unit_id: null },
        { code: "future_safe_warning", work_unit_id: "work-1" },
        { code: "report_context_truncated", work_unit_id: null },
      ],
      input_required: null,
      context_stage: {
        schema_version: 1,
        turn_id: "turn-1",
        selected_agent_id: "GeneNetworkAgent",
        route_source: "router",
        route_reason_code: "DOMAIN_RESOLVER_SELECTED",
        base_business_context_version: 0,
        proposed_business_context_version: 1,
        last_applied_ledger_cursor: 0,
        context_truncated: false,
        context_rebuilt: false,
      },
      terminal: {
        status: "succeeded",
        event_id: "event-terminal",
        result_revision: 1,
      },
    };
    const decoded = decodeExecutionProjection(rawProjection);

    expect(decoded).toMatchObject({
      ok: true,
      value: {
        agentSlug: "network",
        selectedAgentId: "GeneNetworkAgent",
        routeReasonCode: "DOMAIN_RESOLVER_SELECTED",
        reportWarningCodes: ["report_context_truncated"],
      },
    });
    if (!decoded.ok) throw new Error(decoded.reason);
    expect(
      hydrateExecutionProjection(
        createExecutionRunState("turn-network", 2),
        decoded.value
      )
    ).toMatchObject({
      agentSlug: "network",
      selectedAgentId: "GeneNetworkAgent",
      routeReasonCode: "DOMAIN_RESOLVER_SELECTED",
      reportWarningCodes: ["report_context_truncated"],
    });
    expect(
      decodeExecutionProjection({
        ...rawProjection,
        warnings: [
          {
            code: "report_context_truncated",
            work_unit_id: null,
            provider_detail: "must not cross the boundary",
          },
        ],
      })
    ).toMatchObject({ ok: false, reason: "invalid_projection" });
  });

  it("hydrates grouped operations and keeps semantic/provider/stream clocks distinct", () => {
    const operation = {
      schema_version: 1,
      operation_id: "operation-search",
      work_unit_id: "work-search",
      operation_key: "knowledge.search",
      label_key: "execution.operation.knowledge.search",
      fallback_label: "Search knowledge",
      status: "running",
      started_at: "2026-08-22T08:00:00Z",
      last_observation_at: "2026-08-22T08:00:01Z",
      completed_at: null,
      duration_ms: 1000,
      current_attempt: 1,
      attempts: [
        {
          attempt: 1,
          status: "running",
          started_at: "2026-08-22T08:00:00Z",
          completed_at: null,
          duration_ms: 1000,
          failure: null,
          retry: null,
        },
      ],
      progress: null,
      detail: { repository_count: 2 },
      summary: null,
      target: null,
    };
    const decoded = decodeExecutionProjection({
      schema_version: 2,
      execution_id: "turn-grouped",
      status: "running",
      latest_seq: 2,
      output_revision: 0,
      output_offset: 0,
      operation_revision: 0,
      operations: [operation],
      execution_stage: {
        stage: "scientific_execution",
        child_status: null,
        root_status: "running",
        answer_available: false,
        todos: [
          { id: "planning", status: "completed" },
          { id: "analysis", status: "in_progress" },
          { id: "consolidation", status: "pending" },
          { id: "response", status: "pending" },
        ],
        pending_status_key: "execution.pending.running",
        clocks: {
          last_execution_fact_at: "2026-08-22T08:00:01Z",
          last_provider_contact_at: null,
          last_stream_contact_at: null,
        },
      },
      tracking_health: "healthy",
      active_span_ids: [],
      todo_declared: false,
      todos: [],
      results: [],
      targets: [],
      failed_work_unit_ids: [],
      warnings: [],
      input_required: null,
      context_stage: null,
      terminal: null,
    });
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) throw new Error(decoded.reason);
    let state = hydrateExecutionProjection(
      createExecutionRunState("turn-grouped", 2),
      decoded.value
    );
    expect(state.operations).toHaveLength(1);
    expect(state.executionStage?.stage).toBe("scientific_execution");

    const providerContact = decodeExecutionEvent({
      schema_version: 2,
      event_id: "event-provider-contact",
      execution_id: "turn-grouped",
      seq: 3,
      type: "work_unit.progress",
      status: "running",
      occurred_at: "2026-08-22T08:00:03Z",
      source: "provider",
      span_id: "span-search",
      parent_span_id: "span-root",
      work_unit_id: "work-search",
      attempt: 1,
      summary: { key: "knowledge.search.contact", text: "Provider contact" },
      public_payload: {
        phase: "knowledge.search",
        observation: "provider_contact",
        elapsed_ms: 3000,
      },
      target: null,
      idempotency_key: "provider-contact-3",
    });
    expect(providerContact.ok).toBe(true);
    if (!providerContact.ok) throw new Error(providerContact.reason);
    state = applyExecutionEvent(state, providerContact.value);
    expect(state.operations).toHaveLength(1);
    expect(state.executionStage?.clocks.lastProviderContactAt).toBe(
      "2026-08-22T08:00:03Z"
    );
    expect(state.executionStage?.clocks.lastExecutionFactAt).toBe(
      "2026-08-22T08:00:01Z"
    );
    expect(state.lastContactAt).toBeNull();
  });

  it("advances an ignorable extension but rejects required and target drift", () => {
    const extension = decodeExecutionEvent(
      fixtureEvent({ ...fixtures.ignorable_extension, seq: 22 })
    );
    expect(extension).toMatchObject({ ok: true, value: { known: false } });

    expect(
      decodeExecutionEvent(
        fixtureEvent({ kind: "extension.required", ignorable: false })
      )
    ).toMatchObject({ ok: false, reason: "unknown_required_kind" });
    expect(
      decodeExecutionEvent(
        fixtureEvent({ target: { kind: "direct_url", id: "unsafe" } })
      )
    ).toMatchObject({ ok: false, reason: "unknown_target_kind" });
  });

  it("extracts only the versioned phyto.run_event custom value", () => {
    const event = fixtureEvent({ kind: "run.accepted", status: "queued" });
    expect(
      executionEventFromAGUI({
        type: "Custom",
        data: { name: "phyto.run_event", value: { event } },
      })
    ).toMatchObject({ ok: true, value: { kind: "run.accepted" } });
    expect(
      executionEventFromAGUI({
        type: "Custom",
        data: { name: "phyto.progress", value: { event } },
      })
    ).toBeNull();
  });

  it("validates page identity, ordering and cursor", () => {
    const event = fixtureEvent({ seq: 2 });
    expect(
      decodeExecutionEventPage({
        schema_version: 1,
        run_id: "run-fixture",
        items: [event],
        next_after_seq: 2,
        has_more: false,
      }).ok
    ).toBe(true);
    expect(
      decodeExecutionEventPage({
        schema_version: 1,
        run_id: "run-fixture",
        items: [event, event],
        next_after_seq: 2,
        has_more: false,
      })
    ).toMatchObject({ ok: false, reason: "invalid_page" });
  });

  it("accepts finite target metadata and rejects direct URL fields", () => {
    const safe = {
      schema_version: 1,
      kind: "artifact",
      id: "artifact-1",
      event_id: "evt-1",
      name: "result.csv",
      media_type: "text/csv",
      size_bytes: 12,
      preview_available: false,
      todos: [],
    };
    expect(decodeExecutionTargetResolution(safe).ok).toBe(true);
    expect(
      decodeExecutionTargetResolution({
        ...safe,
        direct_url: "https://example.invalid/private",
      })
    ).toMatchObject({ ok: false, reason: "invalid_target_resolution" });
  });

  it("accepts only the authenticated same-origin V2 target delivery route", () => {
    const safe = {
      schema_version: 2,
      execution_id: "turn-target-delivery",
      target: { kind: "artifact", id: "artifact-1" },
      resolution: "verified",
      name: "network-report.pdf",
      media_type: "application/pdf",
      size_bytes: 2048,
      preview_available: true,
      delivery_url:
        "/api/v1/executions/turn-target-delivery/targets/artifact/artifact-1/content",
    };
    expect(decodeExecutionTargetResolution(safe)).toMatchObject({
      ok: true,
      value: {
        deliveryUrl: safe.delivery_url,
        previewAvailable: true,
        name: "network-report.pdf",
        mediaType: "application/pdf",
        sizeBytes: 2048,
      },
    });
    for (const deliveryUrl of [
      "https://example.invalid/private",
      "//example.invalid/private",
      "/api/v1/executions/turn-target-delivery/targets/artifact/../secret/content",
      "/api/v1/executions/turn-target-delivery/targets/artifact/artifact-1/content\nX-Test: unsafe",
    ]) {
      expect(
        decodeExecutionTargetResolution({ ...safe, delivery_url: deliveryUrl })
      ).toMatchObject({ ok: false, reason: "invalid_target_resolution" });
    }
  });
});

describe("execution run reducer", () => {
  it("keeps the execution running when a child span succeeds", () => {
    const event = (
      seq: number,
      type: "execution.started" | "span.succeeded",
      status: "running" | "succeeded",
      spanId: string
    ) =>
      decodeExecutionEvent({
        schema_version: 2,
        event_id: `event-${seq}`,
        execution_id: "turn-child-span",
        seq,
        type,
        status,
        occurred_at: `2026-08-22T02:20:0${seq}Z`,
        source: type === "execution.started" ? "runtime" : "graph",
        span_id: spanId,
        parent_span_id: type === "execution.started" ? null : "span-root",
        work_unit_id: null,
        attempt: 1,
        summary: { key: type, text: type },
        public_payload: {},
        target: null,
        idempotency_key: null,
      });

    const started = event(1, "execution.started", "running", "span-root");
    const childSucceeded = event(
      2,
      "span.succeeded",
      "succeeded",
      "span-child"
    );
    expect(started.ok).toBe(true);
    expect(childSucceeded.ok).toBe(true);

    let state = createExecutionRunState("turn-child-span", 2);
    if (started.ok) state = applyExecutionEvent(state, started.value);
    if (childSucceeded.ok)
      state = applyExecutionEvent(state, childSucceeded.value);

    expect(state.status).toBe("running");
    expect(state.terminal).toBeNull();
    expect(state.spans["span-child"]?.status).toBe("succeeded");
  });

  it("reconstructs contiguous durable message chunks instead of replacing content with the last suffix", () => {
    const firstText = "a".repeat(8192);
    const lastText = "最终答案";
    const totalLength = [...(firstText + lastText)].length;
    const base = {
      schema_version: 2,
      execution_id: "turn-message",
      status: "running",
      occurred_at: "2026-08-21T00:00:00Z",
      source: "message",
      span_id: "root",
      parent_span_id: null,
      work_unit_id: null,
      attempt: 1,
      summary: { key: "message.snapshot", text: "Answer update" },
      target: null,
      idempotency_key: null,
    };
    const first = decodeExecutionEvent({
      ...base,
      event_id: "event-message-1",
      seq: 1,
      type: "message.snapshot",
      public_payload: {
        output_revision: 1,
        message_id: "msg-assistant",
        source_message_id: "msg-assistant",
        base_offset: 0,
        offset: 8192,
        total_length: totalLength,
        chunk_index: 0,
        chunk_count: 2,
        content_sha256: "a".repeat(64),
        text: firstText,
      },
    });
    const canonicalCitation = {
      runs: [{ text: "Drought epigenetics", italic: true }],
      links: [
        {
          label: "Article",
          href: "https://doi.org/10.1000/safe-doi",
        },
      ],
    };
    const secondRaw = {
      ...base,
      event_id: "event-message-2",
      seq: 2,
      type: "message.completed",
      status: "succeeded",
      summary: { key: "message.completed", text: "Answer completed" },
      public_payload: {
        output_revision: 1,
        message_id: "msg-assistant",
        source_message_id: "msg-assistant",
        base_offset: 8192,
        offset: totalLength,
        total_length: totalLength,
        chunk_index: 1,
        chunk_count: 2,
        content_sha256: "a".repeat(64),
        text: lastText,
        references: [
          {
            title: "Drought epigenetics",
            di: "10.1000/safe-doi",
            formatted_citation: "Drought epigenetics.",
            doi_missing: false,
            citation: canonicalCitation,
          },
        ],
      },
    };
    const second = decodeExecutionEvent(secondRaw);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second).toMatchObject({
      ok: true,
      value: {
        payload: { references: [{ citation: canonicalCitation }] },
      },
    });
    expect(
      decodeExecutionEvent({
        ...secondRaw,
        event_id: "event-message-malformed",
        public_payload: {
          ...secondRaw.public_payload,
          references: [
            {
              title: "Drought epigenetics",
              citation: { ...canonicalCitation, private_provider_field: true },
            },
          ],
        },
      })
    ).toMatchObject({ ok: false, reason: "invalid_public_payload" });
    let state = createExecutionRunState("turn-message", 2);
    if (first.ok) state = applyExecutionEvent(state, first.value);
    if (second.ok) state = applyExecutionEvent(state, second.value);
    expect(state.outputText).toBe(firstText + lastText);
    expect(state.outputOffset).toBe(totalLength);
    expect(state.outputCompleted).toBe(true);
  });

  it("deduplicates sequences, replaces Todo atomically and orders results", () => {
    let state = createExecutionRunState("run-fixture");
    const todo1 = fixtureEvent({
      seq: 1,
      kind: "todo.snapshot",
      payload: { items: [{ id: "a", label_key: "todo.a", status: "pending" }] },
      target: { kind: "todo", id: "todo-1" },
    });
    const todo2 = fixtureEvent({
      seq: 2,
      kind: "todo.snapshot",
      payload: {
        items: [{ id: "b", label_key: "todo.b", status: "completed" }],
      },
      target: { kind: "todo", id: "todo-2" },
    });
    const artifact = fixtureEvent({
      seq: 3,
      event_id: "evt-artifact",
      kind: "artifact.published",
      status: "succeeded",
      payload: { name: "result.csv", media_type: "text/csv", size_bytes: 12 },
      target: { kind: "artifact", id: "artifact-1" },
    });

    for (const raw of [todo1, todo2, artifact, artifact]) {
      const decoded = decodeExecutionEvent(raw);
      if (decoded.ok) state = applyExecutionEvent(state, decoded.value);
    }

    expect(state.latestSeq).toBe(3);
    expect(state.events).toHaveLength(3);
    expect(state.todos.map((item) => item.id)).toEqual(["b"]);
    expect(state.results.map((item) => item.eventId)).toEqual(["evt-artifact"]);
  });

  it("discovers a trace target without projecting it as a result file", () => {
    const raw = fixtureEvent({
      seq: 1,
      event_id: "evt-trace-target",
      kind: "artifact.published",
      status: "succeeded",
      payload: {
        name: "provider-trace.json",
        media_type: "application/json",
        size_bytes: 42,
      },
      target: { kind: "trace", id: "trc_A1b2C3d4E5f6G7h8" },
    });
    const decoded = decodeExecutionEvent(raw);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;

    const state = applyExecutionEvent(
      createExecutionRunState("run-fixture"),
      decoded.value
    );
    expect(state.results).toEqual([]);
    expect(state.targets).toEqual([
      { kind: "trace", id: "trc_A1b2C3d4E5f6G7h8" },
    ]);
  });

  it("groups retry and failure attempts by work-unit identity", () => {
    const rawEvent = (
      seq: number,
      type: string,
      status: string,
      publicPayload: Record<string, unknown>,
      attempt = 1
    ) =>
      decodeExecutionEvent({
        schema_version: 2,
        event_id: `event-operation-${seq}`,
        execution_id: "turn-operation",
        seq,
        type,
        status,
        occurred_at: `2026-08-22T09:00:0${seq}Z`,
        source: "provider",
        span_id: `span-${attempt}`,
        parent_span_id: "span-root",
        work_unit_id: "work-analysis",
        attempt,
        summary: { key: type, text: type },
        public_payload: publicPayload,
        target: null,
        idempotency_key: `operation-${seq}`,
      });
    const decoded = [
      rawEvent(1, "work_unit.attempt_started", "running", {
        operation_key: "remote.analysis",
        detail: { provider_state: "running" },
      }),
      rawEvent(2, "work_unit.retry_scheduled", "retry_scheduled", {
        operation_key: "remote.analysis",
        code: "UPSTREAM_BUSY",
        retryable: true,
        delay_ms: 1000,
      }),
      rawEvent(
        3,
        "work_unit.attempt_started",
        "running",
        { operation_key: "remote.analysis" },
        2
      ),
      rawEvent(
        4,
        "work_unit.failed",
        "failed",
        {
          operation_key: "remote.analysis",
          code: "UPSTREAM_FAILED",
          retryable: false,
        },
        2
      ),
    ];
    expect(decoded.every((item) => item.ok)).toBe(true);
    let state = createExecutionRunState("turn-operation", 2);
    for (const item of decoded) {
      if (item.ok) state = applyExecutionEvent(state, item.value);
    }

    expect(state.operations).toHaveLength(1);
    expect(state.operations[0]).toMatchObject({
      operationKey: "remote.analysis",
      status: "failed",
      currentAttempt: 2,
      attempts: [
        {
          attempt: 1,
          status: "retry_scheduled",
          failure: { code: "UPSTREAM_BUSY", retryable: true },
          retry: { delayMs: 1000 },
        },
        {
          attempt: 2,
          status: "failed",
          failure: { code: "UPSTREAM_FAILED", retryable: false },
        },
      ],
    });
    expect(state.executionStage).toMatchObject({
      stage: "scientific_execution",
      rootStatus: "running",
      todos: [
        { id: "planning", status: "completed" },
        { id: "analysis", status: "in_progress" },
        { id: "consolidation", status: "pending" },
        { id: "response", status: "pending" },
      ],
    });
  });

  it("uses a payload-free fallback for an unknown operation presenter", () => {
    const decoded = decodeExecutionEvent({
      schema_version: 2,
      event_id: "event-unknown-operation",
      execution_id: "turn-unknown-operation",
      seq: 1,
      type: "work_unit.attempt_started",
      status: "running",
      occurred_at: "2026-08-22T09:10:00Z",
      source: "tool",
      span_id: "span-unknown",
      parent_span_id: "span-root",
      work_unit_id: "work-unknown",
      attempt: 1,
      summary: { key: "unknown.started", text: "Internal operation started" },
      public_payload: {
        operation_key: "future.private.operation",
        detail: { result_count: 99 },
      },
      target: null,
      idempotency_key: "unknown-operation-1",
    });
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) throw new Error(decoded.reason);
    const state = applyExecutionEvent(
      createExecutionRunState("turn-unknown-operation", 2),
      decoded.value
    );
    expect(state.operations[0]).toMatchObject({
      operationKey: "operation.unknown",
      labelKey: "execution.operation.generic",
      fallbackLabel: "Internal operation",
      detail: {},
      progress: null,
      target: null,
    });
  });

  it("recognizes every finite operation presenter in the shared runtime contract", () => {
    for (const [
      index,
      presenter,
    ] of runtimeFixtures.capabilities.operation_records.presenters.entries()) {
      const decoded = decodeExecutionEvent({
        schema_version: 2,
        event_id: `event-presenter-${index}`,
        execution_id: `turn-presenter-${index}`,
        seq: 1,
        type: "work_unit.attempt_started",
        status: "running",
        occurred_at: "2026-08-22T09:10:00Z",
        source: "tool",
        span_id: `span-presenter-${index}`,
        parent_span_id: "span-root",
        work_unit_id: `work-presenter-${index}`,
        attempt: 1,
        summary: { key: "operation.started", text: "Operation started" },
        public_payload: {
          operation_key: presenter.operation_key,
          detail: {},
        },
        target: null,
        idempotency_key: `presenter-${index}`,
      });
      expect(decoded.ok, presenter.operation_key).toBe(true);
      if (!decoded.ok) continue;
      const state = applyExecutionEvent(
        createExecutionRunState(`turn-presenter-${index}`, 2),
        decoded.value
      );
      expect(state.operations[0]?.operationKey).toBe(presenter.operation_key);
    }
  });

  it("ignores unknown operation record versions without discarding a projection", () => {
    const projection = decodeExecutionProjection({
      schema_version: 2,
      execution_id: "turn-future-operation",
      status: "running",
      latest_seq: 1,
      output_revision: 0,
      output_offset: 0,
      operation_revision: 0,
      operations: [{ schema_version: 9, future: true }],
      execution_stage: null,
      tracking_health: "healthy",
      active_span_ids: [],
      todo_declared: false,
      todos: [],
      results: [],
      targets: [],
      input_required: null,
      context_stage: null,
      terminal: null,
    });
    expect(projection).toMatchObject({
      ok: true,
      value: { operations: [] },
    });
  });

  it("rejects a projection whose pending and Todo surface contradicts its stage", () => {
    const projection = decodeExecutionProjection({
      schema_version: 2,
      execution_id: "turn-invalid-stage",
      status: "running",
      latest_seq: 1,
      output_revision: 0,
      output_offset: 0,
      operation_revision: 0,
      operations: [],
      execution_stage: {
        stage: "consolidation",
        child_status: null,
        root_status: "running",
        answer_available: false,
        todos: [
          { id: "planning", status: "completed" },
          { id: "analysis", status: "in_progress" },
          { id: "consolidation", status: "pending" },
          { id: "response", status: "pending" },
        ],
        pending_status_key: "execution.pending.running",
        clocks: {
          last_execution_fact_at: "2026-08-22T09:20:00Z",
          last_provider_contact_at: null,
          last_stream_contact_at: null,
        },
      },
      tracking_health: "healthy",
      active_span_ids: [],
      todo_declared: false,
      todos: [],
      results: [],
      targets: [],
      input_required: null,
      context_stage: null,
      terminal: null,
    });
    expect(projection).toMatchObject({
      ok: false,
      reason: "invalid_projection",
    });
  });

  it("detects a sequence gap without discarding verified content", () => {
    let state = createExecutionRunState("run-fixture");
    const first = decodeExecutionEvent(fixtureEvent({ seq: 1 }));
    const third = decodeExecutionEvent(fixtureEvent({ seq: 3 }));
    if (first.ok) state = applyExecutionEvent(state, first.value);
    if (third.ok) state = applyExecutionEvent(state, third.value);
    expect(state.events).toHaveLength(1);
    expect(state.latestSeq).toBe(1);
    expect(state.delivery).toBe("gap");
  });

  it("focuses an existing typed target tab instead of duplicating it", () => {
    const target = { kind: "artifact" as const, id: "artifact-1" };
    const first = openExecutionTarget([], target, "Result");
    const second = openExecutionTarget(first.tabs, target, "Result again");
    expect(second.tabs).toHaveLength(1);
    expect(second.activeKey).toBe("artifact:artifact-1");
    expect(second.tabs[0].title).toBe("Result");
  });

  it("uses a stable trace tab identity and rejects malformed trace ids", () => {
    const target = { kind: "trace" as const, id: "trc_A1b2C3d4E5f6G7h8" };
    const first = openExecutionTarget([], target, "Run analysis");
    const second = openExecutionTarget(
      first.tabs,
      target,
      "Run analysis again"
    );
    expect(second.tabs).toHaveLength(1);
    expect(second.activeKey).toBe("trace:trc_A1b2C3d4E5f6G7h8");
    expect(
      decodeExecutionTargetResolution({
        schema_version: 2,
        execution_id: "turn-1",
        target: { kind: "trace", id: "trc_short" },
        resolution: "authorized",
        preview_available: false,
      })
    ).toMatchObject({ ok: false, reason: "invalid_target_resolution" });
  });

  it("strictly decodes a chronological bounded work trace", () => {
    const decoded = decodeExecutionTraceResolution({
      schema_version: 1,
      target: { kind: "trace", id: "trc_A1b2C3d4E5f6G7h8" },
      health: "healthy",
      operation: {
        operation_id: "op-analysis",
        operation_key: "remote.analysis",
        label_key: "execution.operation.remote.analysis",
        fallback_label: "Run analysis",
        status: "running",
        started_at: "2026-08-23T08:00:00Z",
        last_observation_at: "2026-08-23T08:00:02Z",
        completed_at: null,
        duration_ms: 2000,
        current_attempt: 1,
        attempts: [],
        progress: null,
        detail: { provider_state: "running" },
        summary: null,
        target: { kind: "trace", id: "trc_A1b2C3d4E5f6G7h8" },
      },
      last_semantic_activity_at: "2026-08-23T08:00:02Z",
      last_provider_contact_at: "2026-08-23T08:00:03Z",
      items: [
        {
          schema_version: 1,
          item_id: "item-1",
          seq: 7,
          kind: "tool",
          operation_key: "gene_network.infer_network",
          label_key: "execution.trace.geneNetwork.inferNetwork",
          fallback_label: "Infer regulatory network",
          status: "running",
          attempt: 1,
          occurred_at: "2026-08-23T08:00:02Z",
          duration_ms: 1200,
          progress: { completed: 3, total: 8, unit: "genes" },
          attempts: [],
          detail: { gene_count: 8 },
          summary: null,
          target: null,
        },
      ],
      next_after_seq: 7,
      has_more: false,
    });
    expect(decoded).toMatchObject({
      ok: true,
      value: {
        health: "healthy",
        nextAfterSeq: 7,
        items: [{ kind: "tool", progress: { completed: 3, total: 8 } }],
      },
    });
    if (decoded.ok) {
      const reordered = {
        ...decoded.value,
        items: [decoded.value.items[0], decoded.value.items[0]],
      };
      expect(reordered.items[1].seq).toBe(reordered.items[0].seq);
    }
  });

  it("merges live trace pages, deduplicates replay and converges degraded terminal state", () => {
    const base = {
      schema_version: 1,
      target: { kind: "trace", id: "trc_A1b2C3d4E5f6G7h8" },
      health: "healthy",
      operation: {
        operation_id: "op-analysis",
        operation_key: "remote.analysis",
        label_key: "execution.operation.remote.analysis",
        fallback_label: "Run analysis",
        status: "running",
        started_at: "2026-08-23T08:00:00Z",
        last_observation_at: "2026-08-23T08:00:02Z",
        completed_at: null,
        duration_ms: 2000,
        current_attempt: 1,
        attempts: [],
        progress: null,
        detail: { provider_state: "running" },
        summary: null,
        target: { kind: "trace", id: "trc_A1b2C3d4E5f6G7h8" },
      },
      last_semantic_activity_at: "2026-08-23T08:00:02Z",
      last_provider_contact_at: "2026-08-23T08:00:03Z",
      items: [
        {
          schema_version: 1,
          item_id: "item-1",
          seq: 7,
          kind: "phase",
          operation_key: "gene_network.prepare_inputs",
          label_key: "execution.trace.geneNetwork.prepareInputs",
          fallback_label: "Prepare analysis inputs",
          status: "running",
          attempt: 1,
          occurred_at: "2026-08-23T08:00:02Z",
          duration_ms: null,
          progress: null,
          attempts: [],
          detail: {},
          summary: null,
          target: null,
        },
      ],
      next_after_seq: 7,
      has_more: true,
    };
    const initial = decodeExecutionTraceResolution(base);
    const terminal = decodeExecutionTraceResolution({
      ...base,
      health: "degraded",
      operation: {
        ...base.operation,
        status: "succeeded",
        last_observation_at: "2026-08-23T08:00:05Z",
        completed_at: "2026-08-23T08:00:05Z",
        duration_ms: 5000,
        detail: { provider_state: "terminal" },
      },
      last_semantic_activity_at: "2026-08-23T08:00:05Z",
      last_provider_contact_at: "2026-08-23T08:00:05Z",
      items: [
        {
          ...base.items[0],
          item_id: "item-2",
          seq: 8,
          status: "succeeded",
          occurred_at: "2026-08-23T08:00:05Z",
          summary: "Prepare analysis inputs completed",
        },
      ],
      next_after_seq: 8,
      has_more: false,
    });
    if (!initial.ok || !terminal.ok) throw new Error("trace fixture invalid");
    const merged = mergeExecutionTracePage(initial.value, terminal.value);
    expect(merged).toMatchObject({
      ok: true,
      value: {
        health: "degraded",
        operation: { status: "succeeded" },
        items: [{ seq: 7 }, { seq: 8 }],
        hasMore: false,
      },
    });
    if (!merged.ok) return;
    const replayed = mergeExecutionTracePage(merged.value, terminal.value);
    expect(replayed.ok && replayed.value.items).toHaveLength(2);
    const reload = decodeExecutionTraceResolution(
      JSON.parse(JSON.stringify(base))
    );
    expect(reload).toEqual(initial);
  });

  it.each(["raw_log", "provider_body", "prompt", "exception_text"])(
    "rejects adversarial trace detail field %s",
    (field) => {
      const raw = {
        schema_version: 1,
        target: { kind: "trace", id: "trc_A1b2C3d4E5f6G7h8" },
        health: "healthy",
        operation: {
          operation_id: "op-analysis",
          operation_key: "remote.analysis",
          label_key: "execution.operation.remote.analysis",
          fallback_label: "Run analysis",
          status: "running",
          started_at: "2026-08-23T08:00:00Z",
          last_observation_at: "2026-08-23T08:00:02Z",
          completed_at: null,
          duration_ms: 2000,
          current_attempt: 1,
          attempts: [],
          progress: null,
          detail: { [field]: "private value" },
          summary: null,
          target: { kind: "trace", id: "trc_A1b2C3d4E5f6G7h8" },
        },
        last_semantic_activity_at: null,
        last_provider_contact_at: null,
        items: [],
        next_after_seq: 0,
        has_more: false,
      };
      expect(decodeExecutionTraceResolution(raw)).toMatchObject({ ok: false });
    }
  );
});
