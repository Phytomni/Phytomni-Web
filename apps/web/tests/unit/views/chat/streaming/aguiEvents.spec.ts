import { describe, it, expect } from "vitest";
import {
  parseAGUIFrame,
  splitSSEFrames,
} from "@/views/chat/streaming/aguiEvents";

describe("parseAGUIFrame", () => {
  it("parses a TextMessageContent frame", () => {
    const ev = parseAGUIFrame(
      'event: TextMessageContent\ndata: {"type":"TextMessageContent","delta":"photosynthesis"}'
    );
    expect(ev).not.toBeNull();
    expect(ev!.type).toBe("TextMessageContent");
    expect(ev!.data.delta).toBe("photosynthesis");
  });

  it("returns null for [DONE] and blank frames", () => {
    expect(parseAGUIFrame("data: [DONE]")).toBeNull();
    expect(parseAGUIFrame("")).toBeNull();
    expect(parseAGUIFrame(": comment")).toBeNull();
  });

  it("prefers the data.type field over the event: line", () => {
    const ev = parseAGUIFrame(
      'event: X\ndata: {"type":"RunFinished","run_id":"r1"}'
    );
    expect(ev!.type).toBe("RunFinished");
  });
});

describe("splitSSEFrames", () => {
  it("splits complete frames and keeps the trailing partial as rest", () => {
    const { frames, rest } = splitSSEFrames(
      'data: {"a":1}\n\ndata: {"b":2}\n\ndata: {"c":'
    );
    expect(frames).toEqual(['data: {"a":1}', 'data: {"b":2}']);
    expect(rest).toBe('data: {"c":');
  });

  it("splits CRLF frames without normalizing bytes, including DONE and rest", () => {
    const firstChunk =
      'event: TextMessageContent\r\ndata: {"type":"TextMessageContent","delta":"hi"}\r\n\r';
    const first = splitSSEFrames(firstChunk);
    expect(first.frames).toEqual([]);
    expect(first.rest).toBe(firstChunk);

    const second = splitSSEFrames(
      first.rest + "\ndata: [DONE]\r\n\r\n\r\n\r\npartial"
    );
    expect(second.frames).toEqual([
      'event: TextMessageContent\r\ndata: {"type":"TextMessageContent","delta":"hi"}',
      "data: [DONE]",
    ]);
    expect(second.rest).toBe("partial");
    expect(parseAGUIFrame(second.frames[0])?.data.delta).toBe("hi");
    expect(parseAGUIFrame(second.frames[1])).toBeNull();
  });

  it("ignores empty LF and CRLF frames while consuming their separators", () => {
    expect(splitSSEFrames('\n\n\r\n\r\ndata: {"ok":true}\n\n')).toEqual({
      frames: ['data: {"ok":true}'],
      rest: "",
    });
  });
});

describe("parseAGUIFrame multi-line data", () => {
  it("joins consecutive data: lines into one JSON event (SSE spec)", () => {
    const ev = parseAGUIFrame(
      'event: TextMessageContent\ndata: {"type":"TextMessageContent",\ndata: "delta":"hi"}'
    );
    expect(ev?.type).toBe("TextMessageContent");
    expect(ev?.data.delta).toBe("hi");
  });

  it("returns null for malformed JSON", () => {
    expect(parseAGUIFrame("data: {bad json")).toBeNull();
  });

  it("rejects unknown events and non-object or malformed event payloads", () => {
    expect(
      parseAGUIFrame('data: {"type":"FutureEvent","value":"ignored"}')
    ).toBeNull();
    expect(parseAGUIFrame("data: null")).toBeNull();
    expect(
      parseAGUIFrame("event: TextMessageContent\ndata: [1,2,3]")
    ).toBeNull();
    expect(
      parseAGUIFrame(
        'event: TextMessageContent\ndata: {"type":123,"delta":"x"}'
      )
    ).toBeNull();
  });

  it("falls back to the event: line when data has no type", () => {
    const ev = parseAGUIFrame('event: RunFinished\ndata: {"run_id":"r1"}');
    expect(ev?.type).toBe("RunFinished");
  });
});

describe("combined gated compatibility fixture", () => {
  it("keeps mixed raw separators, terminal RunError, DONE, and bounded events", () => {
    // The first chunk ends inside a CRLF separator to mirror arbitrary reader
    // boundaries. The following chunks deliberately alternate LF/CRLF and end
    // with a trailing partial frame; no frame text is normalized.
    const chunks = [
      'event: RunStarted\r\ndata: {"type":"RunStarted","run_id":"run-task27"}\r\n\r',
      '\nevent: FutureEvent\ndata: {"type":"FutureEvent","value":"ignored"}\n\n',
      'event: TextMessageContent\r\ndata: {"type":"TextMessageContent","delta":"synthetic"}\r\n\r\n',
      'event: RunError\ndata: {"type":"RunError","code":"fixture_failure","message":"synthetic failure"}\n\n',
      "data: [DONE]\r\n\r\npartial",
    ];
    let buffer = "";
    const frames: string[] = [];
    for (const chunk of chunks) {
      buffer += chunk;
      const split = splitSSEFrames(buffer);
      frames.push(...split.frames);
      buffer = split.rest;
    }

    expect(frames).toHaveLength(5);
    expect(frames[0]).toContain("\r\n");
    expect(frames[2]).toContain("\r\n");
    expect(frames[3]).toContain("\n");
    expect(buffer).toBe("partial");

    const allowed = new Set(["RunStarted", "TextMessageContent", "RunError"]);
    const observed = frames
      .map((frame) => parseAGUIFrame(frame))
      .filter((event): event is NonNullable<typeof event> => event !== null);
    expect(observed.map((event) => event.type)).toEqual([
      "RunStarted",
      "TextMessageContent",
      "RunError",
    ]);
    expect(
      observed
        .filter((event) => allowed.has(event.type))
        .map((event) => event.type)
    ).toEqual(["RunStarted", "TextMessageContent", "RunError"]);
    expect(observed[0].data.run_id).toBe("run-task27");
    expect(observed[2].data.message).toBe("synthetic failure");
    expect(parseAGUIFrame(frames[4])).toBeNull();
  });
});
