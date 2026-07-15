import { describe, expect, it, vi } from "vitest";
import type { ChatMessage, ContentBlock } from "@/views/chat/types";
import type {
  A2uiActionEnvelope,
  A2uiActionIntent,
  A2uiActionResponse,
  A2uiOpenSurface,
} from "@/views/chat/streaming/a2uiContract";
import {
  A2uiTransportError,
  type A2uiActionTransport,
} from "@/views/chat/streaming/a2uiAction";
import { useA2uiInteraction } from "@/views/chat/composables/useA2uiInteraction";

const confirmSurface: A2uiOpenSurface = {
  catalog_version: "v1.0",
  surface_id: "surface-1",
  widget: "confirm",
  props: {
    title: "Continue?",
    confirm_label: "Continue",
    cancel_label: "Cancel",
  },
};

const round2Surface: A2uiOpenSurface = {
  catalog_version: "v1.0",
  surface_id: "surface-2",
  widget: "choice",
  props: {
    title: "Choose one",
    options: [{ id: "a", label: "A" }],
    multiple: false,
  },
};

const confirmIntent: A2uiActionIntent = {
  widget: "confirm",
  payload: { accepted: true },
};

const readyBlocks = (
  surface: A2uiOpenSurface = confirmSurface
): ContentBlock[] => [
  { type: "markdown", authority: "web", text: "before" },
  {
    type: "agent-surface",
    authority: "agent",
    interactive: true,
    a2ui: { surface, state: { status: "ready", round: 1 } },
  },
  { type: "tool", authority: "web", toolName: "search", count: 1 },
];

const event = {
  surfaceId: confirmSurface.surface_id,
  intent: confirmIntent,
};

const terminal = (
  envelope: A2uiActionEnvelope,
  accepted = true
): A2uiActionResponse => ({
  status: "succeeded",
  run_id: envelope.run_id,
  result: {
    a2ui: {
      catalog_version: "v1.0",
      surface_id: envelope.surface_id,
      widget: "confirm",
      props: { status: "submitted", accepted },
    },
  },
});

const inputRequired = (envelope: A2uiActionEnvelope): A2uiActionResponse => ({
  status: "input_required",
  run_id: envelope.run_id,
  interrupt: { draft: { a2ui: round2Surface } },
});

const messageWith = (
  transport: A2uiActionTransport,
  overrides: Partial<ChatMessage> = {}
): ChatMessage => ({
  role: "assistant",
  content: "",
  blocks: readyBlocks(),
  a2uiRuntime: {
    dialogueId: "dialogue-1",
    messageId: "message-1",
    runId: "run-1",
    transport,
  },
  ...overrides,
});

describe("useA2uiInteraction", () => {
  it("reads run and transport from the owning message and enters submitting before await", async () => {
    let resolveTransport!: (response: A2uiActionResponse) => void;
    const transport = vi.fn(
      () =>
        new Promise<A2uiActionResponse>((resolve) => {
          resolveTransport = resolve;
        })
    );
    const buildActionId = vi.fn(() => "action-1");
    const message = messageWith(transport);
    const otherMessage = messageWith(vi.fn(), {
      a2uiRuntime: undefined,
    });
    const { submitAction } = useA2uiInteraction({ buildActionId });

    const pending = submitAction(message, event);

    expect(buildActionId).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledWith({
      surface_id: "surface-1",
      widget: "confirm",
      action_id: "action-1",
      run_id: "run-1",
      payload: { accepted: true },
    });
    expect(message.blocks?.[1].a2ui?.state).toEqual({
      status: "submitting",
      round: 1,
      envelope: {
        surface_id: "surface-1",
        widget: "confirm",
        action_id: "action-1",
        run_id: "run-1",
        payload: { accepted: true },
      },
    });
    expect(otherMessage.blocks).toEqual(readyBlocks());

    const submitting = message.blocks?.[1].a2ui?.state;
    if (!submitting || submitting.status !== "submitting") {
      throw new Error("expected the message-owned surface to be submitting");
    }
    resolveTransport(terminal(submitting.envelope));
    await pending;
  });

  it.each([
    ["runtime", {}],
    ["transport", { a2uiRuntime: { runId: "run-1" } }],
    ["run", { a2uiRuntime: { transport: vi.fn() } }],
  ])(
    "keeps the surface ready when the %s precondition is missing",
    async (_label, overrides) => {
      const buildActionId = vi.fn(() => "should-not-be-used");
      const transport = vi.fn();
      const message = messageWith(transport, {
        a2uiRuntime:
          _label === "runtime"
            ? undefined
            : {
                dialogueId: "dialogue-1",
                messageId: "message-1",
                runId: _label === "run" ? "" : "run-1",
                transport:
                  _label === "transport" ? (undefined as never) : transport,
              },
        ...overrides,
      });
      const { submitAction } = useA2uiInteraction({ buildActionId });

      await submitAction(message, event);

      expect(buildActionId).not.toHaveBeenCalled();
      expect(transport).not.toHaveBeenCalled();
      expect(message.blocks?.[1].a2ui?.state).toEqual({
        status: "ready",
        round: 1,
        lastError: "not_sent",
      });
    }
  );

  it("routes transport failures through reduceA2uiFailure and normalizes unexpected throws", async () => {
    const transportError = new A2uiTransportError(
      "rejected",
      "a2ui_invalid_action",
      422,
      true,
      false
    );
    const rejectedTransport = vi.fn(async () => {
      throw transportError;
    });
    const rejectedMessage = messageWith(rejectedTransport);
    const { submitAction } = useA2uiInteraction({
      buildActionId: () => "action-rejected",
    });

    await submitAction(rejectedMessage, event);

    expect(rejectedMessage.blocks?.[1].a2ui?.state).toEqual({
      status: "rejected",
      round: 1,
      actionId: "action-rejected",
      code: "a2ui_invalid_action",
    });

    const unexpectedTransport = vi.fn(async () => {
      throw new Error("network failed");
    });
    const unexpectedMessage = messageWith(unexpectedTransport);
    await submitAction(unexpectedMessage, event);

    expect(unexpectedMessage.blocks?.[1].a2ui?.state).toEqual({
      status: "unknown",
      round: 1,
      actionId: "action-rejected",
      code: "a2ui_transport_error",
    });
    expect(unexpectedTransport).toHaveBeenCalledTimes(1);
  });

  it("retries a proven temporary rejection with the exact stored envelope and no new ID", async () => {
    const transport = vi
      .fn<A2uiActionTransport>()
      .mockRejectedValueOnce(
        new A2uiTransportError(
          "temporarily_rejected",
          "a2ui_gateway_disabled",
          503,
          false,
          true
        )
      )
      .mockImplementationOnce(async (envelope) => terminal(envelope));
    const buildActionId = vi.fn(() => "action-retry");
    const message = messageWith(transport);
    const { submitAction, retryAction } = useA2uiInteraction({ buildActionId });

    await submitAction(message, event);
    const storedEnvelope = (
      message.blocks?.[1].a2ui?.state as {
        status: "temporarily_rejected";
        envelope: A2uiActionEnvelope;
      }
    ).envelope;

    await retryAction(message, confirmSurface.surface_id);

    expect(buildActionId).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls[1][0]).toBe(storedEnvelope);
    expect(message.blocks?.[1].a2ui?.state).toMatchObject({
      status: "resolved",
      actionId: "action-retry",
    });
  });

  it("dispatches typed succeeded and input_required responses to their reducers", async () => {
    const transport = vi.fn(async (envelope: A2uiActionEnvelope) =>
      terminal(envelope)
    );
    const message = messageWith(transport);
    const { submitAction } = useA2uiInteraction({
      buildActionId: () => "action-success",
    });

    await submitAction(message, event);

    expect(message.blocks?.[1].a2ui?.state).toMatchObject({
      status: "resolved",
      resolution: "submitted",
      actionId: "action-success",
    });

    const inputTransport = vi.fn(async (envelope: A2uiActionEnvelope) =>
      inputRequired(envelope)
    );
    const inputMessage = messageWith(inputTransport);
    await useA2uiInteraction({
      buildActionId: () => "action-input",
    }).submitAction(inputMessage, event);

    expect(inputMessage.blocks?.[1].a2ui?.state).toMatchObject({
      status: "resolved",
      resolution: "advanced",
      actionId: "action-input",
    });
    expect(inputMessage.blocks?.at(-1)?.a2ui?.surface.surface_id).toBe(
      round2Surface.surface_id
    );
  });
});
