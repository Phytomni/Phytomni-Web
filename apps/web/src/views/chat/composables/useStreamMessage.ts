import { getToken } from "@/utils/auth";
import i18n from "@/locales";
import {
  registerAbortController,
  unregisterAbortController,
} from "@/utils/request";
import { splitSSEFrames, parseAGUIFrame } from "../streaming/aguiEvents";
import { initReducerState, reduceAGUIEvent } from "../streaming/eventReducer";
import { createFetchA2uiTransport } from "../streaming/a2uiAction";
import type { ChatMessage } from "../types";

export interface StreamInput {
  dialogueId: string;
  formData: FormData;
  requestId: string;
  placeholder: ChatMessage;
}

export interface StreamResult {
  /** Canonical server dialogue identity, never the temporary/client parent id. */
  dialogueId?: string;
  /** Persisted assistant row id associated with this stream. */
  messageId?: string;
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
  if (!value || !/^[1-9]\d*$/.test(value)) return undefined;
  return value;
}

// useStreamMessage consumes the AG-UI SSE stream with fetch + ReadableStream
// (axios cannot read a stream incrementally). It mutates the already-pushed
// placeholder message per event so Vue reactivity renders blocks live, then
// finalizes on RunFinished/RunError. It coexists with the axios path in
// useSendMessage; the branch decision lives there.
export function useStreamMessage(opts: {
  getChatState: (dialogueId: string) => any;
  t: (key: string) => string; // i18n lookup (mirrors useSendMessage opts)
}) {
  const { getChatState, t } = opts;

  const streamMessage = async (input: StreamInput): Promise<StreamResult> => {
    const { dialogueId, formData, requestId, placeholder } = input;
    const chatState = getChatState(dialogueId);
    // The send route still accepts the captured parent row id. It is not a
    // canonical conversation identity and must never address A2UI actions.
    const parentRowId = formData.get("id")?.toString() ?? "0";

    const controller = new AbortController();
    registerAbortController(requestId, controller); // reuse the shared abort UI
    chatState.isStreaming = true;
    chatState.streamingMessageId = requestId;

    let state = initReducerState();
    let result: StreamResult = {};
    try {
      const resp = await fetch(
        `/api/v1/conversations/${parentRowId}/messages`,
        {
          method: "POST",
          body: formData,
          signal: controller.signal,
          headers: {
            Accept: "text/event-stream",
            "Accept-Language": i18n.global.locale.value,
            platform: "bcemis",
            Authorization: "Bearer " + getToken(),
            satoken: getToken() ?? "",
          },
        }
      );
      if (!resp.ok || !resp.body) {
        throw new Error(`stream HTTP ${resp.status}`);
      }

      const canonicalDialogueId = canonicalDialogueHeader(resp);
      const canonicalMessageId = canonicalMessageHeader(resp);
      result = {
        dialogueId: canonicalDialogueId,
        messageId: canonicalMessageId,
      };

      // Both headers are required before the message can own an interactive
      // uplink. A partial/malformed identity remains visibly non-interactive;
      // never fall back to parentRowId, 0, new_*, or the selected chat key.
      if (canonicalDialogueId && canonicalMessageId) {
        placeholder.id = canonicalMessageId;
        placeholder.a2uiRuntime = {
          dialogueId: canonicalDialogueId,
          messageId: canonicalMessageId,
          runId: "",
          transport: createFetchA2uiTransport({
            conversationId: canonicalDialogueId,
            getToken,
            acceptLanguage: i18n.global.locale.value,
          }),
        };
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      // Read loop: decode bytes, split complete frames, reduce, mutate blocks.
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { frames, rest } = splitSSEFrames(buffer);
        buffer = rest;
        for (const frame of frames) {
          const ev = parseAGUIFrame(frame);
          if (!ev) continue;
          state = reduceAGUIEvent(state, ev);
          if (state.runId && placeholder.a2uiRuntime) {
            placeholder.a2uiRuntime = {
              ...placeholder.a2uiRuntime,
              runId: state.runId,
            };
          }
          placeholder.blocks = state.blocks; // reactive: re-renders StreamMessage
        }
      }

      if (!state.done) {
        placeholder.content = t("chat.streamInterrupted");
        placeholder.a2uiRuntime = undefined;
      }
      // Finalize.
      placeholder.followUpQuestions = state.followUp;
      if (state.followUp.length) {
        // StreamMessage/MarkdownBlock emit no @finish (unlike the blocking
        // MarkdownViewer path), so reveal the follow-up chips here — otherwise
        // captured phyto.follow_up questions stay hidden until a history reload.
        placeholder.showFollowUpQuestions = true;
      }
      if (state.references.length) {
        // P1 cited streaming: expose captured references so the ns-aware
        // cited render path can engage after finalize (ns invariant).
        placeholder.doc_list = state.references;
      }
      if (state.error) {
        placeholder.content = state.error.message;
        placeholder.a2uiRuntime = undefined;
      } else if (state.done && !state.runId) {
        // A completed stream without RunStarted cannot authorize an action.
        placeholder.a2uiRuntime = undefined;
      }
    } catch (e: any) {
      // Once RunFinished has been reduced, a later transport close/error does
      // not revoke a successfully completed message. Before that terminal
      // event, Abort and broken streams invalidate the message-owned uplink.
      if (!state.done || state.error) {
        placeholder.a2uiRuntime = undefined;
        if (e?.name !== "AbortError") {
          placeholder.content = t("chat.streamInterrupted");
        }
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

  return { streamMessage };
}
