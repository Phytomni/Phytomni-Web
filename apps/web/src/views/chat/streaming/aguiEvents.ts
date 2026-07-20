// AG-UI SSE frame parsing (pure, no DOM). The Web app owns this decoder so the
// browser contract is independent of Bot's exact wire bytes.

export type AguiEventType =
  | "RunStarted"
  | "StepStarted"
  | "TextMessageStart"
  | "TextMessageContent"
  | "TextMessageEnd"
  | "ReasoningMessageContent"
  | "ToolCallStart"
  | "ToolCallResult"
  | "Custom"
  | "RunFinished"
  | "RunError";

type AguiPayload = Record<string, unknown>;
type EventData<Fields extends AguiPayload = AguiPayload> = Fields & {
  [key: string]: unknown;
};

export interface RunStartedEvent {
  type: "RunStarted";
  data: EventData<{ run_id?: unknown }>;
}

export interface StepStartedEvent {
  type: "StepStarted";
  data: EventData<{ step_name?: unknown }>;
}

export interface TextMessageStartEvent {
  type: "TextMessageStart";
  data: EventData<{ message_id?: unknown }>;
}

export interface TextMessageContentEvent {
  type: "TextMessageContent";
  data: EventData<{ delta?: unknown }>;
}

export interface TextMessageEndEvent {
  type: "TextMessageEnd";
  data: EventData<{ message_id?: unknown }>;
}

export interface ReasoningMessageContentEvent {
  type: "ReasoningMessageContent";
  data: EventData<{ delta?: unknown }>;
}

export interface ToolCallStartEvent {
  type: "ToolCallStart";
  data: EventData<{ tool_call_id?: unknown; tool_name?: unknown }>;
}

export interface ToolCallResultEvent {
  type: "ToolCallResult";
  data: EventData<{ tool_call_id?: unknown; result_summary?: unknown }>;
}

export interface CustomEvent {
  type: "Custom";
  data: EventData<{ name?: unknown; value?: unknown }>;
}

export interface RunFinishedEvent {
  type: "RunFinished";
  data: EventData<{ run_id?: unknown }>;
}

export interface RunErrorEvent {
  type: "RunError";
  data: EventData<{ code?: unknown; message?: unknown }>;
}

export type AguiEvent =
  | RunStartedEvent
  | StepStartedEvent
  | TextMessageStartEvent
  | TextMessageContentEvent
  | TextMessageEndEvent
  | ReasoningMessageContentEvent
  | ToolCallStartEvent
  | ToolCallResultEvent
  | CustomEvent
  | RunFinishedEvent
  | RunErrorEvent;

/** Backward-compatible spelling for the bounded event union. */
export type AGUIEvent = AguiEvent;

const AGUI_EVENT_TYPES: ReadonlySet<AguiEventType> = new Set([
  "RunStarted",
  "StepStarted",
  "TextMessageStart",
  "TextMessageContent",
  "TextMessageEnd",
  "ReasoningMessageContent",
  "ToolCallStart",
  "ToolCallResult",
  "Custom",
  "RunFinished",
  "RunError",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// parseAGUIFrame decodes one SSE frame (the text between blank-line
// separators). Returns null for blank frames, comment lines (": ..."), and the
// legacy "[DONE]" sentinel. The event type is taken from data.type
// (authoritative), falling back to the "event:" line.
export function parseAGUIFrame(frame: string): AguiEvent | null {
  let eventLine = "";
  const dataLines: string[] = [];
  for (const raw of frame.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line.startsWith("event:")) eventLine = line.slice(6).trim();
    // SSE joins consecutive data: lines with "\n"; strip only the single
    // optional leading space after the colon, never inner whitespace (it may
    // be significant JSON string content). Mirrors the Go gateway parser.
    else if (line.startsWith("data:"))
      dataLines.push(line.slice(5).replace(/^ /, ""));
  }
  const dataLine = dataLines.join("\n").trim();
  if (!dataLine || dataLine === "[DONE]") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(dataLine) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  let type: string;
  if (Object.prototype.hasOwnProperty.call(parsed, "type")) {
    if (typeof parsed.type !== "string" || !parsed.type) return null;
    type = parsed.type;
  } else {
    type = eventLine;
  }
  if (!AGUI_EVENT_TYPES.has(type as AguiEventType)) return null;
  return { type: type as AguiEventType, data: parsed } as AguiEvent;
}

// splitSSEFrames splits a streaming buffer on LF or CRLF blank-line frame
// separators, returning complete frames plus the trailing partial (rest) to
// be prepended to the next chunk. The frame slices are intentionally not
// normalized so parseAGUIFrame receives the provider's original line endings.
export function splitSSEFrames(buffer: string): {
  frames: string[];
  rest: string;
} {
  const frames: string[] = [];
  let frameStart = 0;
  let searchFrom = 0;

  for (;;) {
    const lfIndex = buffer.indexOf("\n\n", searchFrom);
    const crlfIndex = buffer.indexOf("\r\n\r\n", searchFrom);
    if (lfIndex < 0 && crlfIndex < 0) break;

    const useCRLF = crlfIndex >= 0 && (lfIndex < 0 || crlfIndex < lfIndex);
    const separatorIndex = useCRLF ? crlfIndex : lfIndex;
    const separatorLength = useCRLF ? 4 : 2;
    const frame = buffer.slice(frameStart, separatorIndex);
    if (frame.length > 0) frames.push(frame);

    frameStart = separatorIndex + separatorLength;
    searchFrom = frameStart;
  }

  return { frames, rest: buffer.slice(frameStart) };
}
