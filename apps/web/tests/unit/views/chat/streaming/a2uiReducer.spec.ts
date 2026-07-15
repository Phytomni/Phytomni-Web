import { describe, expect, it } from "vitest";
import type {
  A2uiActionEnvelope,
  A2uiActionResponse,
  A2uiActionIntent,
  A2uiOpenSurface,
  A2uiTerminalSurface,
} from "@/views/chat/streaming/a2uiContract";
import { A2UI_LIMITS } from "@/views/chat/streaming/a2uiContract";
import {
  beginA2uiAction,
  reduceA2uiInputRequired,
  reduceA2uiSucceeded,
} from "@/views/chat/streaming/a2uiReducer";
import type { ContentBlock } from "@/views/chat/types";

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
  openSurface: A2uiOpenSurface = surface,
): ContentBlock => ({
  type: "agent-surface",
  authority: "agent",
  interactive: true,
  surfaceId: openSurface.surface_id,
  widget: openSurface.widget,
  props: openSurface.props,
  a2ui: { surface: openSurface, state: { status: "ready", round: 1 } },
  ...overrides,
});

const blocksWithTarget = (target: ContentBlock = readyBlock()): ContentBlock[] => [
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

type SucceededResponse = Extract<
  A2uiActionResponse,
  { status: "succeeded" }
>;

type InputRequiredResponse = Extract<
  A2uiActionResponse,
  { status: "input_required" }
>;

const terminalConfirm = (
  surfaceId: string,
  accepted: boolean,
): A2uiTerminalSurface => ({
  catalog_version: "v1.0",
  surface_id: surfaceId,
  widget: "confirm",
  props: { status: "submitted", accepted },
});

const terminalForm = (
  surfaceId: string,
  fields: Record<string, string>,
  cancelled = false,
): A2uiTerminalSurface => ({
  catalog_version: "v1.0",
  surface_id: surfaceId,
  widget: "form",
  props: {
    status: "submitted",
    fields,
    ...(cancelled ? { cancelled: true as const } : {}),
  },
});

const terminalChoice = (
  surfaceId: string,
  selected: string | string[] | undefined,
  cancelled = false,
): A2uiTerminalSurface => ({
  catalog_version: "v1.0",
  surface_id: surfaceId,
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
  actionId = "action-1",
): { blocks: ContentBlock[]; envelope: A2uiActionEnvelope } => {
  const result = beginA2uiAction(
    blocksWithTarget(readyBlock({}, openSurface)),
    openSurface.surface_id,
    "run-9",
    intent,
    actionId,
  );
  if (!result.ok) throw new Error(`expected begin to succeed: ${result.reason}`);
  return result;
};

const succeeded = (
  envelope: A2uiActionEnvelope,
  a2ui: A2uiTerminalSurface,
  answer?: string,
  runId = envelope.run_id,
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
  runId = envelope.run_id,
): InputRequiredResponse => ({
  status: "input_required",
  run_id: runId,
  interrupt: { draft: { a2ui } },
});

describe("beginA2uiAction", () => {
  it("synchronously submits the matching ready surface and returns the envelope", () => {
    const blocks = blocksWithTarget();

    const result = beginA2uiAction(
      blocks,
      "surface-1",
      "run-9",
      confirmIntent,
      "action-1",
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
      "action-1",
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
      "action-1",
    );
    if (!first.ok) throw new Error("expected first begin to succeed");

    const before = structuredClone(first.blocks);
    const second = beginA2uiAction(
      first.blocks,
      "surface-1",
      "run-9",
      confirmIntent,
      "action-2",
    );

    expect(second).toEqual({
      ok: false,
      reason: "surface_not_ready",
      blocks: first.blocks,
    });
    expect(first.blocks).toEqual(before);
  });

  it.each([
    ["wrong widget", "intent_mismatch", "run-9", confirmIntent, "action-1", "surface-1"],
    ["missing run ID", "run_missing", "", confirmIntent, "action-1", "surface-1"],
    ["blank action ID", "action_id_invalid", "run-9", confirmIntent, "  ", "surface-1"],
    ["missing surface", "surface_missing", "run-9", confirmIntent, "action-1", "missing"],
  ] as const)("returns a fixed reason for %s without mutation", (_label, reason, runId, intent, actionId, surfaceId) => {
    const blocks = blocksWithTarget();
    const original = structuredClone(blocks);
    const mismatchedIntent: A2uiActionIntent = {
      widget: "form",
      payload: { cancelled: true },
    };

    const result = beginA2uiAction(
      blocks,
      surfaceId,
      runId,
      reason === "intent_mismatch" ? mismatchedIntent : intent,
      actionId,
    );

    expect(result).toEqual({ ok: false, reason, blocks });
    expect(blocks).toEqual(original);
  });

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
      "action-1",
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
  ] as const)("resolves %s from the authoritative terminal snapshot", (
    _label,
    openSurface,
    intent,
    terminal,
    resolution,
  ) => {
    const { blocks, envelope } = beginSubmitting(openSurface, intent);
    const next = reduceA2uiSucceeded(
      blocks,
      envelope,
      succeeded(envelope, terminal, "Analysis complete."),
    );

    expect(next).not.toBe(blocks);
    expect(next[0]).toBe(blocks[0]);
    expect(next[2]).toBe(blocks[2]);
    expect(next[1]).not.toBe(blocks[1]);
    expect(next[1].props).toBe(openSurface.props);
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
  });

  it("applies a terminal response exactly once and does not duplicate its answer", () => {
    const { blocks, envelope } = beginSubmitting(surface, confirmIntent);
    const response = succeeded(
      envelope,
      terminalConfirm(surface.surface_id, true),
      "Analysis complete.",
    );

    const first = reduceA2uiSucceeded(blocks, envelope, response);
    const replay = reduceA2uiSucceeded(first, envelope, response);

    expect(replay).toBe(first);
    expect(
      replay.filter((block) => block.sourceActionId === envelope.action_id),
    ).toHaveLength(1);
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
  ] as const)("marks the submitting surface protocol_error for %s", (
    _label,
    terminal,
    runId,
    code,
  ) => {
    const { blocks, envelope } = beginSubmitting(surface, confirmIntent);
    const next = reduceA2uiSucceeded(
      blocks,
      envelope,
      succeeded(envelope, terminal, "should not append", runId ?? undefined),
    );

    expect(next[1].a2ui?.state).toEqual({
      status: "protocol_error",
      round: 1,
      actionId: envelope.action_id,
      code,
    });
    expect(next).toHaveLength(blocks.length);
    expect(next.some((block) => block.sourceActionId === envelope.action_id)).toBe(
      false,
    );
  });

  it("ignores a response when its action is already applied or is no longer submitting", () => {
    const { blocks, envelope } = beginSubmitting(surface, confirmIntent);
    const response = succeeded(
      envelope,
      terminalConfirm(surface.surface_id, true),
      "Analysis complete.",
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
        succeeded(envelope, terminalConfirm(surface.surface_id, true), answer),
      );

      expect(next).toHaveLength(blocks.length);
      expect(next.some((block) => block.sourceActionId === envelope.action_id)).toBe(
        false,
      );
    },
  );
});

describe("reduceA2uiInputRequired", () => {
  const round2Surface: A2uiOpenSurface = {
    ...choiceSurface,
    surface_id: "surface-2",
  };

  it("advances round 1 and appends a fresh ready round-2 surface", () => {
    const { blocks, envelope } = beginSubmitting(surface, confirmIntent);
    const original = structuredClone(blocks);

    const next = reduceA2uiInputRequired(
      blocks,
      envelope,
      inputRequired(envelope, round2Surface),
    );

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
      surfaceId: round2Surface.surface_id,
      widget: round2Surface.widget,
      props: round2Surface.props,
      a2ui: {
        surface: round2Surface,
        state: { status: "ready", round: 2 },
      },
    });
    expect(blocks).toEqual(original);
  });

  it.each([
    ["reused surface", surface, "surface_reused"],
    ["mismatched run", round2Surface, "run_id_mismatch"],
    [
      "malformed surface",
      { ...round2Surface, widget: "slider" },
      "surface_invalid",
    ],
  ] as const)("marks the submitting target protocol_error for %s", (
    _label,
    nextSurface,
    code,
  ) => {
    const { blocks, envelope } = beginSubmitting(surface, confirmIntent);
    const response = inputRequired(
      envelope,
      nextSurface as A2uiOpenSurface,
      code === "run_id_mismatch" ? "other-run" : envelope.run_id,
    );

    const next = reduceA2uiInputRequired(blocks, envelope, response);

    expect(next[1].a2ui?.state).toEqual({
      status: "protocol_error",
      round: 1,
      actionId: envelope.action_id,
      code,
    });
    expect(next).toHaveLength(blocks.length);
  });

  it("rejects a fresh surface whose identity is already present elsewhere", () => {
    const { blocks, envelope } = beginSubmitting(surface, confirmIntent);
    const duplicate = readyBlock({}, round2Surface);
    const withDuplicate = [...blocks, duplicate];

    const next = reduceA2uiInputRequired(
      withDuplicate,
      envelope,
      inputRequired(envelope, round2Surface),
    );

    expect(next[1].a2ui?.state).toMatchObject({
      status: "protocol_error",
      code: "surface_duplicate",
    });
    expect(next).toHaveLength(withDuplicate.length);
    expect(next.at(-1)).toBe(duplicate);
  });

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
      inputRequired(envelope, round2Surface),
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
      inputRequired(first.envelope, round2Surface),
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
      "action-2",
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
      } as A2uiOpenSurface),
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
        (block) => block.a2ui?.surface.surface_id === round2Surface.surface_id,
      ),
    ).toHaveLength(1);
  });
});
