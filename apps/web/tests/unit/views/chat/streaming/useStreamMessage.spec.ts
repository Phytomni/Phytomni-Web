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
});
