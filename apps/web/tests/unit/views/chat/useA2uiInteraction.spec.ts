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
  accepted = true,
  answer?: string
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
    ...(answer === undefined ? {} : { formatted: { answer } }),
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

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

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

  it("refuses a runtime copied to a different message or dialogue", async () => {
    const transport = vi.fn(async (envelope: A2uiActionEnvelope) =>
      terminal(envelope)
    );
    const message = messageWith(transport) as ChatMessage & {
      dialogue_id: string;
    };
    message.id = "message-local";
    message.dialogue_id = "dialogue-local";
    message.a2uiRuntime = {
      dialogueId: "dialogue-foreign",
      messageId: "message-foreign",
      runId: "run-foreign",
      transport,
    };

    const { submitAction } = useA2uiInteraction({
      buildActionId: () => "action-foreign",
    });
    await submitAction(message, event);

    expect(transport).not.toHaveBeenCalled();
    expect(message.blocks?.[1].a2ui?.state).toEqual({
      status: "protocol_error",
      round: 1,
      code: "runtime_identity_mismatch",
    });
  });

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

    expect(inputTransport).toHaveBeenCalledTimes(1);
    expect(inputMessage.blocks?.[1].a2ui?.state).toMatchObject({
      status: "resolved",
      resolution: "advanced",
      actionId: "action-input",
    });
    expect(inputMessage.blocks?.at(-1)?.a2ui?.surface.surface_id).toBe(
      round2Surface.surface_id
    );
    expect(
      inputMessage.blocks?.filter((block) =>
        ["ready", "submitting", "temporarily_rejected"].includes(
          block.a2ui?.state.status ?? ""
        )
      )
    ).toHaveLength(1);
  });

  it("does not advance when another open surface remains in the same message", async () => {
    const secondOpenSurface: A2uiOpenSurface = {
      ...round2Surface,
      surface_id: "surface-open",
    };
    const transport = vi.fn(async (envelope: A2uiActionEnvelope) =>
      inputRequired(envelope)
    );
    const message = messageWith(transport, {
      blocks: [
        ...readyBlocks(),
        {
          type: "agent-surface",
          authority: "agent",
          interactive: true,
          a2ui: {
            surface: secondOpenSurface,
            state: { status: "ready", round: 1 },
          },
        },
      ],
    });
    const { submitAction } = useA2uiInteraction({
      buildActionId: () => "action-multiple-open",
    });

    await submitAction(message, event);

    expect(transport).toHaveBeenCalledTimes(1);
    expect(message.blocks).toHaveLength(4);
    expect(message.blocks?.[1].a2ui?.state).toEqual({
      status: "protocol_error",
      round: 1,
      actionId: "action-multiple-open",
      code: "multiple_open_surfaces",
    });
    expect(message.blocks?.[3].a2ui?.state).toEqual({
      status: "ready",
      round: 1,
    });
  });

  it("applies a deferred terminal response once and appends its formatted answer once", async () => {
    const reply = deferred<A2uiActionResponse>();
    const transport = vi.fn(() => reply.promise);
    const message = messageWith(transport);
    const { submitAction } = useA2uiInteraction({
      buildActionId: () => "action-deferred",
    });

    const pending = submitAction(message, event);
    const submitting = message.blocks?.[1].a2ui?.state;
    if (!submitting || submitting.status !== "submitting") {
      throw new Error("expected a submitting A2UI surface");
    }

    reply.resolve(terminal(submitting.envelope, true, "answer once"));
    await pending;
    // Observing an already-settled coordinator promise again must not append
    // another answer block or re-apply the terminal response.
    await pending;

    expect(message.blocks?.[1].a2ui?.state).toMatchObject({
      status: "resolved",
      actionId: "action-deferred",
    });
    expect(
      message.blocks?.filter(
        (block) => block.sourceActionId === "action-deferred"
      )
    ).toEqual([
      expect.objectContaining({
        type: "markdown",
        text: "answer once",
      }),
    ]);
  });

  it.each([
    [
      "runtime replacement",
      (message: ChatMessage) => {
        const runtime = message.a2uiRuntime;
        if (!runtime) throw new Error("expected an A2UI runtime");
        message.a2uiRuntime = { ...runtime };
      },
    ],
    [
      "runtime clearing",
      (message: ChatMessage) => {
        message.a2uiRuntime = undefined;
      },
    ],
    [
      "run replacement",
      (message: ChatMessage) => {
        const runtime = message.a2uiRuntime;
        if (!runtime) throw new Error("expected an A2UI runtime");
        runtime.runId = "run-2";
      },
    ],
  ] as const)(
    "locks a stale %s response as unknown without an answer or retry",
    async (_label, invalidateRuntime) => {
      const reply = deferred<A2uiActionResponse>();
      const transport = vi.fn(() => reply.promise);
      const message = messageWith(transport);
      const { submitAction, retryAction } = useA2uiInteraction({
        buildActionId: () => "action-stale",
      });

      const pending = submitAction(message, event);
      const submitting = message.blocks?.[1].a2ui?.state;
      if (!submitting || submitting.status !== "submitting") {
        throw new Error("expected a submitting A2UI surface");
      }

      invalidateRuntime(message);
      reply.resolve(terminal(submitting.envelope, true, "stale answer"));
      await pending;
      await retryAction(message, confirmSurface.surface_id);

      expect(message.blocks?.[1].a2ui?.state).toEqual({
        status: "unknown",
        round: 1,
        actionId: "action-stale",
        code: "runtime_changed",
      });
      expect(
        message.blocks?.some((block) => block.sourceActionId === "action-stale")
      ).toBe(false);
      expect(transport).toHaveBeenCalledTimes(1);
    }
  );

  it("locks a response when the message-owned dialogue identity changes in place", async () => {
    const reply = deferred<A2uiActionResponse>();
    const transport = vi.fn(() => reply.promise);
    const message = messageWith(transport);
    const { submitAction } = useA2uiInteraction({
      buildActionId: () => "action-dialogue-stale",
    });

    const pending = submitAction(message, event);
    const submitting = message.blocks?.[1].a2ui?.state;
    if (!submitting || submitting.status !== "submitting") {
      throw new Error("expected a submitting A2UI surface");
    }
    const runtime = message.a2uiRuntime;
    if (!runtime) throw new Error("expected an A2UI runtime");
    runtime.dialogueId = "dialogue-other";

    reply.resolve(terminal(submitting.envelope, true, "stale dialogue"));
    await pending;

    expect(message.blocks?.[1].a2ui?.state).toEqual({
      status: "unknown",
      round: 1,
      actionId: "action-dialogue-stale",
      code: "runtime_changed",
    });
    expect(message.blocks?.some((block) => block.sourceActionId)).toBe(false);
  });

  it("locks a stale transport rejection instead of exposing a retry", async () => {
    let rejectTransport!: (error: unknown) => void;
    const transport = vi.fn(
      () =>
        new Promise<A2uiActionResponse>((_resolve, reject) => {
          rejectTransport = reject;
        })
    );
    const message = messageWith(transport);
    const { submitAction, retryAction } = useA2uiInteraction({
      buildActionId: () => "action-stale-rejection",
    });

    const pending = submitAction(message, event);
    const runtime = message.a2uiRuntime;
    if (!runtime) throw new Error("expected an A2UI runtime");
    message.a2uiRuntime = { ...runtime };
    rejectTransport(
      new A2uiTransportError(
        "temporarily_rejected",
        "a2ui_gateway_disabled",
        503,
        false,
        true
      )
    );
    await pending;
    await retryAction(message, confirmSurface.surface_id);

    expect(message.blocks?.[1].a2ui?.state).toEqual({
      status: "unknown",
      round: 1,
      actionId: "action-stale-rejection",
      code: "runtime_changed",
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("allows a dialogue rekey when the message and runtime objects stay identical", async () => {
    const reply = deferred<A2uiActionResponse>();
    const transport = vi.fn(() => reply.promise);
    const message = messageWith(transport);
    const runtime = message.a2uiRuntime;
    const byDialogue: Record<string, ChatMessage[]> = {
      temporary: [message],
    };
    const { submitAction } = useA2uiInteraction({
      buildActionId: () => "action-rekey",
    });

    const pending = submitAction(byDialogue.temporary[0], event);
    byDialogue.server = byDialogue.temporary;
    delete byDialogue.temporary;

    expect(byDialogue.server[0]).toBe(message);
    expect(byDialogue.server[0].a2uiRuntime).toBe(runtime);
    const submitting = message.blocks?.[1].a2ui?.state;
    if (!submitting || submitting.status !== "submitting") {
      throw new Error("expected a submitting A2UI surface");
    }
    reply.resolve(terminal(submitting.envelope, true, "rekeyed answer"));
    await pending;

    expect(message.blocks?.[1].a2ui?.state).toMatchObject({
      status: "resolved",
      actionId: "action-rekey",
    });
    expect(
      message.blocks?.some(
        (block) =>
          block.sourceActionId === "action-rekey" &&
          block.text === "rekeyed answer"
      )
    ).toBe(true);
  });
});
