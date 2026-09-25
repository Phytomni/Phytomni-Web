import { describe, expect, it, vi } from "vitest";

import { useChatStates } from "@/views/chat/composables/useChatStates";
import {
  parseExecutionSSEFrame,
  useExecutionEvents,
} from "@/views/chat/composables/useExecutionEvents";
import {
  decodeExecutionEvent,
  type ExecutionEvent,
} from "@/views/chat/streaming/executionEvents";

function event(
  seq: number,
  kind = "run.started",
  status = "running"
): ExecutionEvent {
  const decoded = decodeExecutionEvent({
    schema_version: 1,
    event_id: `evt-${seq}`,
    run_id: "run-1",
    seq,
    occurred_at: `2026-08-18T00:00:0${Math.min(seq, 9)}Z`,
    kind,
    status,
    summary: { key: `activity.${kind}`, text: kind },
    payload: {},
    ignorable: false,
  });
  if (!decoded.ok) throw new Error(decoded.reason);
  return decoded.value;
}

function eventPage(items: ExecutionEvent[], hasMore = false) {
  return {
    code: 200,
    data: {
      schemaVersion: 1 as const,
      runId: "run-1",
      items,
      nextAfterSeq: items.at(-1)?.seq ?? 0,
      hasMore,
    },
  };
}

function streamResponse(frames: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(`${frames.join("\n\n")}\n\n`)
      );
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream; charset=utf-8" },
  });
}

describe("execution history and resume", () => {
  it("does not address durable execution endpoints with a temporary dialogue id", async () => {
    const states = useChatStates();
    const getEvents = vi.fn();
    const execution = useExecutionEvents({
      getChatState: states.getChatState,
      client: {
        getEvents,
        getProjection: vi.fn(),
      },
    });

    await expect(
      execution.hydrateRun("new_1787048730808", "run-1")
    ).rejects.toThrow("persisted dialogue");

    expect(getEvents).not.toHaveBeenCalled();
    expect(states.getChatState("new_1787048730808").executionRuns).toEqual({});
  });

  it("parses event, gap, heartbeat and malformed finite frames", () => {
    const raw = {
      schema_version: 1,
      event_id: "evt-1",
      run_id: "run-1",
      seq: 1,
      occurred_at: "2026-08-18T00:00:01Z",
      kind: "run.started",
      status: "succeeded",
      summary: { key: "activity.run.started", text: "Started" },
      payload: {},
      ignorable: false,
    };
    expect(
      parseExecutionSSEFrame(
        `id: 1\nevent: execution_event\ndata: ${JSON.stringify(raw)}`
      )
    ).toMatchObject({ type: "event", event: { seq: 1 } });
    expect(
      parseExecutionSSEFrame("event: execution_gap\ndata: {}")
    ).toMatchObject({ type: "gap" });
    expect(parseExecutionSSEFrame(": heartbeat")).toEqual({
      type: "heartbeat",
    });
    expect(parseExecutionSSEFrame("event: future\ndata: {}")).toMatchObject({
      type: "invalid",
    });
  });

  it("hydrates pages into the owning dialogue without cross-dialogue state", async () => {
    const states = useChatStates();
    const getEvents = vi
      .fn()
      .mockResolvedValueOnce(eventPage([event(1)], true))
      .mockResolvedValueOnce(
        eventPage([event(2, "run.succeeded", "succeeded")])
      );
    const execution = useExecutionEvents({
      getChatState: states.getChatState,
      client: {
        getEvents,
        getProjection: vi.fn(),
      },
    });

    const run = await execution.hydrateRun("dialogue-a", "run-1");
    expect(run.latestSeq).toBe(2);
    expect(run.terminal?.status).toBe("succeeded");
    expect(states.getChatState("dialogue-b").executionRuns).toEqual({});
    expect(getEvents.mock.calls[1][0].afterSeq).toBe(1);
  });

  it("keeps verified content and marks it stale when refresh fails", async () => {
    const states = useChatStates();
    const client = {
      getEvents: vi
        .fn()
        .mockResolvedValueOnce(eventPage([event(1)]))
        .mockRejectedValueOnce(new Error("offline")),
      getProjection: vi.fn(),
    };
    const execution = useExecutionEvents({
      getChatState: states.getChatState,
      client,
    });
    await execution.hydrateRun("dialogue-a", "run-1");
    await expect(execution.hydrateRun("dialogue-a", "run-1")).rejects.toThrow();
    const run = states.getChatState("dialogue-a").executionRuns["run-1"];
    expect(run.events).toHaveLength(1);
    expect(run.delivery).toBe("stale");
  });

  it("keeps the client execution id stable while recording the native run as metadata", async () => {
    const states = useChatStates();
    const started = event(1);
    const finished = event(2, "run.succeeded", "succeeded");
    const openExecutionStream = vi.fn().mockResolvedValue(
      streamResponse([
        ": heartbeat",
        ...[started, finished].map(
          (item) =>
            `id: ${item.seq}\nevent: execution_event\ndata: ${JSON.stringify({
              schema_version: 1,
              event_id: item.eventId,
              run_id: item.runId,
              seq: item.seq,
              occurred_at: item.occurredAt,
              kind: item.kind,
              status: item.status,
              summary: item.summary,
              payload: item.payload,
              ignorable: item.ignorable,
            })}`
        ),
      ])
    );
    const execution = useExecutionEvents({
      getChatState: states.getChatState,
      client: {
        getEvents: vi.fn(),
        getProjection: vi.fn(),
        openExecutionStream,
      },
    });

    await execution.attachExecution("new_1787048730808", "turn-public-1");

    expect(openExecutionStream).toHaveBeenCalledWith(
      expect.objectContaining({ executionId: "turn-public-1", afterSeq: 0 })
    );
    expect(
      states.getChatState("new_1787048730808").executionRuns["turn-public-1"]
        .terminal?.status
    ).toBe("succeeded");
    expect(
      states.getChatState("new_1787048730808").executionRuns["turn-public-1"]
        .botRunId
    ).toBe("run-1");
    expect(
      states.getChatState("new_1787048730808").executionRuns["turn-public-1"]
        .lastContactAt
    ).not.toBeNull();
    expect(
      states.getChatState("new_1787048730808").selectedExecutionRunId
    ).toBe("turn-public-1");
  });

  it("starts the elapsed clock when the execution subscription is created", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-22T05:54:59Z"));
    const states = useChatStates();
    let release!: (response: Response) => void;
    const openExecutionStream = vi.fn().mockReturnValue(
      new Promise<Response>((resolve) => {
        release = resolve;
      })
    );
    const execution = useExecutionEvents({
      getChatState: states.getChatState,
      client: {
        getEvents: vi.fn(),
        getProjection: vi.fn(),
        openExecutionStream,
      },
      maxReconnectAttempts: 0,
    });

    const attached = execution.attachExecution("new_clock", "turn-clock");
    await Promise.resolve();
    const startedAt =
      states.getChatState("new_clock").executionRuns["turn-clock"].startedAt;
    release(
      streamResponse([
        `event: execution_snapshot\ndata: ${JSON.stringify({
          schema_version: 2,
          execution_id: "turn-clock",
          agent_slug: "expert-router",
          status: "succeeded",
          latest_seq: 0,
          output_revision: 0,
          output_offset: 0,
          operation_revision: 0,
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
          terminal: { status: "succeeded", event_id: "evt-clock" },
        })}`,
      ])
    );
    await attached;
    vi.useRealTimers();

    expect(startedAt).toBe("2026-08-22T05:54:59.000Z");
  });

  it("projects the selected agent identity into the live assistant message", async () => {
    const states = useChatStates();
    const dialogueId = "dialogue-network-identity";
    const executionId = "turn-network-identity";
    states.getChatState(dialogueId).renderedChat = {
      messages: [
        {
          role: "assistant",
          id: "msg-network-assistant",
          executionId,
          content: "",
          status: "admitted",
        },
      ],
    };
    const openExecutionStream = vi.fn().mockResolvedValue(
      streamResponse([
        `event: execution_snapshot\ndata: ${JSON.stringify({
          schema_version: 2,
          execution_id: executionId,
          agent_slug: "network",
          status: "running",
          latest_seq: 0,
          output_revision: 0,
          output_offset: 0,
          operation_revision: 0,
          tracking_health: "healthy",
          active_span_ids: [],
          todo_declared: false,
          todos: [],
          results: [],
          targets: [],
          failed_work_unit_ids: [],
          warnings: [],
          input_required: null,
          context_stage: {
            schema_version: 1,
            turn_id: executionId,
            selected_agent_id: "GeneNetworkAgent",
            route_source: "router",
            route_reason_code: "DOMAIN_RESOLVER_SELECTED",
            base_business_context_version: 0,
            proposed_business_context_version: 1,
            last_applied_ledger_cursor: 0,
            context_truncated: false,
            context_rebuilt: false,
          },
          terminal: null,
        })}`,
      ])
    );
    const execution = useExecutionEvents({
      getChatState: states.getChatState,
      client: {
        getEvents: vi.fn(),
        getProjection: vi.fn(),
        openExecutionStream,
      },
      maxReconnectAttempts: 0,
    });

    await execution.attachExecution(dialogueId, executionId);

    expect(
      states.getChatState(dialogueId).renderedChat?.messages[0]
    ).toMatchObject({
      tool_name: "GeneNetworkAgent",
      route_reason_code: "DOMAIN_RESOLVER_SELECTED",
      executionRun: {
        agentSlug: "network",
        selectedAgentId: "GeneNetworkAgent",
        routeReasonCode: "DOMAIN_RESOLVER_SELECTED",
      },
    });
  });

  it("moves one execution subscription when a temporary dialogue is re-keyed", async () => {
    const states = useChatStates();
    let release!: (response: Response) => void;
    const pendingResponse = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const openExecutionStream = vi.fn().mockReturnValue(pendingResponse);
    const execution = useExecutionEvents({
      getChatState: states.getChatState,
      client: {
        getEvents: vi.fn(),
        getProjection: vi.fn(),
        openExecutionStream,
      },
      maxReconnectAttempts: 0,
    });

    const attached = execution.attachExecution("new_1", "turn-stable");
    await Promise.resolve();
    await execution.attachExecution("dialogue-durable", "turn-stable");
    expect(openExecutionStream).toHaveBeenCalledTimes(1);

    release(
      streamResponse([
        `event: execution_snapshot\ndata: ${JSON.stringify({
          schema_version: 2,
          execution_id: "turn-stable",
          agent_slug: "design",
          status: "succeeded",
          latest_seq: 0,
          output_revision: 0,
          output_offset: 0,
          operation_revision: 1,
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
          terminal: { status: "succeeded", event_id: "evt-terminal" },
        })}`,
      ])
    );
    await attached;

    expect(
      states.getChatState("dialogue-durable").executionRuns["turn-stable"]
        .terminal?.status
    ).toBe("succeeded");
    expect(
      states.getChatState("new_1").executionRuns["turn-stable"].terminal
    ).toBeNull();
  });

  it("transfers one live subscription across composable remounts", async () => {
    const firstStates = useChatStates();
    const secondStates = useChatStates();
    let release!: (response: Response) => void;
    const pendingResponse = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const openExecutionStream = vi.fn().mockReturnValue(pendingResponse);
    const client = {
      getEvents: vi.fn(),
      getProjection: vi.fn(),
      openExecutionStream,
    };
    const first = useExecutionEvents({
      getChatState: firstStates.getChatState,
      client,
      maxReconnectAttempts: 0,
    });
    const second = useExecutionEvents({
      getChatState: secondStates.getChatState,
      client,
      maxReconnectAttempts: 0,
    });

    const attached = first.attachExecution("dialogue-before", "turn-remount");
    await Promise.resolve();
    await second.attachExecution("dialogue-after", "turn-remount");
    first.dispose();

    expect(openExecutionStream).toHaveBeenCalledTimes(1);
    release(
      streamResponse([
        `event: execution_snapshot\ndata: ${JSON.stringify({
          schema_version: 2,
          execution_id: "turn-remount",
          agent_slug: "review",
          status: "succeeded",
          latest_seq: 0,
          output_revision: 0,
          output_offset: 0,
          operation_revision: 1,
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
          terminal: { status: "succeeded", event_id: "evt-terminal" },
        })}`,
      ])
    );
    await attached;

    expect(
      secondStates.getChatState("dialogue-after").executionRuns["turn-remount"]
        .terminal?.status
    ).toBe("succeeded");
    expect(
      firstStates.getChatState("dialogue-before").executionRuns["turn-remount"]
        .terminal
    ).toBeNull();
    second.dispose();
  });

  it("does not reconnect after a cached dispatch failure is terminal", async () => {
    const states = useChatStates();
    const executionId = "turn-dispatch-failed";
    const openExecutionStream = vi.fn().mockResolvedValue(
      streamResponse([
        `event: execution_snapshot\ndata: ${JSON.stringify({
          schema_version: 2,
          execution_id: executionId,
          agent_slug: "",
          status: "failed",
          latest_seq: 0,
          output_revision: 0,
          output_offset: 0,
          operation_revision: 12,
          tracking_health: "degraded",
          active_span_ids: [],
          todo_declared: false,
          todos: [],
          results: [],
          targets: [],
          failed_work_unit_ids: [],
          warnings: [],
          input_required: null,
          context_stage: null,
          terminal: {
            status: "failed",
            event_id: "web-terminal",
            result_revision: 0,
          },
          stale: true,
          source: "web_cache",
        })}`,
      ])
    );
    const execution = useExecutionEvents({
      getChatState: states.getChatState,
      client: {
        getEvents: vi.fn(),
        getProjection: vi.fn(),
        openExecutionStream,
      },
      maxReconnectAttempts: 4,
      reconnectDelay: () => Promise.resolve(),
    });

    await execution.attachExecution("new_1", executionId);

    expect(openExecutionStream).toHaveBeenCalledTimes(1);
    const run = states.getChatState("new_1").executionRuns[executionId];
    expect(run.terminal?.status).toBe("failed");
    expect(run.trackingHealth).toBe("degraded");
  });

  it("does not reconnect when a legacy cached snapshot has terminal status without terminal metadata", async () => {
    const states = useChatStates();
    const executionId = "turn-legacy-dispatch-failed";
    const openExecutionStream = vi.fn().mockImplementation(() =>
      Promise.resolve(
        streamResponse([
          `event: execution_snapshot\ndata: ${JSON.stringify({
            schema_version: 2,
            execution_id: executionId,
            agent_slug: "",
            status: "failed",
            latest_seq: 0,
            output_revision: 0,
            output_offset: 0,
            operation_revision: 12,
            tracking_health: "pending",
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
            stale: true,
            source: "web_cache",
          })}`,
        ])
      )
    );
    const execution = useExecutionEvents({
      getChatState: states.getChatState,
      client: {
        getEvents: vi.fn(),
        getEvent: vi.fn(),
        getProjection: vi.fn(),
        openExecutionStream,
      },
      maxReconnectAttempts: 4,
      reconnectDelay: () => Promise.resolve(),
    });

    await execution.attachExecution("dialogue-legacy", executionId);

    expect(openExecutionStream).toHaveBeenCalledTimes(1);
    expect(
      states.getChatState("dialogue-legacy").executionRuns[executionId].status
    ).toBe("failed");
  });

  it("replays events that follow a projection snapshot with a newer high-water mark", async () => {
    const states = useChatStates();
    const executionId = "turn-public-2";
    const snapshot = {
      schema_version: 2,
      execution_id: executionId,
      agent_slug: "design",
      status: "running",
      latest_seq: 2,
      output_revision: 0,
      output_offset: 0,
      operation_revision: 0,
      tracking_health: "healthy",
      active_span_ids: ["span-root"],
      todo_declared: false,
      todos: [],
      results: [],
      targets: [],
      failed_work_unit_ids: [],
      warnings: [],
      input_required: null,
      context_stage: null,
      terminal: { status: "succeeded", event_id: "evt-v2-2" },
      stale: false,
      source: "bot",
    };
    const v2Event = (seq: number, type: string, status: string) => ({
      schema_version: 2,
      event_id: `evt-v2-${seq}`,
      execution_id: executionId,
      seq,
      occurred_at: `2026-08-20T15:06:0${seq}Z`,
      type,
      status,
      source: "runtime",
      span_id: "span-root",
      parent_span_id: null,
      work_unit_id: null,
      attempt: 1,
      summary: { key: `activity.${type}`, text: type },
      public_payload: {},
      target: null,
    });
    const openExecutionStream = vi
      .fn()
      .mockResolvedValue(
        streamResponse([
          `event: execution_snapshot\ndata: ${JSON.stringify(snapshot)}`,
          `id: 1\nevent: execution_event\ndata: ${JSON.stringify(v2Event(1, "execution.started", "running"))}`,
          `id: 2\nevent: execution_event\ndata: ${JSON.stringify(v2Event(2, "execution.succeeded", "succeeded"))}`,
        ])
      );
    const execution = useExecutionEvents({
      getChatState: states.getChatState,
      client: {
        getEvents: vi.fn(),
        getProjection: vi.fn(),
        openExecutionStream,
      },
      maxReconnectAttempts: 0,
    });

    await execution.attachExecution("new_2", executionId);

    const run = states.getChatState("new_2").executionRuns[executionId];
    expect(run.events.map((item) => item.seq)).toEqual([1, 2]);
    expect(run.terminal?.status).toBe("succeeded");
  });

  it("projects durable message chunks into the rendered assistant bubble", async () => {
    const states = useChatStates();
    const dialogueId = "dialogue-message";
    const executionId = "turn-message";
    const assistantMessageId = "msg-assistant";
    const tableContent =
      '{"headers":["transcript_id_1"],"rows":[["Os01t0177400-01"]]}';
    const splitOffset = 30;
    const chatState = states.getChatState(dialogueId);
    chatState.renderedChat = {
      messages: [
        {
          role: "assistant",
          id: assistantMessageId,
          executionId,
          content: "",
          contentRevision: 0,
          contentOffset: 0,
          contentLength: 0,
        },
      ],
    };
    const base = {
      schema_version: 2,
      execution_id: executionId,
      occurred_at: "2026-08-21T00:00:00Z",
      source: "message",
      span_id: "root",
      parent_span_id: null,
      work_unit_id: null,
      attempt: 1,
      target: null,
      idempotency_key: null,
    };
    const messageEvent = (
      seq: number,
      type: "message.snapshot" | "message.completed",
      text: string,
      baseOffset: number,
      offset: number
    ) => ({
      ...base,
      event_id: `event-message-${seq}`,
      seq,
      type,
      status: type === "message.completed" ? "succeeded" : "running",
      summary: { key: type, text: type },
      public_payload: {
        output_revision: 1,
        message_id: assistantMessageId,
        source_message_id: assistantMessageId,
        base_offset: baseOffset,
        offset,
        total_length: tableContent.length,
        chunk_index: seq - 1,
        chunk_count: 2,
        content_sha256: "a".repeat(64),
        text,
        ...(type === "message.completed"
          ? {
              references: [
                {
                  title: "Drought epigenetics",
                  di: "10.1000/safe-doi",
                  formatted_citation: "Drought epigenetics.",
                  doi_missing: false,
                  citation: {
                    runs: [{ text: "Drought epigenetics", italic: true }],
                    links: [
                      {
                        label: "Article",
                        href: "https://doi.org/10.1000/safe-doi",
                      },
                    ],
                  },
                },
              ],
            }
          : {}),
      },
    });
    const terminalEvent = {
      ...base,
      event_id: "event-message-3",
      seq: 3,
      type: "execution.succeeded",
      status: "succeeded",
      source: "runtime",
      summary: {
        key: "activity.execution.succeeded",
        text: "Execution succeeded",
      },
      public_payload: {},
    };
    const openExecutionStream = vi
      .fn()
      .mockResolvedValue(
        streamResponse([
          `id: 1\nevent: execution_event\ndata: ${JSON.stringify(
            messageEvent(
              1,
              "message.snapshot",
              tableContent.slice(0, splitOffset),
              0,
              splitOffset
            )
          )}`,
          `id: 2\nevent: execution_event\ndata: ${JSON.stringify(
            messageEvent(
              2,
              "message.completed",
              tableContent.slice(splitOffset),
              splitOffset,
              tableContent.length
            )
          )}`,
          `id: 3\nevent: execution_event\ndata: ${JSON.stringify(terminalEvent)}`,
        ])
      );
    const execution = useExecutionEvents({
      getChatState: states.getChatState,
      client: {
        getEvents: vi.fn(),
        getProjection: vi.fn(),
        openExecutionStream,
      },
      maxReconnectAttempts: 0,
    });

    await execution.attachExecution(dialogueId, executionId);

    expect(chatState.renderedChat.messages).toHaveLength(1);
    expect(chatState.renderedChat.messages[0]).toMatchObject({
      id: assistantMessageId,
      executionId,
      content: [{ transcript_id_1: "Os01t0177400-01" }],
      contentRevision: 1,
      contentOffset: tableContent.length,
      contentLength: tableContent.length,
      status: "succeeded",
      doc_list: [
        {
          title: "Drought epigenetics",
          di: "10.1000/safe-doi",
          citation: {
            runs: [{ text: "Drought epigenetics", italic: true }],
            links: [
              {
                label: "Article",
                href: "https://doi.org/10.1000/safe-doi",
              },
            ],
          },
        },
      ],
      tableHeaders: [{ prop: "transcript_id_1", label: "transcript_id_1" }],
      original: '{"headers":["transcript_id_1"],"rows":[["Os01t0177400-01"]]}',
    });
    expect(
      chatState.renderedChat.messages[0].executionRun?.terminal?.status
    ).toBe("succeeded");
  });

  it("projects a completed successful V2 scientific answer as a final report with allowlisted warnings", async () => {
    const states = useChatStates();
    const dialogueId = "dialogue-final-report";
    const executionId = "turn-final-report";
    const messageId = "msg-final-report";
    const report =
      "# Genomic analysis\n\nThe retained evidence supports a drought-response association [1].";
    const reportLength = [...report].length;
    const chatState = states.getChatState(dialogueId);
    chatState.renderedChat = {
      messages: [
        {
          role: "assistant",
          id: messageId,
          executionId,
          content: "",
          contentRevision: 0,
          contentOffset: 0,
          contentLength: 0,
        },
      ],
    };
    const snapshot = {
      schema_version: 2,
      execution_id: executionId,
      agent_slug: "deep_genome",
      status: "succeeded",
      latest_seq: 2,
      output_revision: 1,
      output_offset: reportLength,
      operation_revision: 0,
      operations: [],
      execution_stage: null,
      tracking_health: "healthy",
      active_span_ids: [],
      todo_declared: false,
      todos: [],
      results: [],
      targets: [],
      failed_work_unit_ids: [],
      warnings: [
        { code: "report_context_truncated", work_unit_id: null },
        { code: "future_safe_warning", work_unit_id: null },
      ],
      input_required: null,
      context_stage: null,
      terminal: {
        status: "succeeded",
        event_id: "event-report-succeeded",
        result_revision: 1,
      },
    };
    const base = {
      schema_version: 2,
      execution_id: executionId,
      occurred_at: "2026-09-18T00:00:00Z",
      span_id: "root",
      parent_span_id: null,
      work_unit_id: null,
      attempt: 1,
      target: null,
      idempotency_key: null,
    };
    const completed = {
      ...base,
      event_id: "event-report-completed",
      seq: 1,
      type: "message.completed",
      status: "succeeded",
      source: "message",
      summary: { key: "message.completed", text: "Answer completed" },
      public_payload: {
        output_revision: 1,
        message_id: messageId,
        source_message_id: messageId,
        base_offset: 0,
        offset: reportLength,
        total_length: reportLength,
        chunk_index: 0,
        chunk_count: 1,
        content_sha256: "a".repeat(64),
        text: report,
        references: [],
      },
    };
    const succeeded = {
      ...base,
      event_id: "event-report-succeeded",
      seq: 2,
      type: "execution.succeeded",
      status: "succeeded",
      source: "runtime",
      summary: {
        key: "activity.execution.succeeded",
        text: "Execution succeeded",
      },
      public_payload: {},
    };
    const openExecutionStream = vi
      .fn()
      .mockResolvedValue(
        streamResponse([
          `event: execution_snapshot\ndata: ${JSON.stringify(snapshot)}`,
          `id: 1\nevent: execution_event\ndata: ${JSON.stringify(completed)}`,
          `id: 2\nevent: execution_event\ndata: ${JSON.stringify(succeeded)}`,
        ])
      );
    const execution = useExecutionEvents({
      getChatState: states.getChatState,
      client: {
        getEvents: vi.fn(),
        getProjection: vi.fn(),
        openExecutionStream,
      },
      maxReconnectAttempts: 0,
    });

    await execution.attachExecution(dialogueId, executionId);

    const message = chatState.renderedChat.messages[0];
    expect(message.botProjection).toMatchObject({
      agent: "DeepGenomeAgent",
      status: "SUCCEEDED",
      reportPresentation: true,
      reportStage: "final",
      reportCompleteness: "partial",
      finalReport: report,
      reportWarningCodes: ["report_context_truncated"],
      degraded: true,
      trackingDegraded: false,
    });
    expect(message.botProjection?.report).toBeUndefined();
    expect(message.executionRun?.outputCompleted).toBe(true);
  });

  it("recovers an execution-addressed stream gap from the durable projection cursor", async () => {
    const states = useChatStates();
    const finished = event(4, "run.succeeded", "succeeded");
    const openExecutionStream = vi
      .fn()
      .mockResolvedValueOnce(streamResponse(["event: execution_gap\ndata: {}"]))
      .mockResolvedValueOnce(
        streamResponse([
          `id: 4\nevent: execution_event\ndata: ${JSON.stringify({
            schema_version: 1,
            event_id: finished.eventId,
            run_id: finished.runId,
            seq: finished.seq,
            occurred_at: finished.occurredAt,
            kind: finished.kind,
            status: finished.status,
            summary: finished.summary,
            payload: finished.payload,
            ignorable: finished.ignorable,
          })}`,
        ])
      );
    const getExecutionProjection = vi.fn().mockResolvedValue({
      code: 200,
      data: {
        schemaVersion: 1,
        runId: "run-1",
        latestSeq: 3,
        status: "running",
        phase: null,
        todos: [],
        results: [],
        inputRequired: null,
        terminal: null,
      },
    });
    const execution = useExecutionEvents({
      getChatState: states.getChatState,
      client: {
        getEvents: vi.fn(),
        getProjection: vi.fn(),
        getExecutionProjection,
        openExecutionStream,
      },
      reconnectDelay: () => Promise.resolve(),
    });

    await execution.attachExecution("new_1", "turn-gap");

    expect(getExecutionProjection).toHaveBeenCalledWith({
      executionId: "turn-gap",
    });
    expect(openExecutionStream.mock.calls[1][0].afterSeq).toBe(3);
    expect(
      states.getChatState("new_1").executionRuns["turn-gap"].terminal?.status
    ).toBe("succeeded");
  });

  it("restores each dialogue's presentation state across A to B to A", () => {
    const states = useChatStates();
    const a = states.getChatState("dialogue-a");
    a.selectedExecutionRunId = "run-a";
    a.executionWorkspaceTabs = [
      {
        key: "artifact:artifact-a",
        target: { kind: "artifact", id: "artifact-a" },
        title: "A result",
      },
    ];
    a.activeExecutionWorkspaceTab = "artifact:artifact-a";
    a.executionWorkspaceOpen = true;
    a.executionRailOpen = false;
    a.transcriptScrollTop = 120;
    a.workspaceScrollTop = 48;

    const b = states.getChatState("dialogue-b");
    b.selectedExecutionRunId = "run-b";
    b.executionRailOpen = true;
    b.transcriptScrollTop = 9;

    const restored = states.getChatState("dialogue-a");
    expect(restored).toMatchObject({
      selectedExecutionRunId: "run-a",
      activeExecutionWorkspaceTab: "artifact:artifact-a",
      executionWorkspaceOpen: true,
      executionRailOpen: false,
      transcriptScrollTop: 120,
      workspaceScrollTop: 48,
    });
    expect(restored.executionWorkspaceTabs).toHaveLength(1);
    expect(restored.executionWorkspaceTabs[0].target.id).toBe("artifact-a");
  });

  it("opens technical diagnostics as a bounded local workspace view", () => {
    const states = useChatStates();
    const execution = useExecutionEvents({
      getChatState: states.getChatState,
      client: {
        getEvents: vi.fn(),
        getProjection: vi.fn(),
      },
    });

    execution.openDiagnostics(
      "dialogue-a",
      "turn-diagnostics",
      "Technical details"
    );

    const state = states.getChatState("dialogue-a");
    expect(state.executionWorkspaceOpen).toBe(true);
    expect(state.activeExecutionWorkspaceTab).toBe(
      "diagnostics:turn-diagnostics"
    );
    expect(state.executionWorkspaceTabs).toEqual([
      expect.objectContaining({
        key: "diagnostics:turn-diagnostics",
        title: "Technical details",
        localView: "diagnostics",
      }),
    ]);
  });
});
