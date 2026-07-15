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
