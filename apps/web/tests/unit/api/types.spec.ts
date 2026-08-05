import { describe, expect, it } from "vitest";
import {
  decodeAgentResultDelivery,
  decodeAgentTaskLifecycle,
  decodeAnalystAgentLog,
  decodeChatHistory,
  decodeQueryData,
} from "@/api/types";

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

  it.each([
    [{ asset_id: "not-file" }],
    [{ asset_id: "file_reads" }, { asset_id: "file_reads" }],
    [{ asset_id: "file_reads", name: "reads.fastq" }],
    Array.from({ length: 11 }, (_, index) => ({ asset_id: `file_${index}` })),
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
    expect(decodeQueryData({ id: 42, delivery }).delivery).toEqual(delivery);
    expect(
      decodeAgentTaskLifecycle({ ...lifecycle, delivery }).delivery
    ).toEqual(delivery);
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
    ["inconsistent child work", { child_work_accepted: false }],
    [
      "missing artifact member",
      { artifact_summary: { image_count: 1, has_report: true } },
    ],
    ["string ID", { id: "42" }],
    ["Bot run field", { run_id: "bot-secret" }],
    ["child identity field", { child_ids: ["child-secret"] }],
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
