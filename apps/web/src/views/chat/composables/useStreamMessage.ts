import { getToken } from "@/utils/auth";
import i18n from "@/locales";
import {
  registerAbortController,
  unregisterAbortController,
} from "@/utils/request";
import {
  splitSSEFrames,
  parseAGUIFrame,
  parseSSEFrameId,
  type AguiEvent,
} from "../streaming/aguiEvents";
import { initReducerState, reduceAGUIEvent } from "../streaming/eventReducer";
import { createFetchA2uiTransport } from "../streaming/a2uiAction";
import { isDefinitePreDispatch4xx } from "../utils/client-turn-id";
import {
  normalizeChatContextNotice,
  type ChatMessage,
  type ChatUIState,
} from "../types";
import type { ConversationContextNotice } from "@/api/types";
import { reduceContextStagedNotice } from "../streaming/botLifecycleReducer";
import { resumeMessageStream } from "@/api/chat";

export interface StreamInput {
  dialogueId: string;
  formData: FormData;
  requestId: string;
  placeholder: ChatMessage;
  /** Logical turn identity; the send path normally already appended it. */
  clientTurnId?: string;
  onIdentity?: (identity: { dialogueId: string; messageId: string }) => void;
}

export interface ResumeStreamInput {
  dialogueId: string;
  messageId: string;
  placeholder: ChatMessage;
  requestId?: string;
  lastEventId?: string;
}

export interface StreamResult {
  /** Canonical server dialogue identity, never the temporary/client parent id. */
  dialogueId?: string;
  /** Persisted assistant row id associated with this stream. */
  messageId?: string;
  /** Safe Web gateway request id, when the response exposes one. */
  requestId?: string;
  /** Safe upstream Bot request id, when the gateway exposes one. */
  botRequestId?: string;
  /** True only after a terminal successful stream was fully reduced. */
  completed?: boolean;
  /** True when the gateway rejected the request before dispatching a turn. */
  preDispatch4xx?: boolean;
  contextNotice?: ConversationContextNotice;
}

/** Chat streaming accepts only scalar fields and JSON asset references. */
export function assertReferenceOnlyFormData(formData: FormData): void {
  for (const [, value] of formData.entries()) {
    if (typeof value !== "string") {
      throw new TypeError("Chat attachments must be asset references");
    }
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function canonicalDialogueHeader(resp: Response): string | undefined {
  const value = resp.headers.get("X-Phyto-Dialogue-Id")?.trim();
  if (!value || !UUID_PATTERN.test(value)) return undefined;
  return value;
}

function canonicalMessageHeader(resp: Response): string | undefined {
  const value = resp.headers.get("X-Phyto-Message-Id")?.trim();
  if (!value || !/^[1-9]\d{0,18}$/.test(value)) return undefined;
  return value;
}

const SAFE_REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function safeRequestHeader(
  resp: Response,
  name: "X-Request-Id" | "X-Bot-Request-Id"
): string | undefined {
  const value = resp.headers.get(name)?.trim();
  if (!value || !SAFE_REQUEST_ID_PATTERN.test(value)) return undefined;
  return value;
}

function isDoneFrame(frame: string): boolean {
  return frame.split("\n").some((raw) => {
    const line = raw.replace(/\r$/, "");
    return line.startsWith("data:") && line.slice(5).trim() === "[DONE]";
  });
}

function isEventStreamResponse(resp: Response): boolean {
  const contentType = resp.headers.get("Content-Type");
  if (!contentType) return true;
  return (
    contentType.split(";", 1)[0].trim().toLowerCase() === "text/event-stream"
  );
}

// Keep transport acceptance bounded even when Bot adds a new AG-UI event. The
// reducer owns the detailed payload handling; this gate prevents an unknown
// event type from becoming an accidental UI surface while retaining the
// existing tool/reasoning events used by the chat stream.
const BOUNDED_AGUI_EVENTS: ReadonlySet<AguiEvent["type"]> = new Set([
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

// useStreamMessage consumes the AG-UI SSE stream with fetch + ReadableStream
// (axios cannot read a stream incrementally). It mutates the already-pushed
// placeholder message per event so Vue reactivity renders blocks live, then
// finalizes on RunFinished/RunError. It coexists with the axios path in
// useSendMessage; the branch decision lives there.
export function useStreamMessage(opts: {
  getChatState: (dialogueId: string) => ChatUIState;
  t: (key: string) => string; // i18n lookup (mirrors useSendMessage opts)
}) {
  const { getChatState, t } = opts;

  const executeStream = async (execution: {
    placeholder: ChatMessage;
    requestId: string;
    chatState: ChatUIState;
    open: (signal: AbortSignal) => Promise<Response>;
    onIdentity?: StreamInput["onIdentity"];
    abortFailure: "cancelled" | "resume";
    seedReducer: boolean;
  }): Promise<StreamResult> => {
    const {
      placeholder,
      requestId,
      chatState,
      open,
      onIdentity,
      abortFailure,
      seedReducer,
    } = execution;
    const controller = new AbortController();
    registerAbortController(requestId, controller); // reuse the shared abort UI
    chatState.isStreaming = true;
    chatState.streamingMessageId = requestId;
    placeholder.streamTerminalFailure = undefined;

    let state = initReducerState();
    if (seedReducer) {
      state = {
        ...state,
        blocks: (placeholder.blocks ?? []).map((block) => ({ ...block })),
        runId: placeholder.a2uiRuntime?.runId ?? "",
        followUp: placeholder.followUpQuestions
          ? [...placeholder.followUpQuestions]
          : [],
        references: placeholder.doc_list ? [...placeholder.doc_list] : [],
        contextNotice: placeholder.contextNotice,
      };
    }
    let contextNotice: ConversationContextNotice = {};
    let result: StreamResult = {};
    const applyTerminalState = () => {
      placeholder.followUpQuestions = state.followUp;
      if (state.followUp.length) {
        // StreamMessage/MarkdownBlock emit no @finish (unlike the blocking
        // completed Markdown path), so reveal the follow-up chips here.
        placeholder.showFollowUpQuestions = true;
      }
      if (state.references.length) {
        // Expose captured references so the namespace-aware cited render path
        // can engage after finalization.
        placeholder.doc_list = state.references;
      }
      if (state.contextNotice) {
        placeholder.contextNotice = state.contextNotice;
      }
      if (state.error) {
        placeholder.content = state.error.message;
        placeholder.streamTerminalFailure = "run-error";
        placeholder.a2uiRuntime = undefined;
      } else if (state.done && !state.runId) {
        // A completed stream without RunStarted cannot authorize an action.
        placeholder.a2uiRuntime = undefined;
      }
      result.completed = state.done && !state.error;
    };
    try {
      const resp = await open(controller.signal);
      if (!resp.ok || !resp.body) {
        result.preDispatch4xx = isDefinitePreDispatch4xx({
          response: { status: resp.status, headers: resp.headers },
        });
        throw new Error(`stream HTTP ${resp.status}`);
      }
      if (!isEventStreamResponse(resp)) {
        throw new Error("stream response content type mismatch");
      }

      const canonicalDialogueId = canonicalDialogueHeader(resp);
      const canonicalMessageId = canonicalMessageHeader(resp);
      result = {
        dialogueId: canonicalDialogueId,
        messageId: canonicalMessageId,
      };
      const requestIdHeader = safeRequestHeader(resp, "X-Request-Id");
      const botRequestIdHeader = safeRequestHeader(resp, "X-Bot-Request-Id");
      if (requestIdHeader) result.requestId = requestIdHeader;
      if (botRequestIdHeader) result.botRequestId = botRequestIdHeader;

      // Both headers are required before the message can own an interactive
      // uplink. A partial/malformed identity remains visibly non-interactive;
      // never fall back to parentRowId, 0, new_*, or the selected chat key.
      if (canonicalDialogueId && canonicalMessageId) {
        placeholder.id = canonicalMessageId;
        placeholder.a2uiRuntime = {
          dialogueId: canonicalDialogueId,
          messageId: canonicalMessageId,
          runId: placeholder.a2uiRuntime?.runId ?? "",
          transport: createFetchA2uiTransport({
            conversationId: canonicalDialogueId,
            getToken,
            acceptLanguage: i18n.global.locale.value,
          }),
        };
        // Rekey before the body loop so leave/resume can use the server id.
        onIdentity?.({
          dialogueId: canonicalDialogueId,
          messageId: canonicalMessageId,
        });
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const consumeFrame = (frame: string) => {
        const frameId = parseSSEFrameId(frame);
        if (frameId) placeholder.streamSeq = frameId;
        // Some Bot-compatible providers close with the legacy [DONE] sentinel
        // instead of a RunFinished event. Treat that sentinel as terminal while
        // leaving all other AG-UI bytes untouched for the existing parser.
        if (isDoneFrame(frame)) {
          state = reduceAGUIEvent(state, { type: "RunFinished", data: {} });
          return;
        }
        const ev = parseAGUIFrame(frame);
        if (!ev) return;
        if (!BOUNDED_AGUI_EVENTS.has(ev.type)) return;
        contextNotice = reduceContextStagedNotice(contextNotice, ev);
        if (
          contextNotice.context_rebuilt === true ||
          contextNotice.context_degraded === true
        ) {
          const normalizedNotice = normalizeChatContextNotice(contextNotice);
          if (normalizedNotice) placeholder.contextNotice = normalizedNotice;
          result.contextNotice = { ...contextNotice };
        }
        state = reduceAGUIEvent(state, ev);
        if (state.runId && placeholder.a2uiRuntime) {
          placeholder.a2uiRuntime = {
            ...placeholder.a2uiRuntime,
            runId: state.runId,
          };
        }
        placeholder.blocks = state.blocks; // reactive: re-renders StreamMessage
      };
      // Read loop: decode bytes, split complete frames, reduce, mutate blocks.
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { frames, rest } = splitSSEFrames(buffer);
        buffer = rest;
        for (const frame of frames) consumeFrame(frame);
      }
      buffer += decoder.decode();
      if (buffer) consumeFrame(buffer);

      if (!state.done) {
        placeholder.content = t("chat.streamInterrupted");
        placeholder.streamTerminalFailure = "interrupted";
        placeholder.a2uiRuntime = undefined;
      }
      applyTerminalState();
    } catch (error: unknown) {
      // Once RunFinished has been reduced, a later transport close/error does
      // not revoke a successfully completed message. Before that terminal
      // event, Abort and broken streams invalidate the message-owned uplink.
      if (!state.done) {
        placeholder.a2uiRuntime = undefined;
        if (isAbortError(error)) {
          // Live POST Stop still marks cancelled. Resume unmount/leave must
          // not; only owner Stop (generationStopped) uses that cancel path.
          if (
            abortFailure === "cancelled" ||
            (abortFailure === "resume" && chatState.generationStopped)
          ) {
            placeholder.streamTerminalFailure = "cancelled";
          }
        } else {
          placeholder.content = t("chat.streamInterrupted");
          placeholder.streamTerminalFailure = "interrupted";
        }
      } else {
        // RunFinished and RunError are already terminal. A later transport
        // failure must preserve and fully finalize the upstream outcome.
        applyTerminalState();
      }
    } finally {
      // Always finalize this request's placeholder and unregister its controller.
      // Clear dialogue streaming fields only while this request still owns them —
      // a stale finally must not wipe a newer same-dialogue stream.
      placeholder.streaming = false;
      placeholder.instantMessage = true;
      if (chatState.streamingMessageId === requestId) {
        chatState.isStreaming = false;
        chatState.streamingMessageId = null;
      }
      unregisterAbortController(requestId); // mirror the axios .finally cleanup
    }
    return result;
  };

  const streamMessage = async (input: StreamInput): Promise<StreamResult> => {
    const {
      dialogueId,
      formData,
      requestId,
      placeholder,
      clientTurnId,
      onIdentity,
    } = input;
    if (clientTurnId && !formData.has("client_turn_id")) {
      formData.append("client_turn_id", clientTurnId);
    }
    assertReferenceOnlyFormData(formData);
    const clientTurnHeader = formData.get("client_turn_id");
    const chatState = getChatState(dialogueId);
    // The send route still accepts the captured parent row id. It is not a
    // canonical conversation identity and must never address A2UI actions.
    const parentRowId = formData.get("id")?.toString() ?? "0";

    return executeStream({
      placeholder,
      requestId,
      chatState,
      onIdentity,
      abortFailure: "cancelled",
      seedReducer: false,
      open: (signal) =>
        fetch(`/api/v1/conversations/${parentRowId}/messages`, {
          method: "POST",
          body: formData,
          signal,
          headers: {
            Accept: "text/event-stream",
            "Accept-Language": i18n.global.locale.value,
            platform: "bcemis",
            Authorization: "Bearer " + getToken(),
            satoken: getToken() ?? "",
            ...(typeof clientTurnHeader === "string" && clientTurnHeader !== ""
              ? { "X-Phyto-Client-Turn-Id": clientTurnHeader }
              : {}),
          },
        }),
    });
  };

  const resumeStreamMessage = async (
    input: ResumeStreamInput
  ): Promise<StreamResult> => {
    const { dialogueId, messageId, placeholder } = input;
    const requestId = input.requestId ?? `resume:${messageId}`;
    const lastEventId = (input.lastEventId ?? placeholder.streamSeq)?.trim();
    const chatState = getChatState(dialogueId);
    placeholder.streaming = true;
    chatState.isSending = true;
    chatState.activeRequestId = requestId;
    chatState.sendStartedAt = chatState.sendStartedAt ?? Date.now();
    chatState.activeAgentName =
      typeof placeholder.tool_name === "string" ? placeholder.tool_name : "";
    try {
      return await executeStream({
        placeholder,
        requestId,
        chatState,
        abortFailure: "resume",
        seedReducer: Boolean(lastEventId),
        open: (signal) =>
          resumeMessageStream({
            dialogueId,
            messageId,
            lastEventId: lastEventId || undefined,
            signal,
          }),
      });
    } finally {
      if (chatState.activeRequestId === requestId) {
        chatState.activeRequestId = "";
        chatState.isSending = false;
        chatState.sendStartedAt = null;
        chatState.completing = false;
        chatState.activeAgentName = "";
        chatState.generationStopped = false;
      }
    }
  };

  return { streamMessage, resumeStreamMessage };
}

function isAbortError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || Array.isArray(error)) {
    return false;
  }
  return (error as { name?: unknown }).name === "AbortError";
}
