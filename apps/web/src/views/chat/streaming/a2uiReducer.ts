import type { ChatMessage, ContentBlock } from "../types";
import { A2UI_LIMITS } from "./a2uiContract";
import { decodeA2uiOpenSurface } from "./a2uiParse";
import type {
  A2uiActionEnvelope,
  A2uiActionResponse,
  A2uiActionIntent,
  A2uiOpenSurface,
  A2uiSurfaceRuntime,
} from "./a2uiContract";
import type { A2uiTransportError } from "./a2uiAction";

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

export type RetryA2uiResult =
  | { ok: true; blocks: ContentBlock[]; envelope: A2uiActionEnvelope }
  | {
      ok: false;
      blocks: ContentBlock[];
      reason: "retry_not_allowed" | "surface_missing";
    };

/**
 * A runtime identity mismatch is terminal for the local surface.  It is
 * distinct from `not_sent`: the latter means no network request was attempted
 * and the user may still correct a missing runtime, while this branch means a
 * message/runtime tuple was crossed and must never be replayed.
 */
export function markA2uiRuntimeMismatch(
  blocks: ContentBlock[],
  surfaceKey: string,
  code = "runtime_identity_mismatch"
): ContentBlock[] {
  const targetIndex = blocks.findIndex(
    (block) => block.a2ui?.surface.surface_id === surfaceKey
  );
  if (targetIndex < 0) return blocks;

  const target = blocks[targetIndex];
  const runtime = target.a2ui;
  if (
    !runtime ||
    (runtime.state.status !== "ready" &&
      runtime.state.status !== "temporarily_rejected")
  ) {
    return blocks;
  }

  const actionId =
    runtime.state.status === "temporarily_rejected"
      ? runtime.state.envelope.action_id
      : undefined;

  const nextBlocks = blocks.slice();
  nextBlocks[targetIndex] = {
    ...target,
    a2ui: {
      surface: runtime.surface,
      state: {
        status: "protocol_error",
        round: runtime.state.round,
        ...(actionId ? { actionId } : {}),
        code,
      },
    },
  };
  return nextBlocks;
}

/**
 * Close interactive A2UI surfaces restored from persisted history.
 *
 * A history row can contain the last open surface snapshot, but it cannot
 * prove that the Bot still owns the corresponding action/run after reload.
 * Keep terminal states as-is, and only clone the message/block objects whose
 * open state must be changed. Runtime transports are never reconstructed from
 * persisted data; any stale serialized runtime field is removed instead.
 */
export function lockUnverifiedHistoryA2ui(
  messages: ChatMessage[]
): ChatMessage[] {
  let changed = false;
  const nextMessages = messages.map((message) => {
    const blocks = message.blocks;
    let nextBlocks = blocks;
    let blocksChanged = false;

    if (Array.isArray(blocks)) {
      for (let index = 0; index < blocks.length; index += 1) {
        const block = blocks[index];
        const runtime = block.a2ui;
        if (!runtime || !isOpenA2uiSurfaceState(runtime.state.status)) {
          continue;
        }

        const state = runtime.state;
        const actionId =
          state.status === "submitting" ||
          state.status === "temporarily_rejected"
            ? state.envelope.action_id
            : undefined;
        const closedState: A2uiSurfaceRuntime["state"] = {
          status: "expired",
          round: state.round,
          ...(actionId ? { actionId } : {}),
          code: "reload_unverified",
        };

        if (!blocksChanged) {
          nextBlocks = blocks.slice();
          blocksChanged = true;
        }
        if (!nextBlocks) continue;
        nextBlocks[index] = {
          ...block,
          a2ui: {
            surface: runtime.surface,
            state: closedState,
          },
        };
      }
    }

    const hasSerializedRuntime = Object.prototype.hasOwnProperty.call(
      message,
      "a2uiRuntime"
    );
    if (!blocksChanged && !hasSerializedRuntime) return message;

    changed = true;
    const nextMessage: ChatMessage = { ...message };
    if (blocksChanged && nextBlocks) nextMessage.blocks = nextBlocks;
    if (hasSerializedRuntime) delete nextMessage.a2uiRuntime;
    return nextMessage;
  });

  return changed ? nextMessages : messages;
}

export function beginA2uiAction(
  blocks: ContentBlock[],
  surfaceKey: string,
  runId: string,
  intent: A2uiActionIntent,
  actionId: string
): BeginA2uiResult {
  const targetIndex = blocks.findIndex(
    (block) => block.a2ui?.surface.surface_id === surfaceKey
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
 * Fold a transport failure into the submitting surface that owns its action.
 * Only a literal `forwarded=false` and `retryable=true` prove that dispatch did
 * not reach the Bot, so only that combination exposes the original envelope
 * for a manual retry. Every other ambiguous outcome is terminal and unknown.
 */
export function reduceA2uiFailure(
  blocks: ContentBlock[],
  envelope: A2uiActionEnvelope,
  error: A2uiTransportError
): ContentBlock[] {
  const targetIndex = blocks.findIndex((block) => {
    const state = block.a2ui?.state;
    return (
      state?.status === "submitting" &&
      state.envelope.action_id === envelope.action_id &&
      state.envelope.surface_id === envelope.surface_id &&
      state.envelope.widget === envelope.widget &&
      state.envelope.run_id === envelope.run_id
    );
  });

  // A late failure cannot safely change a resolved, expired, or otherwise
  // non-submitting surface. Keeping the same array also preserves idempotency.
  if (targetIndex < 0) return blocks;

  const target = blocks[targetIndex];
  const runtime = target.a2ui;
  if (!runtime || runtime.state.status !== "submitting") return blocks;

  const submitting = runtime.state;
  const actionId = submitting.envelope.action_id;
  const nextState: A2uiSurfaceRuntime["state"] =
    error.kind === "rejected"
      ? {
          status: "rejected",
          round: submitting.round,
          actionId,
          code: error.code,
        }
      : error.kind === "temporarily_rejected" &&
          error.forwarded === false &&
          error.retryable === true
        ? {
            status: "temporarily_rejected",
            round: submitting.round,
            envelope: submitting.envelope,
            code: error.code,
          }
        : error.kind === "expired"
          ? {
              status: "expired",
              round: submitting.round,
              actionId,
              code: error.code,
            }
          : {
              status: "unknown",
              round: submitting.round,
              actionId,
              code: error.code,
            };

  const nextBlocks = blocks.slice();
  nextBlocks[targetIndex] = {
    ...target,
    a2ui: {
      surface: runtime.surface,
      state: nextState,
    },
  };
  return nextBlocks;
}

/**
 * Record a local precondition failure that prevented transport dispatch.
 * The surface remains ready and can be submitted again by the caller.
 */
export function markA2uiNotSent(
  blocks: ContentBlock[],
  surfaceKey: string
): ContentBlock[] {
  const targetIndex = blocks.findIndex(
    (block) => block.a2ui?.surface.surface_id === surfaceKey
  );
  if (targetIndex < 0) return blocks;

  const target = blocks[targetIndex];
  const runtime = target.a2ui;
  if (!runtime || runtime.state.status !== "ready") return blocks;

  const nextBlocks = blocks.slice();
  nextBlocks[targetIndex] = {
    ...target,
    a2ui: {
      surface: runtime.surface,
      state: {
        status: "ready",
        round: runtime.state.round,
        lastError: "not_sent",
      },
    },
  };
  return nextBlocks;
}

/**
 * Re-enter submitting only for a proven pre-dispatch rejection. The stored
 * envelope is returned unchanged so retries retain the original action ID and
 * payload; no new ID, delay, or retry counter is introduced here.
 */
export function beginA2uiRetry(
  blocks: ContentBlock[],
  surfaceKey: string
): RetryA2uiResult {
  const targetIndex = blocks.findIndex(
    (block) => block.a2ui?.surface.surface_id === surfaceKey
  );
  if (targetIndex < 0) {
    return { ok: false, reason: "surface_missing", blocks };
  }

  const target = blocks[targetIndex];
  const runtime = target.a2ui;
  if (!runtime || runtime.state.status !== "temporarily_rejected") {
    return { ok: false, reason: "retry_not_allowed", blocks };
  }

  const envelope = runtime.state.envelope;
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
  response: Extract<A2uiActionResponse, { status: "succeeded" }>
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
    terminal
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

/**
 * Fold one decoded intermediate response into its submitting surface.
 *
 * An input-required response contains no terminal projection for the old
 * widget.  Its only authoritative result is the fresh draft surface, so the
 * old surface is resolved generically as `advanced` and the new surface is
 * opened as round two.  A second pause is a protocol violation: the contract
 * permits at most two interaction rounds per message.
 */
export function reduceA2uiInputRequired(
  blocks: ContentBlock[],
  envelope: A2uiActionEnvelope,
  response: Extract<A2uiActionResponse, { status: "input_required" }>
): ContentBlock[] {
  const targetIndex = findInputRequiredTarget(blocks, envelope);
  if (targetIndex < 0) return blocks;

  const target = blocks[targetIndex];
  const runtime = target.a2ui;
  if (!runtime) return blocks;

  const state = runtime.state;
  if (state.status !== "submitting") {
    // A replay after a valid transition sees the old surface resolved and the
    // new one ready.  Neither state still owns the action, so it is idempotent.
    if (state.status === "resolved" || state.status === "protocol_error") {
      return blocks;
    }
    return markInputRequiredProtocolError(
      blocks,
      targetIndex,
      runtime,
      envelope.action_id,
      "target_missing"
    );
  }

  const protocolCode = getA2uiInputRequiredProtocolCode(
    runtime.surface,
    state.envelope,
    envelope,
    response.run_id
  );
  if (protocolCode) {
    return markInputRequiredProtocolError(
      blocks,
      targetIndex,
      runtime,
      envelope.action_id,
      protocolCode
    );
  }

  if (state.round !== 1) {
    return markInputRequiredProtocolError(
      blocks,
      targetIndex,
      runtime,
      envelope.action_id,
      "round_exhausted"
    );
  }

  // A run may have exactly one open surface while an input-required response
  // is in flight.  If a second ready, submitting, or manually retryable
  // surface remains in the message, the response is ambiguous: do not close
  // or advance either surface whose ownership is not proven.
  const openSurfaceCount = blocks.reduce(
    (count, block) =>
      count + (isOpenA2uiSurfaceState(block.a2ui?.state.status) ? 1 : 0),
    0
  );
  if (openSurfaceCount > 1) {
    return markInputRequiredProtocolError(
      blocks,
      targetIndex,
      runtime,
      envelope.action_id,
      "multiple_open_surfaces"
    );
  }

  const decoded = decodeA2uiOpenSurface(response.interrupt?.draft?.a2ui);
  if (!decoded.ok) {
    return markInputRequiredProtocolError(
      blocks,
      targetIndex,
      runtime,
      envelope.action_id,
      "surface_invalid"
    );
  }

  const nextSurface = decoded.value;
  if (nextSurface.surface_id === runtime.surface.surface_id) {
    return markInputRequiredProtocolError(
      blocks,
      targetIndex,
      runtime,
      envelope.action_id,
      "surface_reused"
    );
  }

  if (hasSurfaceIdentity(blocks, nextSurface.surface_id)) {
    return markInputRequiredProtocolError(
      blocks,
      targetIndex,
      runtime,
      envelope.action_id,
      "surface_duplicate"
    );
  }

  const nextBlocks = blocks.slice();
  nextBlocks[targetIndex] = {
    ...target,
    a2ui: {
      surface: runtime.surface,
      state: {
        status: "resolved",
        round: state.round,
        actionId: envelope.action_id,
        resolution: "advanced",
      },
    },
  };
  nextBlocks.push({
    type: "agent-surface",
    authority: "agent",
    interactive: true,
    a2ui: {
      surface: nextSurface,
      state: { status: "ready", round: 2 },
    },
  });
  return nextBlocks;
}

function findInputRequiredTarget(
  blocks: ContentBlock[],
  envelope: A2uiActionEnvelope
): number {
  const actionIndex = blocks.findIndex((block) => {
    const state = block.a2ui?.state;
    return (
      state?.status === "submitting" &&
      state.envelope.action_id === envelope.action_id
    );
  });
  if (actionIndex >= 0) return actionIndex;

  // If the caller still points at the original surface but its submitting
  // action cannot be found, retain a visible protocol error on that surface.
  // Do not use resolved/protocol-error surfaces as fallbacks: this keeps a
  // duplicate response a strict no-op.
  return blocks.findIndex((block) => {
    const runtime = block.a2ui;
    return (
      runtime?.surface.surface_id === envelope.surface_id &&
      (runtime.state.status === "submitting" ||
        runtime.state.status === "ready")
    );
  });
}

function getA2uiInputRequiredProtocolCode(
  openSurface: { surface_id: string; widget: string },
  submitting: A2uiActionEnvelope,
  envelope: A2uiActionEnvelope,
  responseRunId: string
): string | undefined {
  if (submitting.action_id !== envelope.action_id) return "action_mismatch";
  if (submitting.run_id !== envelope.run_id) return "run_id_mismatch";
  if (responseRunId !== envelope.run_id) return "run_id_mismatch";
  if (
    openSurface.surface_id !== envelope.surface_id ||
    submitting.surface_id !== envelope.surface_id
  ) {
    return "surface_mismatch";
  }
  if (
    openSurface.widget !== envelope.widget ||
    submitting.widget !== envelope.widget
  ) {
    return "widget_mismatch";
  }
  return undefined;
}

function hasSurfaceIdentity(
  blocks: ContentBlock[],
  surfaceKey: string
): boolean {
  return blocks.some((block) => block.a2ui?.surface.surface_id === surfaceKey);
}

function isOpenA2uiSurfaceState(status: string | undefined): boolean {
  return (
    status === "ready" ||
    status === "submitting" ||
    status === "temporarily_rejected"
  );
}

function markInputRequiredProtocolError(
  blocks: ContentBlock[],
  targetIndex: number,
  runtime: {
    surface: A2uiOpenSurface;
    state: { round: 1 | 2 };
  },
  actionId: string,
  code: string
): ContentBlock[] {
  const target = blocks[targetIndex];
  const nextBlocks = blocks.slice();
  nextBlocks[targetIndex] = {
    ...target,
    a2ui: {
      surface: runtime.surface,
      state: {
        status: "protocol_error",
        round: runtime.state.round,
        actionId,
        code,
      },
    },
  };
  return nextBlocks;
}

function getA2uiResolution(
  terminal: Extract<
    A2uiActionResponse,
    { status: "succeeded" }
  >["result"]["a2ui"]
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
  terminal:
    | Extract<A2uiActionResponse, { status: "succeeded" }>["result"]["a2ui"]
    | undefined
): string | undefined {
  if (
    submitting.action_id !== envelope.action_id ||
    submitting.run_id !== envelope.run_id
  ) {
    return "action_mismatch";
  }
  if (
    responseRunId !== envelope.run_id ||
    submitting.run_id !== envelope.run_id
  ) {
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
