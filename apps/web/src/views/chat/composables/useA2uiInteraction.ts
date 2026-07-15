import type { ChatMessage } from "../types";
import {
  A2uiTransportError,
  buildA2uiActionId,
  type A2uiActionTransport,
} from "../streaming/a2uiAction";
import {
  beginA2uiAction,
  beginA2uiRetry,
  markA2uiNotSent,
  reduceA2uiFailure,
  reduceA2uiInputRequired,
  reduceA2uiSucceeded,
} from "../streaming/a2uiReducer";
import type {
  A2uiActionEnvelope,
  A2uiActionIntent,
  A2uiActionResponse,
} from "../streaming/a2uiContract";

const UNEXPECTED_TRANSPORT_ERROR_CODE = "a2ui_transport_error";

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

async function dispatchTransport(
  message: ChatMessage,
  capturedRuntime: NonNullable<ChatMessage["a2uiRuntime"]>,
  transport: A2uiActionTransport,
  envelope: A2uiActionEnvelope
): Promise<void> {
  const runtimeChanged = (): boolean =>
    message.a2uiRuntime !== capturedRuntime ||
    capturedRuntime.runId !== envelope.run_id;
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
    case "succeeded":
      message.blocks = reduceA2uiSucceeded(
        message.blocks ?? [],
        envelope,
        response
      );
      return;
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
