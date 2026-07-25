import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type {
  A2uiActionEnvelope,
  A2uiActionResponse,
  A2uiActionIntent,
  A2uiOpenSurface,
  A2uiSurfaceState,
  A2uiTerminalSurface,
} from "@/views/chat/streaming/a2uiContract";
import { A2UI_LIMITS } from "@/views/chat/streaming/a2uiContract";
import {
  beginA2uiAction,
  beginA2uiRetry,
  lockUnverifiedHistoryA2ui,
  markA2uiNotSent,
  reduceA2uiFailure,
  reduceA2uiInputRequired,
  reduceA2uiSucceeded,
} from "@/views/chat/streaming/a2uiReducer";
import { decodeA2uiActionResponse } from "@/views/chat/streaming/a2uiParse";
import { A2uiTransportError } from "@/views/chat/streaming/a2uiAction";
import * as a2uiAction from "@/views/chat/streaming/a2uiAction";
import type { ChatMessage, ContentBlock } from "@/views/chat/types";
import { createA2uiInputRequiredResponse } from "../../../../helpers/a2uiFixtures";

const surface: A2uiOpenSurface = {
  catalog_version: "v1.0",
  surface_id: "surface-1",
  widget: "confirm",
  props: {
    title: "Continue?",
    confirm_label: "Continue",
    cancel_label: "Cancel",
  },
};

const readyBlock = (
  overrides: Partial<ContentBlock> = {},
  openSurface: A2uiOpenSurface = surface
): ContentBlock => ({
  type: "agent-surface",
  authority: "agent",
  interactive: true,
  a2ui: { surface: openSurface, state: { status: "ready", round: 1 } },
  ...overrides,
});

const blocksWithTarget = (
  target: ContentBlock = readyBlock()
): ContentBlock[] => [
  { type: "markdown", authority: "web", text: "before" },
  target,
  { type: "tool", authority: "web", toolName: "search", count: 2 },
];

const confirmIntent: A2uiActionIntent = {
  widget: "confirm",
  payload: { accepted: true },
};

const formSurface: A2uiOpenSurface = {
  catalog_version: "v1.0",
  surface_id: "surface-form",
  widget: "form",
  props: {
    title: "Gene ID",
    fields: [
      {
        name: "gene_id",
        label: "Gene ID",
        type: "text",
        required: true,
      },
    ],
  },
};

const choiceSurface: A2uiOpenSurface = {
  catalog_version: "v1.0",
  surface_id: "surface-choice",
  widget: "choice",
  props: {
    title: "Choice",
    options: [
      { id: "a", label: "Option A" },
      { id: "b", label: "Option B" },
    ],
    multiple: false,
  },
};

type SucceededResponse = Extract<A2uiActionResponse, { status: "succeeded" }>;

type InputRequiredResponse = Extract<
  A2uiActionResponse,
  { status: "input_required" }
>;

const terminalConfirm = (
  surfaceKey: string,
  accepted: boolean
): A2uiTerminalSurface => ({
  catalog_version: "v1.0",
  surface_id: surfaceKey,
  widget: "confirm",
  props: { status: "submitted", accepted },
});

const terminalForm = (
  surfaceKey: string,
  fields: Record<string, string>,
  cancelled = false
): A2uiTerminalSurface => ({
  catalog_version: "v1.0",
  surface_id: surfaceKey,
  widget: "form",
  props: {
    status: "submitted",
    fields,
    ...(cancelled ? { cancelled: true as const } : {}),
  },
});

const terminalChoice = (
  surfaceKey: string,
  selected: string | string[] | undefined,
  cancelled = false
): A2uiTerminalSurface => ({
  catalog_version: "v1.0",
  surface_id: surfaceKey,
  widget: "choice",
  props: {
    status: "submitted",
    ...(selected === undefined ? {} : { selected }),
    ...(cancelled ? { cancelled: true as const } : {}),
  },
});

const beginSubmitting = (
  openSurface: A2uiOpenSurface,
  intent: A2uiActionIntent,
  actionId = "action-1"
): { blocks: ContentBlock[]; envelope: A2uiActionEnvelope } => {
  const result = beginA2uiAction(
    blocksWithTarget(readyBlock({}, openSurface)),
    openSurface.surface_id,
    "run-9",
    intent,
    actionId
  );
  if (!result.ok)
    throw new Error(`expected begin to succeed: ${result.reason}`);
  return result;
};

const succeeded = (
  envelope: A2uiActionEnvelope,
  a2ui: A2uiTerminalSurface,
  answer?: string,
  runId = envelope.run_id
): SucceededResponse => ({
  status: "succeeded",
  run_id: runId,
  result: {
    a2ui,
    ...(answer === undefined ? {} : { formatted: { answer } }),
  },
});

const inputRequired = (
  envelope: A2uiActionEnvelope,
  a2ui: A2uiOpenSurface,
  runId = envelope.run_id
): InputRequiredResponse => ({
  status: "input_required",
  run_id: runId,
  interrupt: { draft: { a2ui } },
});

const fixture = (relativePath: string): unknown =>
  JSON.parse(
    readFileSync(
      resolve(process.cwd(), "tests/fixtures/a2ui", relativePath),
      "utf8"
    )
  );

const inputRequiredRound2Fixture = (
  envelope: A2uiActionEnvelope
): InputRequiredResponse => {
  const response = createA2uiInputRequiredResponse(envelope.run_id);
  if (response.status !== "input_required") {
    throw new Error("expected the round-2 fixture to be input_required");
  }
  return response;
};

describe("beginA2uiAction", () => {
  it("synchronously submits the matching ready surface and returns the envelope", () => {
    const blocks = blocksWithTarget();

    const result = beginA2uiAction(
      blocks,
      "surface-1",
      "run-9",
      confirmIntent,
      "action-1"
    );

    expect(result).toEqual({
      ok: true,
      blocks: [
        blocks[0],
        {
          ...blocks[1],
          a2ui: {
            surface,
            state: {
              status: "submitting",
              round: 1,
              envelope: {
                surface_id: "surface-1",
                widget: "confirm",
                action_id: "action-1",
                run_id: "run-9",
                payload: { accepted: true },
              },
            },
          },
        },
        blocks[2],
      ],
      envelope: {
        surface_id: "surface-1",
        widget: "confirm",
        action_id: "action-1",
        run_id: "run-9",
        payload: { accepted: true },
      },
    });
    expect(blocks[1].a2ui?.state).toEqual({ status: "ready", round: 1 });
  });

  it("does not mutate input and preserves non-target block identities", () => {
    const blocks = blocksWithTarget();
    const original = structuredClone(blocks);

    const result = beginA2uiAction(
      blocks,
      "surface-1",
      "run-9",
      confirmIntent,
      "action-1"
    );

    expect(result.ok).toBe(true);
    expect(result.blocks).not.toBe(blocks);
    expect(result.blocks[0]).toBe(blocks[0]);
    expect(result.blocks[2]).toBe(blocks[2]);
    expect(result.blocks[1]).not.toBe(blocks[1]);
    expect(blocks).toEqual(original);
  });

  it("rejects a second begin while the surface is submitting without mutation", () => {
    const first = beginA2uiAction(
      blocksWithTarget(),
      "surface-1",
      "run-9",
      confirmIntent,
      "action-1"
    );
    if (!first.ok) throw new Error("expected first begin to succeed");

    const before = structuredClone(first.blocks);
    const second = beginA2uiAction(
      first.blocks,
      "surface-1",
      "run-9",
      confirmIntent,
      "action-2"
    );

    expect(second).toEqual({
      ok: false,
      reason: "surface_not_ready",
      blocks: first.blocks,
    });
    expect(first.blocks).toEqual(before);
  });

  it.each([
    [
      "wrong widget",
      "intent_mismatch",
      "run-9",
      confirmIntent,
      "action-1",
      "surface-1",
    ],
    [
      "missing run ID",
      "run_missing",
      "",
      confirmIntent,
      "action-1",
      "surface-1",
    ],
    [
      "blank action ID",
      "action_id_invalid",
      "run-9",
      confirmIntent,
      "  ",
      "surface-1",
    ],
    [
      "missing surface",
      "surface_missing",
      "run-9",
      confirmIntent,
      "action-1",
      "missing",
    ],
  ] as const)(
    "returns a fixed reason for %s without mutation",
    (_label, reason, runId, intent, actionId, surfaceKey) => {
      const blocks = blocksWithTarget();
      const original = structuredClone(blocks);
      const mismatchedIntent: A2uiActionIntent = {
        widget: "form",
        payload: { cancelled: true },
      };

      const result = beginA2uiAction(
        blocks,
        surfaceKey,
        runId,
        reason === "intent_mismatch" ? mismatchedIntent : intent,
        actionId
      );

      expect(result).toEqual({ ok: false, reason, blocks });
      expect(blocks).toEqual(original);
    }
  );

  it("rejects a non-ready target with the same fixed reason", () => {
    const blocks = blocksWithTarget({
      a2ui: {
        surface,
        state: {
          status: "resolved",
          round: 1,
          actionId: "action-0",
          resolution: "submitted",
        },
      },
    });
    const original = structuredClone(blocks);

    const result = beginA2uiAction(
      blocks,
      "surface-1",
      "run-9",
      confirmIntent,
      "action-1"
    );

    expect(result).toEqual({ ok: false, reason: "surface_not_ready", blocks });
    expect(blocks).toEqual(original);
  });
});

describe("reduceA2uiSucceeded", () => {
  it.each([
    [
      "accepted confirm",
      surface,
      confirmIntent,
      terminalConfirm(surface.surface_id, true),
      "submitted",
    ],
    [
      "rejected confirm",
      surface,
      { widget: "confirm", payload: { accepted: false } },
      terminalConfirm(surface.surface_id, false),
      "rejected",
    ],
    [
      "cancelled form",
      formSurface,
      { widget: "form", payload: { cancelled: true } },
      terminalForm(formSurface.surface_id, {}, true),
      "cancelled",
    ],
    [
      "submitted form",
      formSurface,
      { widget: "form", payload: { fields: { gene_id: "AT1G01010" } } },
      terminalForm(formSurface.surface_id, { gene_id: "AT1G01010" }),
      "submitted",
    ],
    [
      "cancelled choice",
      choiceSurface,
      { widget: "choice", payload: { cancelled: true } },
      terminalChoice(choiceSurface.surface_id, undefined, true),
      "cancelled",
    ],
    [
      "submitted choice",
      choiceSurface,
      { widget: "choice", payload: { selected: "a" } },
      terminalChoice(choiceSurface.surface_id, "a"),
      "submitted",
    ],
  ] as const)(
    "resolves %s from the authoritative terminal snapshot",
    (_label, openSurface, intent, terminal, resolution) => {
      const { blocks, envelope } = beginSubmitting(openSurface, intent);
      const next = reduceA2uiSucceeded(
        blocks,
        envelope,
        succeeded(envelope, terminal, "Analysis complete.")
      );

      expect(next).not.toBe(blocks);
      expect(next[0]).toBe(blocks[0]);
      expect(next[2]).toBe(blocks[2]);
      expect(next[1]).not.toBe(blocks[1]);
      expect(next[1]).not.toHaveProperty("surfaceId");
      expect(next[1]).not.toHaveProperty("widget");
      expect(next[1]).not.toHaveProperty("props");
      expect(next[1].a2ui).toEqual({
        surface: openSurface,
        state: {
          status: "resolved",
          round: 1,
          actionId: envelope.action_id,
          resolution,
          snapshot: terminal,
        },
      });
      expect(next.at(-1)).toEqual({
        type: "markdown",
        authority: "agent",
        text: "Analysis complete.",
        sourceActionId: envelope.action_id,
      });
    }
  );

  it("applies a terminal response exactly once and does not duplicate its answer", () => {
    const { blocks, envelope } = beginSubmitting(surface, confirmIntent);
    const response = succeeded(
      envelope,
      terminalConfirm(surface.surface_id, true),
      "Analysis complete."
    );

    const first = reduceA2uiSucceeded(blocks, envelope, response);
    const replay = reduceA2uiSucceeded(first, envelope, response);

    expect(replay).toBe(first);
    expect(
      replay.filter((block) => block.sourceActionId === envelope.action_id)
    ).toHaveLength(1);
  });

  it("does not fold a transport failure for a mismatched envelope", () => {
    const { blocks, envelope } = beginSubmitting(surface, confirmIntent);
    const mismatched: A2uiActionEnvelope = {
      ...envelope,
      run_id: "other-run",
    };
    const before = structuredClone(blocks);

    const next = reduceA2uiFailure(
      blocks,
      mismatched,
      new A2uiTransportError(
        "unknown",
        "a2ui_transport_error",
        undefined,
        true,
        false
      )
    );

    expect(next).toBe(blocks);
    expect(blocks).toEqual(before);
  });

  it.each([
    [
      "surface mismatch",
      terminalConfirm("other-surface", true),
      undefined,
      "surface_mismatch",
    ],
    [
      "widget mismatch",
      terminalForm(surface.surface_id, {}),
      undefined,
      "widget_mismatch",
    ],
    [
      "run mismatch",
      terminalConfirm(surface.surface_id, true),
      "other-run",
      "run_id_mismatch",
    ],
  ] as const)(
    "marks the submitting surface protocol_error for %s",
    (_label, terminal, runId, code) => {
      const { blocks, envelope } = beginSubmitting(surface, confirmIntent);
      const next = reduceA2uiSucceeded(
        blocks,
        envelope,
        succeeded(envelope, terminal, "should not append", runId ?? undefined)
      );

      expect(next[1].a2ui?.state).toEqual({
        status: "protocol_error",
        round: 1,
        actionId: envelope.action_id,
        code,
      });
      expect(next).toHaveLength(blocks.length);
      expect(
        next.some((block) => block.sourceActionId === envelope.action_id)
      ).toBe(false);
    }
  );

  it("ignores a response when its action is already applied or is no longer submitting", () => {
    const { blocks, envelope } = beginSubmitting(surface, confirmIntent);
    const response = succeeded(
      envelope,
      terminalConfirm(surface.surface_id, true),
      "Analysis complete."
    );
    const resolved = reduceA2uiSucceeded(blocks, envelope, response);

    expect(reduceA2uiSucceeded(resolved, envelope, response)).toBe(resolved);

    const ready = blocksWithTarget();
    expect(reduceA2uiSucceeded(ready, envelope, response)).toBe(ready);
  });

  it.each(["", " ", "x".repeat(A2UI_LIMITS.textChars + 1)])(
    "does not append an empty or over-budget formatted answer (%s)",
    (answer) => {
      const { blocks, envelope } = beginSubmitting(surface, confirmIntent);
      const next = reduceA2uiSucceeded(
        blocks,
        envelope,
        succeeded(envelope, terminalConfirm(surface.surface_id, true), answer)
      );

      expect(next).toHaveLength(blocks.length);
      expect(
        next.some((block) => block.sourceActionId === envelope.action_id)
      ).toBe(false);
    }
  );
});

describe("reduceA2uiInputRequired", () => {
  const round2Surface: A2uiOpenSurface = {
    ...choiceSurface,
    surface_id: "surface-2",
  };

  it("accepts only the typed input-required response branch", () => {
    const response = fixture("http/input_required_round2.json") as Record<
      string,
      unknown
    >;
    const interrupt = response.interrupt as Record<string, unknown>;
    const draft = interrupt.draft as Record<string, unknown>;
    const cases: unknown[] = [
      { ...response, run_id: undefined },
      { ...response, status: "running" },
      { ...response, result: {} },
      {
        ...response,
        interrupt: {
          draft: {
            ...draft,
            a2ui: {
              ...(draft.a2ui as Record<string, unknown>),
              widget: "slider",
            },
          },
        },
      },
    ];

    for (const value of cases) {
      expect(decodeA2uiActionResponse(value).ok).toBe(false);
    }
    expect(decodeA2uiActionResponse(response).ok).toBe(true);
  });

  it("advances round 1 and appends a fresh ready round-2 surface", () => {
    const { blocks, envelope } = beginSubmitting(surface, confirmIntent);
    const original = structuredClone(blocks);
    const response = inputRequiredRound2Fixture(envelope);
    const fixtureSurface = response.interrupt.draft.a2ui;

    const next = reduceA2uiInputRequired(blocks, envelope, response);

    expect(next).not.toBe(blocks);
    expect(next[0]).toBe(blocks[0]);
    expect(next[2]).toBe(blocks[2]);
    expect(next[1]).not.toBe(blocks[1]);
    expect(next[1].a2ui).toEqual({
      surface,
      state: {
        status: "resolved",
        round: 1,
        actionId: envelope.action_id,
        resolution: "advanced",
      },
    });
    expect(next.at(-1)).toEqual({
      type: "agent-surface",
      authority: "agent",
      interactive: true,
      a2ui: {
        surface: fixtureSurface,
        state: { status: "ready", round: 2 },
      },
    });
    expect(
      next.filter((block) =>
        ["ready", "submitting", "temporarily_rejected"].includes(
          block.a2ui?.state.status ?? ""
        )
      )
    ).toHaveLength(1);
    expect(blocks).toEqual(original);
  });

  it("allows round 2 to resolve terminally without opening another surface", () => {
    const first = beginSubmitting(surface, confirmIntent);
    const second = reduceA2uiInputRequired(
      first.blocks,
      first.envelope,
      inputRequired(first.envelope, round2Surface)
    );
    const round2Begin = beginA2uiAction(
      second,
      round2Surface.surface_id,
      first.envelope.run_id,
      { widget: "choice", payload: { selected: "a" } },
      "action-2"
    );
    if (!round2Begin.ok) throw new Error("expected round 2 begin to succeed");

    const terminal = reduceA2uiSucceeded(
      round2Begin.blocks,
      round2Begin.envelope,
      succeeded(
        round2Begin.envelope,
        terminalChoice(round2Surface.surface_id, "a")
      )
    );

    expect(terminal.at(-1)?.a2ui?.state).toEqual({
      status: "resolved",
      round: 2,
      actionId: round2Begin.envelope.action_id,
      resolution: "submitted",
      snapshot: terminalChoice(round2Surface.surface_id, "a"),
    });
    expect(
      terminal.filter((block) =>
        ["ready", "submitting", "temporarily_rejected"].includes(
          block.a2ui?.state.status ?? ""
        )
      )
    ).toHaveLength(0);
  });

  it.each([
    ["reused surface", surface, "surface_reused"],
    ["mismatched run", round2Surface, "run_id_mismatch"],
    [
      "malformed surface",
      { ...round2Surface, widget: "slider" },
      "surface_invalid",
    ],
  ] as const)(
    "marks the submitting target protocol_error for %s",
    (_label, nextSurface, code) => {
      const { blocks, envelope } = beginSubmitting(surface, confirmIntent);
      const response = inputRequired(
        envelope,
        nextSurface as A2uiOpenSurface,
        code === "run_id_mismatch" ? "other-run" : envelope.run_id
      );

      const next = reduceA2uiInputRequired(blocks, envelope, response);

      expect(next[1].a2ui?.state).toEqual({
        status: "protocol_error",
        round: 1,
        actionId: envelope.action_id,
        code,
      });
      expect(next).toHaveLength(blocks.length);
    }
  );

  it.each([
    ["action", { action_id: "other-action" }, "action_mismatch"],
    ["surface", { surface_id: "other-surface" }, "surface_mismatch"],
    ["widget", { widget: "form" }, "widget_mismatch"],
  ] as const)(
    "rejects a response envelope with a mismatched %s identity",
    (_label, override, code) => {
      const { blocks, envelope } = beginSubmitting(surface, confirmIntent);
      const mismatched = { ...envelope, ...override } as A2uiActionEnvelope;
      const next = reduceA2uiInputRequired(
        blocks,
        mismatched,
        inputRequired(mismatched, round2Surface)
      );

      expect(next[1].a2ui?.state).toEqual({
        status: "protocol_error",
        round: 1,
        actionId: mismatched.action_id,
        code,
      });
      expect(next).toHaveLength(blocks.length);
    }
  );

  it("rejects a fresh surface whose identity is already present elsewhere", () => {
    const { blocks, envelope } = beginSubmitting(surface, confirmIntent);
    const duplicate = readyBlock(
      {
        a2ui: {
          surface: round2Surface,
          state: {
            status: "resolved",
            round: 2,
            actionId: "action-old",
            resolution: "submitted",
          },
        },
      },
      round2Surface
    );
    const withDuplicate = [...blocks, duplicate];

    const next = reduceA2uiInputRequired(
      withDuplicate,
      envelope,
      inputRequired(envelope, round2Surface)
    );

    expect(next[1].a2ui?.state).toMatchObject({
      status: "protocol_error",
      code: "surface_duplicate",
    });
    expect(next).toHaveLength(withDuplicate.length);
    expect(next.at(-1)).toBe(duplicate);
  });

  it.each(["ready", "submitting", "temporarily_rejected"] as const)(
    "rejects input_required when another %s surface remains open",
    (openStatus) => {
      const first = beginSubmitting(surface, confirmIntent);
      const otherSurface: A2uiOpenSurface = {
        ...round2Surface,
        surface_id: "surface-open",
      };
      const other = readyBlock({}, otherSurface);
      let withOther = [...first.blocks, other];

      if (openStatus === "submitting") {
        const otherBegin = beginA2uiAction(
          withOther,
          otherSurface.surface_id,
          first.envelope.run_id,
          { widget: "choice", payload: { selected: "a" } },
          "action-open"
        );
        if (!otherBegin.ok)
          throw new Error("expected the second begin to succeed");
        withOther = otherBegin.blocks;
      } else if (openStatus === "temporarily_rejected") {
        const otherBegin = beginA2uiAction(
          withOther,
          otherSurface.surface_id,
          first.envelope.run_id,
          { widget: "choice", payload: { selected: "a" } },
          "action-open"
        );
        if (!otherBegin.ok)
          throw new Error("expected the second begin to succeed");
        withOther = reduceA2uiFailure(
          otherBegin.blocks,
          otherBegin.envelope,
          new A2uiTransportError(
            "temporarily_rejected",
            "a2ui_gateway_disabled",
            undefined,
            false,
            true
          )
        );
      }

      const otherBefore = withOther.at(-1);
      const next = reduceA2uiInputRequired(
        withOther,
        first.envelope,
        inputRequiredRound2Fixture(first.envelope)
      );

      expect(next[1].a2ui?.state).toEqual({
        status: "protocol_error",
        round: 1,
        actionId: first.envelope.action_id,
        code: "multiple_open_surfaces",
      });
      expect(next).toHaveLength(withOther.length);
      expect(next.at(-1)).toBe(otherBefore);
    }
  );

  it("marks a ready target protocol_error when its submitting action is missing", () => {
    const blocks = blocksWithTarget();
    const envelope: A2uiActionEnvelope = {
      surface_id: surface.surface_id,
      widget: surface.widget,
      action_id: "missing-action",
      run_id: "run-9",
      payload: { accepted: true },
    };

    const next = reduceA2uiInputRequired(
      blocks,
      envelope,
      inputRequired(envelope, round2Surface)
    );

    expect(next[1].a2ui?.state).toEqual({
      status: "protocol_error",
      round: 1,
      actionId: envelope.action_id,
      code: "target_missing",
    });
    expect(next).toHaveLength(blocks.length);
  });

  it("rejects input_required from round 2 without creating round 3", () => {
    const first = beginSubmitting(surface, confirmIntent);
    const second = reduceA2uiInputRequired(
      first.blocks,
      first.envelope,
      inputRequired(first.envelope, round2Surface)
    );
    const round2 = second.at(-1);
    if (!round2?.a2ui || round2.a2ui.state.status !== "ready") {
      throw new Error("expected a ready round-2 surface");
    }
    const round2Begin = beginA2uiAction(
      second,
      round2Surface.surface_id,
      first.envelope.run_id,
      { widget: "choice", payload: { selected: "a" } },
      "action-2"
    );
    if (!round2Begin.ok) throw new Error("expected round 2 begin to succeed");

    const next = reduceA2uiInputRequired(
      round2Begin.blocks,
      round2Begin.envelope,
      inputRequired(round2Begin.envelope, {
        ...round2Surface,
        surface_id: "surface-3",
        widget: "form",
        props: {
          title: "Gene ID",
          fields: [
            { name: "gene_id", label: "Gene ID", type: "text", required: true },
          ],
        },
      } as A2uiOpenSurface)
    );

    expect(next[3].a2ui?.state).toEqual({
      status: "protocol_error",
      round: 2,
      actionId: round2Begin.envelope.action_id,
      code: "round_exhausted",
    });
    expect(next).toHaveLength(round2Begin.blocks.length);
  });

  it("applies the same response once and leaves the advanced surface unchanged on replay", () => {
    const { blocks, envelope } = beginSubmitting(surface, confirmIntent);
    const response = inputRequired(envelope, round2Surface);

    const first = reduceA2uiInputRequired(blocks, envelope, response);
    const replay = reduceA2uiInputRequired(first, envelope, response);

    expect(replay).toBe(first);
    expect(
      replay.filter(
        (block) => block.a2ui?.surface.surface_id === round2Surface.surface_id
      )
    ).toHaveLength(1);
  });
});

describe("A2UI transport failure and retry reducers", () => {
  const transportError = (
    kind: "rejected" | "temporarily_rejected" | "expired" | "unknown",
    code: string,
    forwarded: boolean,
    retryable: boolean
  ) => new A2uiTransportError(kind, code, undefined, forwarded, retryable);

  it.each([
    [
      "rejected",
      transportError("rejected", "a2ui_invalid_action", false, false),
      {
        status: "rejected",
        round: 1,
        actionId: "action-1",
        code: "a2ui_invalid_action",
      },
      false,
    ],
    [
      "proven temporary rejection",
      transportError(
        "temporarily_rejected",
        "a2ui_gateway_disabled",
        false,
        true
      ),
      {
        status: "temporarily_rejected",
        round: 1,
        envelope: {
          surface_id: "surface-1",
          widget: "confirm",
          action_id: "action-1",
          run_id: "run-9",
          payload: { accepted: true },
        },
        code: "a2ui_gateway_disabled",
      },
      true,
    ],
    [
      "expired",
      transportError("expired", "a2ui_not_found", false, true),
      {
        status: "expired",
        round: 1,
        actionId: "action-1",
        code: "a2ui_not_found",
      },
      false,
    ],
    [
      "ambiguous unknown",
      transportError("unknown", "a2ui_transport_error", true, false),
      {
        status: "unknown",
        round: 1,
        actionId: "action-1",
        code: "a2ui_transport_error",
      },
      false,
    ],
  ] as const)(
    "maps %s to one terminal state and fixed retry eligibility",
    (_label, error, expectedState, retryAllowed) => {
      const { blocks, envelope } = beginSubmitting(surface, confirmIntent);
      const next = reduceA2uiFailure(blocks, envelope, error);

      expect(next).not.toBe(blocks);
      expect(next[1].a2ui?.state).toEqual(expectedState);
      expect(blocks[1].a2ui?.state).toMatchObject({ status: "submitting" });

      const retry = beginA2uiRetry(next, surface.surface_id);
      expect(retry.ok).toBe(retryAllowed);
      if (retryAllowed) {
        expect(retry).toMatchObject({ ok: true });
      } else {
        expect(retry).toMatchObject({ ok: false, reason: "retry_not_allowed" });
      }
    }
  );

  it("keeps a ready surface and records not_sent when no transport call was made", () => {
    const blocks = blocksWithTarget();
    const next = markA2uiNotSent(blocks, surface.surface_id);

    expect(next).not.toBe(blocks);
    expect(next[1].a2ui?.state).toEqual({
      status: "ready",
      round: 1,
      lastError: "not_sent",
    });
    expect(blocks[1].a2ui?.state).toEqual({ status: "ready", round: 1 });
  });

  it("retries only a proven pre-dispatch rejection with the stored envelope", () => {
    const { blocks, envelope } = beginSubmitting(surface, confirmIntent);
    const temporary = reduceA2uiFailure(
      blocks,
      envelope,
      transportError(
        "temporarily_rejected",
        "a2ui_gateway_disabled",
        false,
        true
      )
    );
    const stored = temporary[1].a2ui?.state;
    if (!stored || stored.status !== "temporarily_rejected") {
      throw new Error("expected temporarily_rejected state");
    }
    const buildId = vi.spyOn(a2uiAction, "buildA2uiActionId");

    const result = beginA2uiRetry(temporary, surface.surface_id);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected retry to be allowed");
    expect(result.envelope).toBe(stored.envelope);
    expect(result.envelope).toEqual(envelope);
    expect(result.envelope.action_id).toBe("action-1");
    expect(result.blocks[1].a2ui?.state).toEqual({
      status: "submitting",
      round: 1,
      envelope: stored.envelope,
    });
    expect(buildId).not.toHaveBeenCalled();
    buildId.mockRestore();
  });

  it.each([
    ["forwarded=true", true, true],
    ["retryable=false", false, false],
  ] as const)(
    "does not create temporarily_rejected for %s",
    (_label, forwarded, retryable) => {
      const { blocks, envelope } = beginSubmitting(surface, confirmIntent);
      const next = reduceA2uiFailure(
        blocks,
        envelope,
        transportError(
          "temporarily_rejected",
          "ambiguous_gateway_result",
          forwarded,
          retryable
        )
      );

      expect(next[1].a2ui?.state).toMatchObject({
        status: "unknown",
        actionId: envelope.action_id,
        code: "ambiguous_gateway_result",
      });
      expect(next[1].a2ui?.state.status).not.toBe("temporarily_rejected");
      expect(next[1].a2ui?.state.status).not.toBe("protocol_error");
    }
  );

  it("ignores a stale failure after the action is no longer submitting", () => {
    const { blocks, envelope } = beginSubmitting(surface, confirmIntent);
    const resolved = reduceA2uiSucceeded(
      blocks,
      envelope,
      succeeded(envelope, terminalConfirm(surface.surface_id, true))
    );

    const stale = reduceA2uiFailure(
      resolved,
      envelope,
      transportError("unknown", "late_transport_error", true, false)
    );

    expect(stale).toBe(resolved);
  });

  it("does not allow retry when the surface is missing or not temporarily rejected", () => {
    const ready = blocksWithTarget();
    expect(beginA2uiRetry(ready, "missing")).toEqual({
      ok: false,
      reason: "surface_missing",
      blocks: ready,
    });
    expect(beginA2uiRetry(ready, surface.surface_id)).toEqual({
      ok: false,
      reason: "retry_not_allowed",
      blocks: ready,
    });
  });
});

describe("lockUnverifiedHistoryA2ui", () => {
  const historyMessage = (
    state: A2uiSurfaceState,
    runtime = true
  ): ChatMessage => ({
    role: "assistant",
    content: "history",
    ...(runtime
      ? {
          a2uiRuntime: {
            dialogueId: "dialogue-history",
            messageId: "message-history",
            runId: "run-history",
            transport: vi.fn(),
          },
        }
      : {}),
    blocks: [
      {
        type: "agent-surface",
        authority: "agent",
        interactive: true,
        a2ui: { surface, state },
      },
    ],
  });

  it.each([
    ["ready", { status: "ready", round: 1 }],
    [
      "submitting",
      {
        status: "submitting",
        round: 2,
        envelope: {
          surface_id: surface.surface_id,
          widget: surface.widget,
          action_id: "history-action",
          run_id: "history-run",
          payload: { accepted: true },
        },
      },
    ],
    [
      "temporarily_rejected",
      {
        status: "temporarily_rejected",
        round: 1,
        envelope: {
          surface_id: surface.surface_id,
          widget: surface.widget,
          action_id: "retry-action",
          run_id: "history-run",
          payload: { accepted: true },
        },
        code: "gateway_disabled",
      },
    ],
  ] as const)(
    "expires unverified %s state and strips runtime",
    (_label, state) => {
      const message = historyMessage(state);
      const messages = [message];

      const next = lockUnverifiedHistoryA2ui(messages);

      expect(next).not.toBe(messages);
      expect(next[0]).not.toBe(message);
      expect(next[0]).not.toHaveProperty("a2uiRuntime");
      expect(next[0].blocks).not.toBe(message.blocks);
      expect(next[0].blocks?.[0]).not.toBe(message.blocks?.[0]);
      expect(next[0].blocks?.[0].a2ui?.state).toEqual({
        status: "expired",
        round: state.round,
        ...(state.status === "submitting" ||
        state.status === "temporarily_rejected"
          ? { actionId: state.envelope.action_id }
          : {}),
        code: "reload_unverified",
      });
      expect(message.blocks?.[0].a2ui?.state).toEqual(state);
    }
  );

  it.each([
    "resolved",
    "expired",
    "protocol_error",
    "rejected",
    "unknown",
  ] as const)("keeps closed %s state closed", (status) => {
    const state =
      status === "resolved"
        ? {
            status,
            round: 1 as const,
            actionId: "action",
            resolution: "submitted" as const,
          }
        : status === "expired"
          ? { status, round: 1 as const, actionId: "action", code: "old" }
          : status === "protocol_error"
            ? { status, round: 1 as const, actionId: "action", code: "old" }
            : { status, round: 1 as const, actionId: "action", code: "old" };
    const message = historyMessage(state, false);
    const messages = [message];

    const next = lockUnverifiedHistoryA2ui(messages);

    expect(next).toBe(messages);
    expect(next[0]).toBe(message);
    expect(next[0].blocks).toBe(message.blocks);
    expect(next[0].blocks?.[0]).toBe(message.blocks?.[0]);
    expect(next[0].blocks?.[0].a2ui?.state).toEqual(state);
  });

  it("returns the original array and objects when no lock or stale runtime is present", () => {
    const plain: ChatMessage = { role: "assistant", content: "plain" };
    const messages = [plain];

    const next = lockUnverifiedHistoryA2ui(messages);

    expect(next).toBe(messages);
    expect(next[0]).toBe(plain);
  });
});
