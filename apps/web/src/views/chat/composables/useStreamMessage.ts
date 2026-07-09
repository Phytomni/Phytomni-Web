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

  const streamMessage = async (input: StreamInput): Promise<void> => {
    const { dialogueId, formData, requestId, placeholder } = input;
    const chatState = getChatState(dialogueId);
    const id = formData.get("id")?.toString() ?? "0";

    const controller = new AbortController();
    registerAbortController(requestId, controller); // reuse the shared abort UI
    chatState.isStreaming = true;
    chatState.streamingMessageId = requestId;
    chatState.a2uiActionSender = createFetchA2uiTransport({
      conversationId: id,
      getToken,
      acceptLanguage: i18n.global.locale.value,
    });
    chatState.a2uiRunId = "";

    let state = initReducerState();
    try {
      const resp = await fetch(`/api/v1/conversations/${id}/messages`, {
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
      });
      if (!resp.ok || !resp.body) {
        throw new Error(`stream HTTP ${resp.status}`);
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
          if (state.runId) chatState.a2uiRunId = state.runId;
          placeholder.blocks = state.blocks; // reactive: re-renders StreamMessage
        }
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
      }
    } catch (e: any) {
      if (e?.name !== "AbortError") {
        placeholder.content = t("chat.streamInterrupted");
      }
    } finally {
      placeholder.streaming = false;
      placeholder.instantMessage = true;
      chatState.isStreaming = false;
      chatState.streamingMessageId = null;
      chatState.a2uiActionSender = null;
      chatState.a2uiRunId = "";
      unregisterAbortController(requestId); // mirror the axios .finally cleanup
    }
  };

  return { streamMessage };
}
