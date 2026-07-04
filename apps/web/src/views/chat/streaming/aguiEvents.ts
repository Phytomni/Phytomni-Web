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
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
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

// splitSSEFrames splits a streaming buffer on the blank-line ("\n\n") frame
// separator, returning the complete frames plus the trailing partial (rest)
// to be prepended to the next chunk.
export function splitSSEFrames(buffer: string): { frames: string[]; rest: string } {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  return { frames: parts.filter((f) => f.length > 0), rest };
}
