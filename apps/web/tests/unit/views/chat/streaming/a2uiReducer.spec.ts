import { describe, expect, it } from "vitest";
import type {
  A2uiActionIntent,
  A2uiOpenSurface,
} from "@/views/chat/streaming/a2uiContract";
import { beginA2uiAction } from "@/views/chat/streaming/a2uiReducer";
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

const readyBlock = (overrides: Partial<ContentBlock> = {}): ContentBlock => ({
  type: "agent-surface",
  authority: "agent",
  interactive: true,
  surfaceId: surface.surface_id,
  widget: surface.widget,
  props: surface.props,
  a2ui: { surface, state: { status: "ready", round: 1 } },
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
