// AG-UI SSE frame parsing (pure, no DOM). The Web app owns this decoder so the
// browser contract is independent of Bot's exact wire bytes.

export interface AGUIEvent {
  type: string;
  data: Record<string, any>;
}

// parseAGUIFrame decodes one SSE frame (the text between blank-line
// separators). Returns null for blank frames, comment lines (": ..."), and the
// legacy "[DONE]" sentinel. The event type is taken from data.type
// (authoritative), falling back to the "event:" line.
export function parseAGUIFrame(frame: string): AGUIEvent | null {
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
  let data: Record<string, any>;
  try {
    data = JSON.parse(dataLine);
  } catch {
    return null;
  }
  const type =
    typeof data.type === "string" && data.type ? data.type : eventLine;
  if (!type) return null;
  return { type, data };
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
