import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ChatMessage, ContentBlock } from "@/views/chat/types";
import type {
  A2uiActionTransport,
  A2uiTransportError,
} from "@/views/chat/streaming/a2uiAction";
import {
  decodeA2uiOpenSurface,
  decodeA2uiActionResponse,
} from "@/views/chat/streaming/a2uiParse";
import type {
  A2uiActionEnvelope,
  A2uiActionResponse,
  A2uiOpenSurface,
  A2uiTerminalSurface,
  A2uiWidgetKind,
} from "@/views/chat/streaming/a2uiContract";

const FIXTURE_ROOT = resolve(process.cwd(), "tests/fixtures/a2ui");
const OPEN_SURFACE_FIXTURES: Record<A2uiWidgetKind, string> = {
  confirm: "upstream/chat_confirm/downlink.json",
  form: "upstream/chat_form/downlink.json",
  choice: "upstream/chat_choice/downlink.json",
};

export interface A2uiScenarioOptions {
  dialogueId?: string;
  messageId?: string;
  runId?: string;
  surfaceId?: string;
  multiple?: boolean;
}

export interface A2uiSuccessOptions {
  answer?: string;
  terminal?: A2uiTerminalSurface;
}

export interface A2uiScenario {
  readonly message: ChatMessage;
  readonly calls: A2uiActionEnvelope[];
  readonly transport: A2uiActionTransport;
  resolveSuccess(options?: A2uiSuccessOptions): void;
  resolveInputRequired(): void;
  rejectWith(error: A2uiTransportError): void;
}

interface PendingReply {
  resolve: (response: A2uiActionResponse) => void;
  reject: (error: unknown) => void;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(resolve(FIXTURE_ROOT, path), "utf8"));
}

function readOpenSurface(
  widget: A2uiWidgetKind,
  options: A2uiScenarioOptions
): A2uiOpenSurface {
  const decoded = decodeA2uiOpenSurface(
    readJson(OPEN_SURFACE_FIXTURES[widget])
  );
  if (!decoded.ok) {
    throw new Error(`Invalid committed A2UI fixture for ${widget}`);
  }

  const surface = decoded.value;
  const surfaceId = options.surfaceId ?? surface.surface_id;
  if (surface.widget !== "choice" || options.multiple === undefined) {
    return surfaceId === surface.surface_id
      ? surface
      : { ...surface, surface_id: surfaceId };
  }

  return {
    ...surface,
    surface_id: surfaceId,
    props: { ...surface.props, multiple: options.multiple },
  };
}

function terminalFor(
  surface: A2uiOpenSurface,
  envelope: A2uiActionEnvelope
): A2uiTerminalSurface {
  switch (surface.widget) {
    case "confirm":
      return {
        catalog_version: surface.catalog_version,
        surface_id: envelope.surface_id,
        widget: "confirm",
        props: {
          status: "submitted",
          accepted: Boolean(envelope.payload.accepted),
        },
      };
    case "form":
      return {
        catalog_version: surface.catalog_version,
        surface_id: envelope.surface_id,
        widget: "form",
        props:
          "cancelled" in envelope.payload
            ? { status: "submitted", cancelled: true, fields: {} }
            : {
                status: "submitted",
                fields:
                  (envelope.payload.fields as Record<
                    string,
                    string | number
                  >) ?? {},
              },
      };
    case "choice":
      return {
        catalog_version: surface.catalog_version,
        surface_id: envelope.surface_id,
        widget: "choice",
        props:
          "cancelled" in envelope.payload
            ? { status: "submitted", cancelled: true }
            : {
                status: "submitted",
                selected: envelope.payload.selected as string | string[],
              },
      };
  }
}

function responseForInputRequired(runId: string): A2uiActionResponse {
  const decoded = decodeA2uiActionResponse(
    readJson("http/input_required_round2.json")
  );
  if (!decoded.ok || decoded.value.status !== "input_required") {
    throw new Error("Invalid committed A2UI input-required fixture");
  }
  return {
    ...decoded.value,
    run_id: runId,
  };
}

export function buildA2uiScenario(
  widget: A2uiWidgetKind,
  options: A2uiScenarioOptions = {}
): A2uiScenario {
  const dialogueId = options.dialogueId ?? `dialogue-${widget}`;
  const messageId = options.messageId ?? `message-${widget}`;
  const runId = options.runId ?? `run-${widget}`;
  let surface = readOpenSurface(widget, options);
  const calls: A2uiActionEnvelope[] = [];
  const pending: PendingReply[] = [];

  const transport: A2uiActionTransport = (envelope) => {
    calls.push(envelope);
    return new Promise<A2uiActionResponse>((resolve, reject) => {
      pending.push({ resolve, reject });
    });
  };

  const block: ContentBlock = {
    type: "agent-surface",
    authority: "agent",
    interactive: true,
    a2ui: { surface, state: { status: "ready", round: 1 } },
  };
  const message: ChatMessage = {
    role: "assistant",
    content: "",
    id: messageId,
    streaming: true,
    blocks: [block],
    a2uiRuntime: { dialogueId, messageId, runId, transport },
  };

  function takePending(): PendingReply {
    const reply = pending.shift();
    if (!reply) throw new Error("A2UI scenario has no pending transport call");
    return reply;
  }

  return {
    message,
    calls,
    transport,
    resolveSuccess(options: A2uiSuccessOptions = {}) {
      const reply = takePending();
      const envelope = calls[calls.length - 1];
      if (!envelope) throw new Error("A2UI scenario has no action envelope");
      reply.resolve({
        status: "succeeded",
        run_id: runId,
        result: {
          a2ui: options.terminal ?? terminalFor(surface, envelope),
          ...(options.answer === undefined
            ? {}
            : { formatted: { answer: options.answer } }),
        },
      });
    },
    resolveInputRequired() {
      const reply = takePending();
      const response = responseForInputRequired(runId);
      if (response.status === "input_required") {
        const nextSurface = response.interrupt.draft.a2ui;
        surface = nextSurface;
        reply.resolve(response);
      }
    },
    rejectWith(error: A2uiTransportError) {
      takePending().reject(error);
    },
  };
}
