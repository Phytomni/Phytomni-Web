import type { ChatMessage, ContentBlock } from "../types";
import {
  A2uiTransportError,
  buildA2uiActionId,
  type A2uiActionTransport,
} from "../streaming/a2uiAction";
import {
  beginA2uiAction,
  beginA2uiRetry,
  markA2uiNotSent,
  markA2uiRuntimeMismatch,
  reduceA2uiFailure,
  reduceA2uiInputRequired,
  reduceA2uiSucceeded,
} from "../streaming/a2uiReducer";
import type {
  A2uiActionEnvelope,
  A2uiActionIntent,
  A2uiActionResponse,
} from "../streaming/a2uiContract";
import { decodeCitationDocuments } from "../utils/format";

const UNEXPECTED_TRANSPORT_ERROR_CODE = "a2ui_transport_error";
const SAFE_RUNTIME_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;

export interface A2uiSurfaceActionEvent {
  surfaceId: string;
  intent: A2uiActionIntent;
}

export interface A2uiInteractionOptions {
  buildActionId?: () => string;
}

function normalizeUnexpectedError(error: unknown): A2uiTransportError {
  if (error instanceof A2uiTransportError) return error;
  return new A2uiTransportError(
    "unknown",
    UNEXPECTED_TRANSPORT_ERROR_CODE,
    undefined,
    true,
    false
  );
}

function ownsSubmittingAction(
  message: ChatMessage,
  envelope: A2uiActionEnvelope
): boolean {
  return Boolean(
    message.blocks?.some(
      (block) =>
        block.a2ui?.state.status === "submitting" &&
        block.a2ui.state.envelope.action_id === envelope.action_id
    )
  );
}

function resolvedActionApplied(
  blocks: readonly ContentBlock[],
  envelope: A2uiActionEnvelope
): boolean {
  return blocks.some((block) => {
    const runtime = block.a2ui;
    const state = runtime?.state;
    return (
      runtime?.surface.surface_id === envelope.surface_id &&
      state?.status === "resolved" &&
      state.actionId === envelope.action_id
    );
  });
}

function convergeReviewTerminalMessage(
  message: ChatMessage,
  envelope: A2uiActionEnvelope,
  response: Extract<A2uiActionResponse, { status: "succeeded" }>,
  nextBlocks: readonly ContentBlock[]
): boolean {
  const formatted = response.result.formatted;
  const answer = formatted?.answer;
  if (
    message.tool_name !== "ReviewAgent" ||
    typeof answer !== "string" ||
    answer.trim() === "" ||
    !resolvedActionApplied(nextBlocks, envelope)
  ) {
    return false;
  }

  const followUpQuestions = [...(formatted?.follow_up_questions ?? [])];
  message.content = answer;
  message.doc_list = decodeCitationDocuments(formatted?.references) ?? [];
  message.followUpQuestions = followUpQuestions;
  message.showFollowUpQuestions = followUpQuestions.length > 0;
  message.status = "SUCCEEDED";
  message.blocks = undefined;
  message.a2uiRuntime = undefined;
  return true;
}

function optionalMessageIdentity(
  message: ChatMessage,
  keys: readonly string[]
): string | undefined {
  const record = message as unknown as Record<string, unknown>;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
    const value = record[key];
    return typeof value === "string" ? value.trim() : undefined;
  }
  return undefined;
}

/**
 * Runtime context is message-owned.  A context copied from another message or
 * dialogue must not be allowed to dispatch an action, even when its transport
 * function happens to still be callable.
 */
function runtimeOwnsMessage(
  message: ChatMessage,
  runtime: NonNullable<ChatMessage["a2uiRuntime"]>
): boolean {
  if (
    !SAFE_RUNTIME_ID_PATTERN.test(runtime.dialogueId) ||
    !SAFE_RUNTIME_ID_PATTERN.test(runtime.messageId) ||
    !SAFE_RUNTIME_ID_PATTERN.test(runtime.runId)
  ) {
    return false;
  }

  if (typeof message.id === "string" && message.id.trim() !== "") {
    if (message.id.trim() !== runtime.messageId) return false;
  }

  const declaredDialogue = optionalMessageIdentity(message, [
    "dialogue_id",
    "dialogueId",
  ]);
  return (
    declaredDialogue === undefined || declaredDialogue === runtime.dialogueId
  );
}

async function dispatchTransport(
  message: ChatMessage,
  capturedRuntime: NonNullable<ChatMessage["a2uiRuntime"]>,
  transport: A2uiActionTransport,
  envelope: A2uiActionEnvelope
): Promise<void> {
  const capturedIdentity = {
    dialogueId: capturedRuntime.dialogueId,
    messageId: capturedRuntime.messageId,
    runId: capturedRuntime.runId,
  };
  const runtimeChanged = (): boolean =>
    message.a2uiRuntime !== capturedRuntime ||
    capturedRuntime.dialogueId !== capturedIdentity.dialogueId ||
    capturedRuntime.messageId !== capturedIdentity.messageId ||
    capturedRuntime.runId !== capturedIdentity.runId ||
    capturedRuntime.runId !== envelope.run_id ||
    !runtimeOwnsMessage(message, capturedRuntime);
  let response: A2uiActionResponse;
  try {
    response = await transport(envelope);
  } catch (error) {
    message.blocks = reduceA2uiFailure(
      message.blocks ?? [],
      envelope,
      runtimeChanged()
        ? new A2uiTransportError(
            "unknown",
            "runtime_changed",
            undefined,
            true,
            false
          )
        : normalizeUnexpectedError(error)
    );
    return;
  }

  if (runtimeChanged()) {
    message.blocks = reduceA2uiFailure(
      message.blocks ?? [],
      envelope,
      new A2uiTransportError(
        "unknown",
        "runtime_changed",
        undefined,
        true,
        false
      )
    );
    return;
  }

  if (!ownsSubmittingAction(message, envelope)) return;

  switch (response.status) {
    case "succeeded": {
      const nextBlocks = reduceA2uiSucceeded(
        message.blocks ?? [],
        envelope,
        response
      );
      message.blocks = nextBlocks;
      convergeReviewTerminalMessage(message, envelope, response, nextBlocks);
      return;
    }
    case "input_required":
      message.blocks = reduceA2uiInputRequired(
        message.blocks ?? [],
        envelope,
        response
      );
      return;
  }
}

export function useA2uiInteraction(options: A2uiInteractionOptions = {}): {
  submitAction: (
    message: ChatMessage,
    event: A2uiSurfaceActionEvent
  ) => Promise<void>;
  retryAction: (message: ChatMessage, surfaceId: string) => Promise<void>;
} {
  const buildActionId = options.buildActionId ?? buildA2uiActionId;

  const submitAction = async (
    message: ChatMessage,
    event: A2uiSurfaceActionEvent
  ): Promise<void> => {
    const runtime = message.a2uiRuntime;
    const runId = runtime?.runId;
    const transport = runtime?.transport;

    if (runtime && !runtimeOwnsMessage(message, runtime)) {
      message.blocks = markA2uiRuntimeMismatch(
        message.blocks ?? [],
        event.surfaceId
      );
      return;
    }

    if (
      !runtime ||
      typeof runId !== "string" ||
      runId.trim() === "" ||
      typeof transport !== "function"
    ) {
      message.blocks = markA2uiNotSent(message.blocks ?? [], event.surfaceId);
      return;
    }

    const begun = beginA2uiAction(
      message.blocks ?? [],
      event.surfaceId,
      runId,
      event.intent,
      buildActionId()
    );
    message.blocks = begun.blocks;
    if (!begun.ok) return;

    await dispatchTransport(message, runtime, transport, begun.envelope);
  };

  const retryAction = async (
    message: ChatMessage,
    surfaceId: string
  ): Promise<void> => {
    const runtime = message.a2uiRuntime;
    const transport = runtime?.transport;
    if (runtime && !runtimeOwnsMessage(message, runtime)) {
      message.blocks = markA2uiRuntimeMismatch(message.blocks ?? [], surfaceId);
      return;
    }
    if (!runtime || typeof transport !== "function") {
      message.blocks = markA2uiNotSent(message.blocks ?? [], surfaceId);
      return;
    }

    const begun = beginA2uiRetry(message.blocks ?? [], surfaceId);
    message.blocks = begun.blocks;
    if (!begun.ok) return;

    await dispatchTransport(message, runtime, transport, begun.envelope);
  };

  return { submitAction, retryAction };
}
