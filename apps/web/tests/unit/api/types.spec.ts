import { describe, expect, it } from "vitest";
import {
  decodeAgentResultDelivery,
  decodeAgentTaskLifecycle,
  decodeAnalystAgentLog,
  decodeChatHistory,
  decodeConversationHistoryV2,
  decodeQueryData,
} from "@/api/types";

describe("ordered conversation history v2 decoding", () => {
  it("preserves stable message identities, order, content revisions and execution projections", () => {
    const decoded = decodeConversationHistoryV2({
      schema_version: 2,
      conversation_id: "dialogue-1",
      messages: [
        {
          message_id: "msg-user-1",
          conversation_id: "dialogue-1",
          message_index: 1,
          execution_id: "turn-1",
          source_message_id: "msg-user-1",
          type: "user",
          role: "user",
          visibility: "user",
          content_revision: 0,
          content_offset: 5,
          content_length: 5,
          content: "hello",
          status: "completed",
          occurred_at: "2026-08-21T00:00:00Z",
        },
        {
          message_id: "msg-assistant-1",
          conversation_id: "dialogue-1",
          message_index: 2,
          execution_id: "turn-1",
          source_message_id: "msg-assistant-1",
          parent_message_id: "msg-user-1",
          type: "assistant",
          role: "assistant",
          visibility: "user",
          content_revision: 1,
          content_offset: 6,
          content_length: 6,
          content_sha256: "a".repeat(64),
          content: "answer",
          references: [
            {
              title: "Drought epigenetics",
              di: "10.1000/safe-doi",
              pm: "12345",
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
          status: "succeeded",
          occurred_at: "2026-08-21T00:00:01Z",
        },
      ],
      executions: [
        {
          execution_id: "turn-1",
          user_message_id: "msg-user-1",
          assistant_message_id: "msg-assistant-1",
          status: "succeeded",
          event_cursor: 12,
          projection_revision: 12,
          content_revision: 1,
          content_offset: 6,
          tracking_health: "healthy",
          stale: false,
          projection: {
            schema_version: 2,
            execution_id: "turn-1",
            status: "succeeded",
          },
          events: [
            {
              schema_version: 2,
              event_id: "event-1",
              execution_id: "turn-1",
            },
          ],
        },
      ],
    });

    expect(decoded.messages.map((message) => message.message_id)).toEqual([
      "msg-user-1",
      "msg-assistant-1",
    ]);
    expect(decoded.messages[1]).toMatchObject({
      content: "answer",
      content_revision: 1,
      content_offset: 6,
      references: [
        {
          title: "Drought epigenetics",
          di: "10.1000/safe-doi",
          pm: "12345",
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
    });
    expect(decoded.executions[0]).toMatchObject({
      execution_id: "turn-1",
      assistant_message_id: "msg-assistant-1",
      event_cursor: 12,
      events: [{ event_id: "event-1" }],
    });
  });

  it("rejects aggregate rows masquerading as v2 timeline items", () => {
    expect(() =>
      decodeConversationHistoryV2({
        schema_version: 2,
        conversation_id: "dialogue-1",
        messages: [{ id: 1, query: "hello", answer: "answer" }],
        executions: [],
      })
    ).toThrow("Invalid conversation history v2");
  });

  it("rejects non-journal and malformed canonical references in V2 history", () => {
    const citation = { runs: [{ text: "Canonical" }], links: [] };
    const historyWith = (references: unknown) => ({
      schema_version: 2,
      conversation_id: "dialogue-1",
      messages: [
        {
          message_id: "msg-assistant-1",
          conversation_id: "dialogue-1",
          message_index: 1,
          execution_id: "turn-1",
          source_message_id: "msg-assistant-1",
          type: "assistant",
          role: "assistant",
          visibility: "user",
          content_revision: 1,
          content_offset: 6,
          content_length: 6,
          content_sha256: "a".repeat(64),
          content: "answer",
          references,
          status: "succeeded",
          occurred_at: "2026-08-21T00:00:01Z",
        },
      ],
      executions: [],
    });

    for (const references of [
      [
        {
          title: "Canonical",
          dl: "https://provider.invalid/private",
          citation,
        },
      ],
      [
        {
          title: "Canonical",
          citation: { ...citation, provider_payload: "private" },
        },
      ],
      [{ title: "Canonical", citation: { runs: "invalid", links: [] } }],
    ]) {
      expect(() =>
        decodeConversationHistoryV2(historyWith(references))
      ).toThrow("Invalid conversation history v2");
    }
  });
});

describe("chat attachment reference decoding", () => {
  it("accepts ordered asset references on query data and history rows", () => {
    const attachments = [
      { asset_id: "file_reads" },
      { asset_id: "file_annotations" },
    ];
    expect(decodeQueryData({ id: 1, attachments }).attachments).toEqual(
      attachments
    );
    expect(
      decodeChatHistory([{ id: "1", attachments }])[0]?.attachments
    ).toEqual(attachments);
  });

  it.each([64, 256])(
    "accepts %d ordered safe attachment references as a detached result",
    (count) => {
      const attachments = Array.from({ length: count }, (_, index) => ({
        asset_id: `file_${index}`,
      }));
      const decoded = decodeQueryData({ id: 1, attachments }).attachments;

      expect(decoded).toEqual(attachments);
      expect(decoded).not.toBe(attachments);
      expect(decoded?.[0]).not.toBe(attachments[0]);
      if (decoded) decoded[0].asset_id = "file_mutated";
      expect(attachments[0]?.asset_id).toBe("file_0");
    }
  );

  it.each([
    [{ asset_id: "not-file" }],
    [{ asset_id: "file_reads" }, { asset_id: "file_reads" }],
    [{ asset_id: "file_reads", name: "reads.fastq" }],
    Array.from({ length: 257 }, (_, index) => ({ asset_id: `file_${index}` })),
  ])("rejects malformed or unbounded attachment references", (attachments) => {
    expect(() => decodeQueryData({ id: 1, attachments })).toThrow(
      "Invalid chat response"
    );
  });

  it("keeps the field absent for legacy rows", () => {
    const result = decodeQueryData({ id: 2, query: "legacy" });
    expect("attachments" in result).toBe(false);
  });
});

describe("nested formatted chat answer decoding", () => {
  it("promotes a complete nested Review answer without copying the raw result", () => {
    const completeAnswer = `REVIEW-START\n${"review ".repeat(900)}\nREVIEW-END`;
    const decoded = decodeQueryData({
      id: 44,
      tool_name: "ReviewAgent",
      status: "INPUT_REQUIRED",
      answer: "",
      result: { formatted: { answer: completeAnswer } },
      a2ui: {
        widget: "confirm",
        props: { body: completeAnswer.slice(0, 500) },
      },
    });

    expect(decoded.answer).toBe(completeAnswer);
    expect(decoded.answer.length).toBeGreaterThan(4096);
    expect("result" in decoded).toBe(false);
  });

  it("keeps a non-empty top-level answer ahead of nested formatted data", () => {
    const decoded = decodeQueryData({
      id: 45,
      answer: "top-level answer",
      final_answer: "top-level final answer",
      result: { formatted: { answer: "nested answer" } },
    });

    expect(decoded.answer).toBe("top-level answer");
    expect(decoded.final_answer).toBe("top-level final answer");
  });

  it("promotes an input-required A2UI draft without copying the raw result", () => {
    const a2ui = {
      widget: "confirm",
      props: { body: "Continue the review?" },
    };
    const decoded = decodeQueryData({
      id: 46,
      status: "INPUT_REQUIRED",
      result: { interrupt: { draft: { a2ui } } },
    });

    expect(decoded.a2ui).toEqual(a2ui);
    expect("result" in decoded).toBe(false);
  });
});

describe("agent lifecycle decoding", () => {
  const lifecycle = {
    id: 42,
    phase: "SUCCEEDED",
    terminal: true,
    child_task_count: 2,
    child_work_accepted: true,
    report_revision: 3,
    artifact_summary: {
      image_count: 1,
      output_directory_count: 1,
      has_report: true,
    },
    reconciliation: "FRESH",
    tracking_degraded: false,
    error_code: null,
  };

  it("accepts the complete bounded lifecycle DTO", () => {
    expect(decodeAgentTaskLifecycle(lifecycle)).toEqual(lifecycle);
  });

  it("accepts bounded children and rejects child identities", () => {
    const withChildren = {
      ...lifecycle,
      child_task_count: 2,
      child_work_accepted: true,
      children: [
        {
          ordinal: 1,
          phase: "SUCCEEDED",
          kind: "protein_structure_analysis",
          error_code: null,
        },
        {
          ordinal: 2,
          phase: "FAILED",
          kind: "promoter_analysis",
          error_code: "input_rejected",
        },
      ],
    };
    expect(decodeAgentTaskLifecycle(withChildren)).toEqual(withChildren);
    expect(() =>
      decodeAgentTaskLifecycle({
        ...withChildren,
        children: [
          {
            ordinal: 1,
            phase: "RUNNING",
            kind: "analyst",
            error_code: null,
            id: "child-secret",
          },
        ],
      })
    ).toThrow("Invalid agent task lifecycle");
  });

  it.each(["SUCCEEDED", "FAILED", "TIMED_OUT", "CANCELLED"])(
    "accepts canonical terminal phase %s",
    (phase) => {
      expect(decodeAgentTaskLifecycle({ ...lifecycle, phase }).phase).toBe(
        phase
      );
    }
  );

  it("decodes only the exact browser-safe result delivery DTO", () => {
    const delivery = {
      schema_version: 1,
      required: true,
      status: "ready",
      revision: 2,
      name: "research-results.zip",
      size_bytes: 1024,
      error_code: null,
      retryable: false,
    } as const;

    expect(decodeAgentResultDelivery(delivery)).toEqual(delivery);
    expect(
      decodeQueryData({ id: 42, result_archive_v1: true, delivery })
    ).toMatchObject({ result_archive_v1: true, delivery });
    expect(
      decodeAgentTaskLifecycle({ ...lifecycle, delivery }).delivery
    ).toEqual(delivery);
  });

  it("preserves the active archive marker on history rows", () => {
    expect(
      decodeChatHistory([
        { id: 42, result_archive_v1: true, answer: "completed" },
      ])[0]
    ).toMatchObject({ id: "42", result_archive_v1: true });
  });

  it.each([
    {
      schema_version: 1,
      required: true,
      status: "ready",
      revision: 1,
      name: null,
      size_bytes: null,
      error_code: null,
      retryable: false,
      download_ref: "obs://private",
    },
    {
      schema_version: 1,
      required: true,
      status: "ready",
      revision: 1,
      name: "../results.zip",
      size_bytes: 1,
      error_code: null,
      retryable: false,
    },
    {
      schema_version: 1,
      required: true,
      status: "ready",
      revision: 1,
      name: "research-results.zip",
      size_bytes: 10 * 1024 * 1024 * 1024 + 1,
      error_code: null,
      retryable: false,
    },
    {
      schema_version: 1,
      required: true,
      status: "failed",
      revision: 1,
      name: null,
      size_bytes: null,
      error_code: "provider_secret",
      retryable: false,
    },
    {
      schema_version: 1,
      required: true,
      status: "failed",
      revision: 1,
      name: null,
      size_bytes: null,
      error_code: "archive_contract_invalid",
      retryable: true,
    },
    {
      schema_version: 1,
      required: true,
      status: "pending",
      revision: 1,
      name: null,
      size_bytes: null,
      error_code: null,
      retryable: true,
    },
  ])("rejects unsafe or contradictory delivery state", (delivery) => {
    expect(() => decodeAgentResultDelivery(delivery)).toThrow(
      "Invalid result delivery"
    );
  });

  it.each([
    ["unknown phase", { phase: "WAITING" }],
    ["unknown reconciliation", { reconciliation: "STALE" }],
    ["unknown error", { error_code: "internal_reason" }],
    ["negative count", { child_task_count: -1 }],
    [
      "fractional count",
      { artifact_summary: { ...lifecycle.artifact_summary, image_count: 1.5 } },
    ],
    ["unsafe count", { report_revision: Number.MAX_SAFE_INTEGER + 1 }],
    ["excessive count", { child_task_count: 257 }],
    ["nonterminal phase marked terminal", { phase: "RUNNING", terminal: true }],
    ["terminal phase marked nonterminal", { phase: "FAILED", terminal: false }],
    ["timeout alias", { phase: "TIMEOUT" }],
    [
      "canonical timeout marked nonterminal",
      { phase: "TIMED_OUT", terminal: false },
    ],
    ["inconsistent child work", { child_work_accepted: false }],
    [
      "missing artifact member",
      { artifact_summary: { image_count: 1, has_report: true } },
    ],
    ["string ID", { id: "42" }],
    ["Bot run field", { run_id: "bot-secret" }],
    ["child identity field", { child_ids: ["child-secret"] }],
    ["empty children", { children: [] }],
    [
      "duplicate child ordinal",
      {
        children: [
          {
            ordinal: 1,
            phase: "RUNNING",
            kind: "analyst",
            error_code: null,
          },
          {
            ordinal: 1,
            phase: "FAILED",
            kind: "design",
            error_code: null,
          },
        ],
      },
    ],
    [
      "child identity on row",
      {
        children: [
          {
            ordinal: 1,
            phase: "RUNNING",
            kind: "analyst",
            error_code: null,
            id: "child-secret",
          },
        ],
      },
    ],
    [
      "unsupported child phase",
      {
        children: [
          {
            ordinal: 1,
            phase: "FINALIZING",
            kind: "analyst",
            error_code: null,
          },
        ],
      },
    ],
    ["path field", { path: "/internal/path" }],
    ["report text field", { report: "private report" }],
  ])("rejects %s", (_label, overrides) => {
    expect(() =>
      decodeAgentTaskLifecycle({ ...lifecycle, ...overrides })
    ).toThrow("Invalid agent task lifecycle");
  });
});

describe("analyst log decoding", () => {
  const log = {
    state: "AVAILABLE",
    source: "LEGACY_TASK",
    text: "safe bounded text",
    revision: 2,
    truncated: false,
    can_request_legacy_refresh: true,
    error_code: null,
  };

  it.each(["PENDING", "AVAILABLE", "TERMINAL_EMPTY", "DEGRADED"])(
    "accepts %s log state",
    (state) => {
      expect(decodeAnalystAgentLog({ ...log, state }).state).toBe(state);
    }
  );

  it("accepts an empty pending log", () => {
    expect(
      decodeAnalystAgentLog({ ...log, state: "PENDING", text: "" })
    ).toMatchObject({ state: "PENDING", text: "" });
  });

  it.each(["BOT_RUN", "LEGACY_TASK"])("accepts %s log source", (source) => {
    expect(
      decodeAnalystAgentLog({
        ...log,
        source,
        can_request_legacy_refresh: source === "LEGACY_TASK",
      }).source
    ).toBe(source);
  });

  it.each([
    ["unknown state", { state: "UNKNOWN" }],
    ["unknown source", { source: "BOT" }],
    ["negative revision", { revision: -1 }],
    ["non-boolean truncated", { truncated: "false" }],
    ["non-boolean legacy refresh", { can_request_legacy_refresh: 1 }],
    ["oversized text", { text: "x".repeat((512 << 10) + 1) }],
    [
      "Bot legacy refresh",
      { source: "BOT_RUN", can_request_legacy_refresh: true },
    ],
  ])("rejects %s", (_label, overrides) => {
    expect(() => decodeAnalystAgentLog({ ...log, ...overrides })).toThrow(
      "Invalid analyst agent log"
    );
  });
});
