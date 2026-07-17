import { describe, it, expect } from "vitest";
import { parseAGUIFrame, splitSSEFrames } from "@/views/chat/streaming/aguiEvents";

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
    const ev = parseAGUIFrame('event: X\ndata: {"type":"RunFinished","run_id":"r1"}');
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
      first.rest + '\ndata: [DONE]\r\n\r\n\r\n\r\npartial'
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
    expect(splitSSEFrames("\n\n\r\n\r\ndata: {\"ok\":true}\n\n")).toEqual({
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

  it("falls back to the event: line when data has no type", () => {
    const ev = parseAGUIFrame('event: RunFinished\ndata: {"run_id":"r1"}');
    expect(ev?.type).toBe("RunFinished");
  });
});
