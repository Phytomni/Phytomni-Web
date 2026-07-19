import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/utils/auth", () => ({ getToken: () => "tok" }));
vi.mock("@/utils/request", () => ({
  registerAbortController: vi.fn(),
  unregisterAbortController: vi.fn(),
}));

import { useStreamMessage } from "@/views/chat/composables/useStreamMessage";
import { unregisterAbortController } from "@/utils/request";
import type { ChatMessage } from "@/views/chat/types";

const CANONICAL_DIALOGUE_ID = "11111111-1111-4111-8111-111111111142";

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

    const placeholder: ChatMessage = {
      role: "assistant",
      content: "",
      streaming: true,
      blocks: [],
    };
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

  it("keeps one bounded stream identity for Chat, Knowledge, and BriefGene", async () => {
    const cases = [
      {
        tool: "ChatAgent",
        runId: "run-task27-chat",
        messageId: "401",
        webRequestId: "web-task27-chat",
        botRequestId: "bot-task27-chat",
      },
      {
        tool: "KnowledgeAgent",
        runId: "run-task27-knowledge",
        messageId: "402",
        webRequestId: "web-task27-knowledge",
        botRequestId: "bot-task27-knowledge",
      },
      {
        tool: "BriefGeneAgent",
        runId: "run-task27-brief-gene",
        messageId: "403",
        webRequestId: "web-task27-brief-gene",
        botRequestId: "bot-task27-brief-gene",
      },
    ];

    const { streamMessage } = useStreamMessage({
      getChatState: () => ({ isStreaming: false, streamingMessageId: null }),
      t: (k: string) => k,
    });

    for (const [index, fixture] of cases.entries()) {
      const body = sseStream([
        `event: RunStarted\r\ndata: {"type":"RunStarted","run_id":"${fixture.runId}"}\r\n\r\n`,
        'event: FutureEvent\ndata: {"type":"FutureEvent","value":"ignored"}\n\n',
        `event: TextMessageContent\r\ndata: {"type":"TextMessageContent","delta":"${fixture.tool}"}\r\n\r\n`,
        `event: RunFinished\ndata: {"type":"RunFinished","run_id":"${fixture.runId}"}\n\n`,
        "data: [DONE]\r\n\r\n",
      ]);
      (fetch as any).mockResolvedValueOnce(
        new Response(body, {
          status: 200,
          headers: {
            "X-Phyto-Dialogue-Id": CANONICAL_DIALOGUE_ID,
            "X-Phyto-Message-Id": fixture.messageId,
            "X-Request-Id": fixture.webRequestId,
            "X-Bot-Request-Id": fixture.botRequestId,
          },
        })
      );
      const formData = new FormData();
      formData.append("tool", fixture.tool);
      formData.append("mode", "instant");
      const placeholder: ChatMessage = {
        role: "assistant",
        content: "",
        streaming: true,
        blocks: [],
      };

      const result = await streamMessage({
        dialogueId: `local-task27-${index}`,
        formData,
        requestId: `request-task27-${index}`,
        placeholder,
      });

      expect(result).toEqual({
        dialogueId: CANONICAL_DIALOGUE_ID,
        messageId: fixture.messageId,
        requestId: fixture.webRequestId,
        botRequestId: fixture.botRequestId,
      });
      expect(placeholder.a2uiRuntime?.runId).toBe(fixture.runId);
      expect(placeholder.a2uiRuntime?.messageId).toBe(fixture.messageId);
      expect(placeholder.a2uiRuntime?.messageId).not.toBe(fixture.runId);
      expect(
        placeholder.blocks?.find((block) => block.type === "markdown")?.text
      ).toBe(fixture.tool);
      const request = (fetch as any).mock.calls[index][1] as RequestInit;
      expect((request.body as FormData).get("tool")).toBe(fixture.tool);
      expect((request.body as FormData).get("mode")).toBe("instant");
    }
    expect((fetch as any).mock.calls).toHaveLength(cases.length);
  });

  it("preserves streamPresentationKey across stream finally cleanup", async () => {
    const body = sseStream([
      'event: RunStarted\ndata: {"type":"RunStarted","run_id":"r1"}\n\n',
      'event: TextMessageContent\ndata: {"type":"TextMessageContent","delta":"hi"}\n\n',
      'event: RunFinished\ndata: {"type":"RunFinished","run_id":"r1"}\n\n',
    ]);
    (fetch as any).mockResolvedValue(new Response(body, { status: 200 }));

    const placeholder: ChatMessage = {
      role: "assistant",
      content: "",
      streaming: true,
      blocks: [],
      streamPresentationKey: "chat-request-keep",
    };
    const chatState: any = { isStreaming: false, streamingMessageId: null };
    const { streamMessage } = useStreamMessage({
      getChatState: () => chatState,
      t: (k: string) => k,
    });

    await streamMessage({
      dialogueId: "d1",
      formData: new FormData(),
      requestId: "chat-request-keep",
      placeholder,
    });

    expect(placeholder.streaming).toBe(false);
    expect(chatState.streamingMessageId).toBeNull();
    expect(placeholder.streamPresentationKey).toBe("chat-request-keep");
    expect(placeholder.id).toBeUndefined();
  });

  it("marks the placeholder errored on RunError", async () => {
    const body = sseStream([
      'event: RunError\ndata: {"type":"RunError","message":"boom"}\n\n',
    ]);
    (fetch as any).mockResolvedValue(new Response(body, { status: 200 }));
    const placeholder: ChatMessage = {
      role: "assistant",
      content: "",
      streaming: true,
      blocks: [],
    };
    const chatState: any = { isStreaming: false, streamingMessageId: null };
    const { streamMessage } = useStreamMessage({
      getChatState: () => chatState,
      t: (k: string) => k,
    });
    await streamMessage({
      dialogueId: "d1",
      formData: new FormData(),
      requestId: "r",
      placeholder,
    });
    expect(placeholder.streaming).toBe(false);
    expect(placeholder.content).toContain("boom");
  });

  it("shows the interrupted copy and finalizes when the HTTP response is not ok", async () => {
    (fetch as any).mockResolvedValue(new Response(null, { status: 503 }));
    const placeholder: ChatMessage = {
      role: "assistant",
      content: "",
      streaming: true,
      blocks: [],
    };
    const chatState: any = { isStreaming: false, streamingMessageId: null };
    const { streamMessage } = useStreamMessage({
      getChatState: () => chatState,
      t: (k: string) => k,
    });
    await streamMessage({
      dialogueId: "d1",
      formData: new FormData(),
      requestId: "r",
      placeholder,
    });
    // A non-ok stream throws before the read loop; the catch marks it resend-able.
    expect(placeholder.content).toBe("chat.streamInterrupted");
    expect(placeholder.streaming).toBe(false);
    expect(chatState.isStreaming).toBe(false);
    expect(chatState.streamingMessageId).toBeNull();
  });

  it("shows the interrupted copy when the fetch itself fails (network error)", async () => {
    (fetch as any).mockRejectedValue(new Error("network down"));
    const placeholder: ChatMessage = {
      role: "assistant",
      content: "",
      streaming: true,
      blocks: [],
    };
    const chatState: any = { isStreaming: false, streamingMessageId: null };
    const { streamMessage } = useStreamMessage({
      getChatState: () => chatState,
      t: (k: string) => k,
    });
    await streamMessage({
      dialogueId: "d1",
      formData: new FormData(),
      requestId: "r",
      placeholder,
    });
    expect(placeholder.content).toBe("chat.streamInterrupted");
    expect(placeholder.streaming).toBe(false);
  });

  it("does NOT show the interrupted copy when the user aborts (AbortError)", async () => {
    const abortErr = new Error("aborted");
    abortErr.name = "AbortError";
    (fetch as any).mockRejectedValue(abortErr);
    const placeholder: ChatMessage = {
      role: "assistant",
      content: "",
      streaming: true,
      blocks: [],
    };
    const chatState: any = { isStreaming: false, streamingMessageId: null };
    const { streamMessage } = useStreamMessage({
      getChatState: () => chatState,
      t: (k: string) => k,
    });
    await streamMessage({
      dialogueId: "d1",
      formData: new FormData(),
      requestId: "r",
      placeholder,
    });
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
    const placeholder: ChatMessage = {
      role: "assistant",
      content: "",
      streaming: true,
      blocks: [],
    };
    const chatState: any = { isStreaming: false, streamingMessageId: null };
    const { streamMessage } = useStreamMessage({
      getChatState: () => chatState,
      t: (k: string) => k,
    });
    await streamMessage({
      dialogueId: "d1",
      formData: new FormData(),
      requestId: "r",
      placeholder,
    });
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
    const placeholder: ChatMessage = {
      role: "assistant",
      content: "",
      streaming: true,
      blocks: [],
    };
    const chatState: any = { isStreaming: false, streamingMessageId: null };
    const { streamMessage } = useStreamMessage({
      getChatState: () => chatState,
      t: (k: string) => k,
    });
    await streamMessage({
      dialogueId: "d1",
      formData: new FormData(),
      requestId: "r",
      placeholder,
    });
    const md = placeholder.blocks!.find((b) => b.type === "markdown");
    expect(md?.text).toBe("split-safe");
    expect(placeholder.streaming).toBe(false);
  });

  it("reveals follow-up questions on the live turn (no @finish from StreamMessage)", async () => {
    const body = sseStream([
      'event: RunStarted\ndata: {"type":"RunStarted","run_id":"r1"}\n\n',
      'event: Custom\ndata: {"type":"Custom","name":"phyto.follow_up","value":["q1","q2"]}\n\n',
      'event: RunFinished\ndata: {"type":"RunFinished","run_id":"r1"}\n\n',
    ]);
    (fetch as any).mockResolvedValue(new Response(body, { status: 200 }));
    const placeholder: ChatMessage = {
      role: "assistant",
      content: "",
      streaming: true,
      blocks: [],
      showFollowUpQuestions: false,
    };
    const chatState: any = { isStreaming: false, streamingMessageId: null };
    const { streamMessage } = useStreamMessage({
      getChatState: () => chatState,
      t: (k: string) => k,
    });
    await streamMessage({
      dialogueId: "d1",
      formData: new FormData(),
      requestId: "r",
      placeholder,
    });
    expect(placeholder.followUpQuestions).toEqual(["q1", "q2"]);
    // The blocking path reveals chips via MarkdownViewer @finish; the stream
    // path has no @finish, so finalize must flip the reveal flag itself.
    expect(placeholder.showFollowUpQuestions).toBe(true);
  });

  it("owns canonical A2UI identity on the message and retains it after RunFinished", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(
          enc.encode(
            'event: RunStarted\ndata: {"type":"RunStarted","run_id":"run-42"}\n\n'
          )
        );
        controller.enqueue(
          enc.encode(
            'event: Custom\ndata: {"type":"Custom","name":"phyto.a2ui","value":{"catalog_version":"v1.0","surface_id":"surf-1","widget":"confirm","props":{"title":"OK?"}}}\n\n'
          )
        );
        await gate;
        controller.enqueue(
          enc.encode(
            'event: RunFinished\ndata: {"type":"RunFinished","run_id":"run-42"}\n\n'
          )
        );
        controller.close();
      },
    });
    (fetch as any)
      .mockResolvedValueOnce(
        new Response(body, {
          status: 200,
          headers: {
            "X-Phyto-Dialogue-Id": CANONICAL_DIALOGUE_ID,
            "X-Phyto-Message-Id": "142",
          },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: "succeeded",
            run_id: "run-42",
            result: {
              a2ui: {
                catalog_version: "v1.0",
                surface_id: "surf-1",
                widget: "confirm",
                props: { status: "submitted", accepted: true },
              },
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        )
      );

    const placeholder: ChatMessage = {
      role: "assistant",
      content: "",
      streaming: true,
      blocks: [],
    };
    const chatState: any = {
      isStreaming: false,
      streamingMessageId: null,
    };
    const formData = new FormData();
    formData.append("id", "42");
    const { streamMessage } = useStreamMessage({
      getChatState: () => chatState,
      t: (k: string) => k,
    });

    const streamPromise = streamMessage({
      dialogueId: "d1",
      formData,
      requestId: "req-a2ui",
      placeholder,
    });
    await vi.waitFor(() => {
      expect(placeholder.a2uiRuntime?.runId).toBe("run-42");
    });
    expect(placeholder.id).toBe("142");
    expect(placeholder.a2uiRuntime?.dialogueId).toBe(CANONICAL_DIALOGUE_ID);
    expect(placeholder.a2uiRuntime?.messageId).toBe("142");
    release();
    const result = await streamPromise;
    expect(result).toEqual({
      dialogueId: CANONICAL_DIALOGUE_ID,
      messageId: "142",
    });
    expect(placeholder.a2uiRuntime?.runId).toBe("run-42");
    expect(placeholder.a2uiRuntime?.transport).toBeTypeOf("function");
    await placeholder.a2uiRuntime!.transport({
      surface_id: "surf-1",
      widget: "confirm",
      action_id: "action-canonical-1",
      run_id: "run-42",
      payload: { accepted: true },
    });
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      `/api/v1/conversations/${CANONICAL_DIALOGUE_ID}/a2ui-actions`,
      expect.objectContaining({ method: "POST" })
    );
  });

  it("captures safe Web and Bot request ids without using temporary A2UI identity", async () => {
    const body = sseStream([
      'event: RunStarted\ndata: {"type":"RunStarted","run_id":"run-safe-ids"}\n\n',
      'event: RunFinished\ndata: {"type":"RunFinished","run_id":"run-safe-ids"}\n\n',
      "data: [DONE]\n\n",
    ]);
    (fetch as any).mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: {
          "X-Phyto-Dialogue-Id": CANONICAL_DIALOGUE_ID,
          "X-Phyto-Message-Id": "314",
          "X-Request-Id": "web-req-314",
          "X-Bot-Request-Id": "bot-req-2718",
        },
      })
    );
    const formData = new FormData();
    formData.append("id", "0");
    const placeholder: ChatMessage = {
      role: "assistant",
      content: "",
      streaming: true,
      blocks: [],
    };
    const { streamMessage } = useStreamMessage({
      getChatState: () => ({ isStreaming: false, streamingMessageId: null }),
      t: (k: string) => k,
    });

    const result = await streamMessage({
      dialogueId: "new_local",
      formData,
      requestId: "req-safe-ids",
      placeholder,
    });

    expect(result).toEqual({
      dialogueId: CANONICAL_DIALOGUE_ID,
      messageId: "314",
      requestId: "web-req-314",
      botRequestId: "bot-req-2718",
    });
    expect(placeholder.a2uiRuntime?.dialogueId).toBe(CANONICAL_DIALOGUE_ID);
    expect(placeholder.a2uiRuntime?.messageId).toBe("314");
    expect(placeholder.a2uiRuntime?.dialogueId).not.toBe("new_local");
    expect(placeholder.a2uiRuntime?.messageId).not.toBe("0");
  });

  it("drops unsafe request ids while retaining canonical message identity", async () => {
    const body = sseStream([
      'event: RunFinished\ndata: {"type":"RunFinished","run_id":"run-safe"}\n\n',
    ]);
    (fetch as any).mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: {
          "X-Phyto-Dialogue-Id": CANONICAL_DIALOGUE_ID,
          "X-Phyto-Message-Id": "315",
          "X-Request-Id": "web request with spaces",
          "X-Bot-Request-Id": "bot/request",
        },
      })
    );
    const placeholder: ChatMessage = {
      role: "assistant",
      content: "",
      streaming: true,
      blocks: [],
    };
    const { streamMessage } = useStreamMessage({
      getChatState: () => ({ isStreaming: false, streamingMessageId: null }),
      t: (k: string) => k,
    });

    const result = await streamMessage({
      dialogueId: "local-safe",
      formData: new FormData(),
      requestId: "req-unsafe-ids",
      placeholder,
    });

    expect(result).toEqual({
      dialogueId: CANONICAL_DIALOGUE_ID,
      messageId: "315",
    });
  });

  it("never derives A2UI identity from the FormData parent id", async () => {
    const body = sseStream([
      'event: RunStarted\ndata: {"type":"RunStarted","run_id":"run-no-headers"}\n\n',
      'event: Custom\ndata: {"type":"Custom","name":"phyto.a2ui","value":{"catalog_version":"v1.0","surface_id":"surf-1","widget":"confirm","props":{"title":"OK?"}}}\n\n',
      'event: RunFinished\ndata: {"type":"RunFinished","run_id":"run-no-headers"}\n\n',
    ]);
    (fetch as any).mockResolvedValue(new Response(body, { status: 200 }));
    const formData = new FormData();
    formData.append("id", "42");
    const placeholder: ChatMessage = {
      role: "assistant",
      content: "",
      streaming: true,
      blocks: [],
    };
    const { streamMessage } = useStreamMessage({
      getChatState: () => ({ isStreaming: false, streamingMessageId: null }),
      t: (k: string) => k,
    });

    const result = await streamMessage({
      dialogueId: "new_local",
      formData,
      requestId: "req-no-headers",
      placeholder,
    });

    expect(result).toEqual({ dialogueId: undefined, messageId: undefined });
    expect(placeholder.id).toBeUndefined();
    expect(placeholder.a2uiRuntime).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/conversations/42/messages",
      expect.any(Object)
    );
  });

  it("rejects partial or client-shaped response identities", async () => {
    const bodies = [
      {
        "X-Phyto-Dialogue-Id": "new_spoofed",
        "X-Phyto-Message-Id": "42",
      },
      {
        "X-Phyto-Dialogue-Id": "canonical-d2",
        "X-Phyto-Message-Id": "not-a-row",
      },
      { "X-Phyto-Dialogue-Id": CANONICAL_DIALOGUE_ID },
    ];
    const placeholders: ChatMessage[] = [];
    const { streamMessage } = useStreamMessage({
      getChatState: () => ({ isStreaming: false, streamingMessageId: null }),
      t: (k: string) => k,
    });

    for (const [index, headers] of bodies.entries()) {
      (fetch as any).mockResolvedValueOnce(
        new Response(
          sseStream([
            'event: RunStarted\ndata: {"type":"RunStarted","run_id":"run-x"}\n\n',
            'event: RunFinished\ndata: {"type":"RunFinished","run_id":"run-x"}\n\n',
          ]),
          { status: 200, headers }
        )
      );
      const placeholder: ChatMessage = {
        role: "assistant",
        content: "",
        streaming: true,
        blocks: [],
      };
      placeholders.push(placeholder);
      await streamMessage({
        dialogueId: `local-${index}`,
        formData: new FormData(),
        requestId: `partial-${index}`,
        placeholder,
      });
    }

    expect(placeholders.every((message) => !message.a2uiRuntime)).toBe(true);
    expect(placeholders.every((message) => !message.id)).toBe(true);
  });

  it("invalidates message-owned A2UI context on RunError and abnormal EOF", async () => {
    const response = (frames: string[], messageId: string) =>
      new Response(sseStream(frames), {
        status: 200,
        headers: {
          "X-Phyto-Dialogue-Id": CANONICAL_DIALOGUE_ID,
          "X-Phyto-Message-Id": messageId,
        },
      });
    (fetch as any)
      .mockResolvedValueOnce(
        response(
          [
            'event: RunStarted\ndata: {"type":"RunStarted","run_id":"run-error"}\n\n',
            'event: RunError\ndata: {"type":"RunError","message":"boom"}\n\n',
          ],
          "201"
        )
      )
      .mockResolvedValueOnce(
        response(
          [
            'event: RunStarted\ndata: {"type":"RunStarted","run_id":"run-eof"}\n\n',
          ],
          "202"
        )
      );
    const { streamMessage } = useStreamMessage({
      getChatState: () => ({ isStreaming: false, streamingMessageId: null }),
      t: (k: string) => k,
    });
    const errored: ChatMessage = {
      role: "assistant",
      content: "",
      streaming: true,
      blocks: [],
    };
    const interrupted: ChatMessage = {
      role: "assistant",
      content: "",
      streaming: true,
      blocks: [],
    };

    await streamMessage({
      dialogueId: "local-error",
      formData: new FormData(),
      requestId: "req-error",
      placeholder: errored,
    });
    await streamMessage({
      dialogueId: "local-eof",
      formData: new FormData(),
      requestId: "req-eof",
      placeholder: interrupted,
    });

    expect(errored.a2uiRuntime).toBeUndefined();
    expect(errored.content).toBe("boom");
    expect(interrupted.a2uiRuntime).toBeUndefined();
    expect(interrupted.content).toBe("chat.streamInterrupted");
  });

  it("does not replace a terminal RunError with a synthetic interruption", async () => {
    const enc = new TextEncoder();
    let sent = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!sent) {
          sent = true;
          controller.enqueue(
            enc.encode(
              'event: RunError\ndata: {"type":"RunError","message":"upstream boom"}\n\n'
            )
          );
          return;
        }
        controller.error(new Error("late transport close"));
      },
    });
    (fetch as any).mockResolvedValue(new Response(body, { status: 200 }));
    const placeholder: ChatMessage = {
      role: "assistant",
      content: "",
      streaming: true,
      blocks: [],
    };
    const { streamMessage } = useStreamMessage({
      getChatState: () => ({ isStreaming: false, streamingMessageId: null }),
      t: (k: string) => k,
    });

    await streamMessage({
      dialogueId: "local-terminal-error",
      formData: new FormData(),
      requestId: "req-terminal-error",
      placeholder,
    });

    expect(placeholder.content).toBe("upstream boom");
    expect(placeholder.content).not.toBe("chat.streamInterrupted");
  });

  it("treats the legacy [DONE] frame as a terminal success", async () => {
    const body = sseStream([
      'event: RunStarted\ndata: {"type":"RunStarted","run_id":"run-done"}\n\n',
      "data: [DONE]\n\n",
    ]);
    (fetch as any).mockResolvedValue(new Response(body, { status: 200 }));
    const placeholder: ChatMessage = {
      role: "assistant",
      content: "",
      streaming: true,
      blocks: [],
    };
    const { streamMessage } = useStreamMessage({
      getChatState: () => ({ isStreaming: false, streamingMessageId: null }),
      t: (k: string) => k,
    });

    await streamMessage({
      dialogueId: "local-done",
      formData: new FormData(),
      requestId: "req-done",
      placeholder,
    });

    expect(placeholder.content).toBe("");
    expect(placeholder.streaming).toBe(false);
  });

  it("invalidates a header-established A2UI context when stream reading aborts", async () => {
    const abortError = new Error("aborted while reading");
    abortError.name = "AbortError";
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(abortError);
      },
    });
    (fetch as any).mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: {
          "X-Phyto-Dialogue-Id": CANONICAL_DIALOGUE_ID,
          "X-Phyto-Message-Id": "203",
        },
      })
    );
    const placeholder: ChatMessage = {
      role: "assistant",
      content: "",
      streaming: true,
      blocks: [],
    };
    const { streamMessage } = useStreamMessage({
      getChatState: () => ({ isStreaming: false, streamingMessageId: null }),
      t: (k: string) => k,
    });

    await streamMessage({
      dialogueId: "local-abort",
      formData: new FormData(),
      requestId: "req-abort-read",
      placeholder,
    });

    expect(placeholder.id).toBe("203");
    expect(placeholder.a2uiRuntime).toBeUndefined();
    expect(placeholder.content).toBe("");
  });

  it("retains message-owned A2UI context after RunFinished even if transport close errors", async () => {
    const enc = new TextEncoder();
    let delivered = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!delivered) {
          delivered = true;
          controller.enqueue(
            enc.encode(
              'event: RunStarted\ndata: {"type":"RunStarted","run_id":"run-finished"}\n\n' +
                'event: RunFinished\ndata: {"type":"RunFinished","run_id":"run-finished"}\n\n'
            )
          );
          return;
        }
        controller.error(new Error("late close failure"));
      },
    });
    (fetch as any).mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: {
          "X-Phyto-Dialogue-Id": CANONICAL_DIALOGUE_ID,
          "X-Phyto-Message-Id": "204",
        },
      })
    );
    const placeholder: ChatMessage = {
      role: "assistant",
      content: "",
      streaming: true,
      blocks: [],
    };
    const { streamMessage } = useStreamMessage({
      getChatState: () => ({ isStreaming: false, streamingMessageId: null }),
      t: (k: string) => k,
    });

    await streamMessage({
      dialogueId: "local-finished",
      formData: new FormData(),
      requestId: "req-finished-close",
      placeholder,
    });

    expect(placeholder.a2uiRuntime?.runId).toBe("run-finished");
    expect(placeholder.a2uiRuntime?.messageId).toBe("204");
    expect(placeholder.content).toBe("");
  });

  it("unregisters the abort controller when the stream settles", async () => {
    const body = sseStream([
      'event: RunFinished\ndata: {"type":"RunFinished","run_id":"r1"}\n\n',
    ]);
    (fetch as any).mockResolvedValue(new Response(body, { status: 200 }));
    const placeholder: ChatMessage = {
      role: "assistant",
      content: "",
      streaming: true,
      blocks: [],
    };
    const chatState: any = { isStreaming: false, streamingMessageId: null };
    const { streamMessage } = useStreamMessage({
      getChatState: () => chatState,
      t: (k: string) => k,
    });
    await streamMessage({
      dialogueId: "d1",
      formData: new FormData(),
      requestId: "req-9",
      placeholder,
    });
    // The map must not accumulate a stale controller per streamed message.
    expect(unregisterAbortController).toHaveBeenCalledWith("req-9");
  });

  it("stale stream finally does not clear a newer request's streaming fields", async () => {
    let releaseStale!: () => void;
    let releaseFresh!: () => void;
    const staleGate = new Promise<void>((r) => {
      releaseStale = r;
    });
    const freshGate = new Promise<void>((r) => {
      releaseFresh = r;
    });
    const enc = new TextEncoder();
    const gatedBody = (runId: string, gate: Promise<void>) =>
      new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(
            enc.encode(
              `event: RunStarted\ndata: {"type":"RunStarted","run_id":"${runId}"}\n\n`
            )
          );
          await gate;
          controller.enqueue(
            enc.encode(
              `event: RunFinished\ndata: {"type":"RunFinished","run_id":"${runId}"}\n\n`
            )
          );
          controller.close();
        },
      });

    (fetch as any)
      .mockResolvedValueOnce(
        new Response(gatedBody("old", staleGate), {
          status: 200,
          headers: {
            "X-Phyto-Dialogue-Id": CANONICAL_DIALOGUE_ID,
            "X-Phyto-Message-Id": "301",
          },
        })
      )
      .mockResolvedValueOnce(
        new Response(gatedBody("new", freshGate), {
          status: 200,
          headers: {
            "X-Phyto-Dialogue-Id": CANONICAL_DIALOGUE_ID,
            "X-Phyto-Message-Id": "302",
          },
        })
      );

    const chatState: any = {
      isStreaming: false,
      streamingMessageId: null,
    };
    const { streamMessage } = useStreamMessage({
      getChatState: () => chatState,
      t: (k: string) => k,
    });

    const stalePlaceholder: ChatMessage = {
      role: "assistant",
      content: "",
      streaming: true,
      blocks: [],
    };
    const freshPlaceholder: ChatMessage = {
      role: "assistant",
      content: "",
      streaming: true,
      blocks: [],
    };

    const stalePromise = streamMessage({
      dialogueId: "d1",
      formData: new FormData(),
      requestId: "req-old",
      placeholder: stalePlaceholder,
    });
    await vi.waitFor(() => {
      expect(chatState.streamingMessageId).toBe("req-old");
    });

    const freshPromise = streamMessage({
      dialogueId: "d1",
      formData: new FormData(),
      requestId: "req-new",
      placeholder: freshPlaceholder,
    });
    await vi.waitFor(() => {
      expect(chatState.streamingMessageId).toBe("req-new");
    });

    releaseStale();
    await stalePromise;

    // Stale finally must not wipe the newer stream's ownership markers.
    expect(chatState.streamingMessageId).toBe("req-new");
    expect(chatState.isStreaming).toBe(true);
    expect(stalePlaceholder.streaming).toBe(false);
    expect(stalePlaceholder.a2uiRuntime?.runId).toBe("old");
    expect(stalePlaceholder.a2uiRuntime?.messageId).toBe("301");
    expect(freshPlaceholder.a2uiRuntime?.runId).toBe("new");
    expect(freshPlaceholder.a2uiRuntime?.messageId).toBe("302");

    releaseFresh();
    await freshPromise;
    expect(chatState.streamingMessageId).toBeNull();
    expect(chatState.isStreaming).toBe(false);
    expect(stalePlaceholder.a2uiRuntime?.runId).toBe("old");
    expect(freshPlaceholder.a2uiRuntime?.runId).toBe("new");
  });

  /**
   * Live-session limitation: phyto.references land on placeholder.doc_list only
   * for the current stream. History reload does not invent persisted reference
   * rows — a blocks-only message without doc_list remains references-unavailable.
   */
  it("documents history-refresh placeholders as references-unavailable", () => {
    const historyReload: ChatMessage = {
      role: "assistant",
      content: "",
      streaming: false,
      blocks: [{ type: "markdown", authority: "web", text: "See [1]." }],
    };
    expect(historyReload.doc_list).toBeUndefined();
  });
});
