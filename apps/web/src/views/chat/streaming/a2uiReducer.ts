import type { ContentBlock } from "../types";
import type {
  A2uiActionEnvelope,
  A2uiActionIntent,
} from "./a2uiContract";

export type BeginA2uiResult =
  | { ok: true; blocks: ContentBlock[]; envelope: A2uiActionEnvelope }
  | {
      ok: false;
      reason:
        | "surface_missing"
        | "surface_not_ready"
        | "run_missing"
        | "intent_mismatch"
        | "action_id_invalid";
      blocks: ContentBlock[];
    };

export function beginA2uiAction(
  blocks: ContentBlock[],
  surfaceId: string,
  runId: string,
  intent: A2uiActionIntent,
  actionId: string,
): BeginA2uiResult {
  const targetIndex = blocks.findIndex(
    (block) => block.a2ui?.surface.surface_id === surfaceId,
  );
  if (targetIndex < 0) {
    return { ok: false, reason: "surface_missing", blocks };
  }

  const target = blocks[targetIndex];
  const runtime = target.a2ui;
  if (!runtime || runtime.state.status !== "ready") {
    return { ok: false, reason: "surface_not_ready", blocks };
  }
  if (typeof runId !== "string" || runId.trim() === "") {
    return { ok: false, reason: "run_missing", blocks };
  }
  if (!intent || intent.widget !== runtime.surface.widget) {
    return { ok: false, reason: "intent_mismatch", blocks };
  }
  if (typeof actionId !== "string" || actionId.trim() === "") {
    return { ok: false, reason: "action_id_invalid", blocks };
  }

  const envelope: A2uiActionEnvelope = {
    surface_id: runtime.surface.surface_id,
    widget: runtime.surface.widget,
    action_id: actionId,
    run_id: runId,
    payload: intent.payload,
  };
  const nextBlocks = blocks.slice();
  nextBlocks[targetIndex] = {
    ...target,
    a2ui: {
      surface: runtime.surface,
      state: {
        status: "submitting",
        round: runtime.state.round,
        envelope,
      },
    },
  };
  return { ok: true, blocks: nextBlocks, envelope };
}
