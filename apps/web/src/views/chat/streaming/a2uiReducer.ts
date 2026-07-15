import type { ContentBlock } from "../types";
import { A2UI_LIMITS } from "./a2uiContract";
import type {
  A2uiActionEnvelope,
  A2uiActionResponse,
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

/**
 * Fold one decoded terminal response into the submitting surface that owns its
 * action. A terminal response is applied only while that action is still
 * submitting; replaying an already-resolved response is therefore a no-op.
 */
export function reduceA2uiSucceeded(
  blocks: ContentBlock[],
  envelope: A2uiActionEnvelope,
  response: Extract<A2uiActionResponse, { status: "succeeded" }>,
): ContentBlock[] {
  const targetIndex = blocks.findIndex((block) => {
    const state = block.a2ui?.state;
    return (
      state?.status === "submitting" &&
      state.envelope.action_id === envelope.action_id
    );
  });

  // A response for an already-applied, expired, or otherwise absent action is
  // stale. There is no submitting surface we can safely mutate in that case.
  if (targetIndex < 0) return blocks;

  const target = blocks[targetIndex];
  const runtime = target.a2ui;
  if (!runtime || runtime.state.status !== "submitting") return blocks;

  const submitting = runtime.state;
  const terminal = response.result?.a2ui;
  const protocolCode = getA2uiTerminalProtocolCode(
    runtime.surface,
    submitting.envelope,
    envelope,
    response.run_id,
    terminal,
  );
  if (protocolCode) {
    const nextBlocks = blocks.slice();
    nextBlocks[targetIndex] = {
      ...target,
      a2ui: {
        surface: runtime.surface,
        state: {
          status: "protocol_error",
          round: submitting.round,
          actionId: envelope.action_id,
          code: protocolCode,
        },
      },
    };
    return nextBlocks;
  }

  // `getA2uiTerminalProtocolCode` guarantees a decoded terminal surface here;
  // retain the guard for callers that bypass the decoder at runtime.
  if (!terminal) return blocks;

  const resolution = getA2uiResolution(terminal);
  const nextBlocks = blocks.slice();
  nextBlocks[targetIndex] = {
    ...target,
    a2ui: {
      // The open surface remains the display contract. The Bot terminal object
      // is authoritative state only, since form fields may be a value map.
      surface: runtime.surface,
      state: {
        status: "resolved",
        round: submitting.round,
        actionId: envelope.action_id,
        resolution,
        snapshot: terminal,
      },
    },
  };

  const answer = response.result?.formatted?.answer;
  if (
    typeof answer === "string" &&
    answer.trim().length > 0 &&
    answer.length <= A2UI_LIMITS.textChars &&
    !nextBlocks.some((block) => block.sourceActionId === envelope.action_id)
  ) {
    // Keep MarkdownBlock as the only answer rendering path. This block carries
    // the request action id so a replay cannot append another answer.
    nextBlocks.push({
      type: "markdown",
      authority: "agent",
      text: answer,
      sourceActionId: envelope.action_id,
    });
  }

  return nextBlocks;
}

function getA2uiResolution(
  terminal: Extract<
    A2uiActionResponse,
    { status: "succeeded" }
  >["result"]["a2ui"],
): "submitted" | "cancelled" | "rejected" {
  if (terminal.widget === "confirm") {
    return terminal.props.accepted ? "submitted" : "rejected";
  }
  return terminal.props.cancelled === true ? "cancelled" : "submitted";
}

function getA2uiTerminalProtocolCode(
  openSurface: {
    surface_id: string;
    widget: string;
  },
  submitting: A2uiActionEnvelope,
  envelope: A2uiActionEnvelope,
  responseRunId: string,
  terminal: Extract<
    A2uiActionResponse,
    { status: "succeeded" }
  >["result"]["a2ui"] | undefined,
): string | undefined {
  if (
    submitting.action_id !== envelope.action_id ||
    submitting.run_id !== envelope.run_id
  ) {
    return "action_mismatch";
  }
  if (responseRunId !== envelope.run_id || submitting.run_id !== envelope.run_id) {
    return "run_id_mismatch";
  }
  if (
    openSurface.surface_id !== envelope.surface_id ||
    submitting.surface_id !== envelope.surface_id ||
    !terminal ||
    terminal.surface_id !== envelope.surface_id
  ) {
    return "surface_mismatch";
  }
  if (
    openSurface.widget !== envelope.widget ||
    submitting.widget !== envelope.widget ||
    terminal.widget !== envelope.widget
  ) {
    return "widget_mismatch";
  }
  return undefined;
}
