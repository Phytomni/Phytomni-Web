import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/utils/auth", () => ({ getToken: () => "tok" }));
vi.mock("@/utils/request", () => ({ registerAbortController: vi.fn() }));

import { useStreamMessage } from "@/views/chat/composables/useStreamMessage";
import type { ChatMessage } from "@/views/chat/types";

function sseStream(frames: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const f of frames) controller.enqueue(enc.encode(f));
      controller.close();
    },
  });
}

// chunkedStream enqueues an arbitrary sequence of byte chunks verbatim, so a
// single SSE frame (or its JSON) can be split across two reader.read() calls.
function chunkedStream(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

describe("useStreamMessage", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("accumulates content into placeholder.blocks and finalizes on RunFinished", async () => {
    const body = sseStream([
      'event: RunStarted\ndata: {"type":"RunStarted","run_id":"r1"}\n\n',
      'event: TextMessageContent\ndata: {"type":"TextMessageContent","delta":"hello "}\n\n',
      'event: TextMessageContent\ndata: {"type":"TextMessageContent","delta":"world"}\n\n',
      'event: RunFinished\ndata: {"type":"RunFinished","run_id":"r1"}\n\n',
    ]);
    (fetch as any).mockResolvedValue(new Response(body, { status: 200 }));

    const placeholder: ChatMessage = { role: "assistant", content: "", streaming: true, blocks: [] };
    const chatState: any = { isStreaming: false, streamingMessageId: null };
    const { streamMessage } = useStreamMessage({
      getChatState: () => chatState,
      t: (k: string) => k,
    });

    await streamMessage({
      dialogueId: "d1",
      formData: new FormData(),
      requestId: "req-1",
      placeholder,
    });

    const md = placeholder.blocks!.find((b) => b.type === "markdown");
    expect(md?.text).toBe("hello world");
    expect(placeholder.streaming).toBe(false);
    expect(chatState.isStreaming).toBe(false);
  });

  it("marks the placeholder errored on RunError", async () => {
    const body = sseStream([
      'event: RunError\ndata: {"type":"RunError","message":"boom"}\n\n',
    ]);
    (fetch as any).mockResolvedValue(new Response(body, { status: 200 }));
    const placeholder: ChatMessage = { role: "assistant", content: "", streaming: true, blocks: [] };
    const chatState: any = { isStreaming: false, streamingMessageId: null };
    const { streamMessage } = useStreamMessage({ getChatState: () => chatState, t: (k: string) => k });
    await streamMessage({ dialogueId: "d1", formData: new FormData(), requestId: "r", placeholder });
    expect(placeholder.streaming).toBe(false);
    expect(placeholder.content).toContain("boom");
  });

  it("shows the interrupted copy and finalizes when the HTTP response is not ok", async () => {
    (fetch as any).mockResolvedValue(new Response(null, { status: 503 }));
    const placeholder: ChatMessage = { role: "assistant", content: "", streaming: true, blocks: [] };
    const chatState: any = { isStreaming: false, streamingMessageId: null };
    const { streamMessage } = useStreamMessage({
      getChatState: () => chatState,
      t: (k: string) => k,
    });
    await streamMessage({ dialogueId: "d1", formData: new FormData(), requestId: "r", placeholder });
    // A non-ok stream throws before the read loop; the catch marks it resend-able.
    expect(placeholder.content).toBe("chat.streamInterrupted");
    expect(placeholder.streaming).toBe(false);
    expect(chatState.isStreaming).toBe(false);
    expect(chatState.streamingMessageId).toBeNull();
  });

  it("shows the interrupted copy on a mid-stream network error", async () => {
    (fetch as any).mockRejectedValue(new Error("network down"));
    const placeholder: ChatMessage = { role: "assistant", content: "", streaming: true, blocks: [] };
    const chatState: any = { isStreaming: false, streamingMessageId: null };
    const { streamMessage } = useStreamMessage({ getChatState: () => chatState, t: (k: string) => k });
    await streamMessage({ dialogueId: "d1", formData: new FormData(), requestId: "r", placeholder });
    expect(placeholder.content).toBe("chat.streamInterrupted");
    expect(placeholder.streaming).toBe(false);
  });

  it("does NOT show the interrupted copy when the user aborts (AbortError)", async () => {
    const abortErr = new Error("aborted");
    abortErr.name = "AbortError";
    (fetch as any).mockRejectedValue(abortErr);
    const placeholder: ChatMessage = { role: "assistant", content: "", streaming: true, blocks: [] };
    const chatState: any = { isStreaming: false, streamingMessageId: null };
    const { streamMessage } = useStreamMessage({ getChatState: () => chatState, t: (k: string) => k });
    await streamMessage({ dialogueId: "d1", formData: new FormData(), requestId: "r", placeholder });
    // A deliberate user abort is not an interruption — no error copy, but still finalized.
    expect(placeholder.content).toBe("");
    expect(placeholder.streaming).toBe(false);
    expect(chatState.isStreaming).toBe(false);
  });

  it("captures phyto.references into placeholder.doc_list on finalize", async () => {
    const body = sseStream([
      'event: RunStarted\ndata: {"type":"RunStarted","run_id":"r1"}\n\n',
      'event: Custom\ndata: {"type":"Custom","name":"phyto.references","value":{"doc_list":[{"title":"T1"}]}}\n\n',
      'event: RunFinished\ndata: {"type":"RunFinished","run_id":"r1"}\n\n',
    ]);
    (fetch as any).mockResolvedValue(new Response(body, { status: 200 }));
    const placeholder: ChatMessage = { role: "assistant", content: "", streaming: true, blocks: [] };
    const chatState: any = { isStreaming: false, streamingMessageId: null };
    const { streamMessage } = useStreamMessage({ getChatState: () => chatState, t: (k: string) => k });
    await streamMessage({ dialogueId: "d1", formData: new FormData(), requestId: "r", placeholder });
    expect((placeholder as any).doc_list).toEqual([{ title: "T1" }]);
  });

  it("reassembles a frame whose bytes are split across two reader chunks", async () => {
    // The reader hands back arbitrary byte boundaries; a frame (here mid-JSON)
    // split across two reads must be buffered via `rest` and reduced whole.
    const body = chunkedStream([
      'event: TextMessageContent\ndata: {"type":"TextMessageContent",',
      '"delta":"split-safe"}\n\nevent: RunFinished\ndata: {"type":"RunFinished","run_id":"r1"}\n\n',
    ]);
    (fetch as any).mockResolvedValue(new Response(body, { status: 200 }));
    const placeholder: ChatMessage = { role: "assistant", content: "", streaming: true, blocks: [] };
    const chatState: any = { isStreaming: false, streamingMessageId: null };
    const { streamMessage } = useStreamMessage({ getChatState: () => chatState, t: (k: string) => k });
    await streamMessage({ dialogueId: "d1", formData: new FormData(), requestId: "r", placeholder });
    const md = placeholder.blocks!.find((b) => b.type === "markdown");
    expect(md?.text).toBe("split-safe");
    expect(placeholder.streaming).toBe(false);
  });
});
