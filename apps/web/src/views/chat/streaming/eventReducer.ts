import type { ContentBlock } from "../types";
import type { AGUIEvent } from "./aguiEvents";

// ReducerState folds the AG-UI event stream into ordered content blocks plus
// the fields the message needs to finalize (run id, follow-ups, done/error).
export interface ReducerState {
  blocks: ContentBlock[];
  runId: string;
  followUp: string[];
  references: any[]; // phyto.references doc_list (P1 cited streaming)
  done: boolean;
  error?: { message: string };
}

export function initReducerState(): ReducerState {
  return { blocks: [], runId: "", followUp: [], references: [], done: false };
}

// reduceAGUIEvent folds one event into a NEW state (pure; never mutates input).
// UI copy is the Web app's job: tool/step blocks carry structured identifiers
// (toolName/label), not Bot-authored display strings.
export function reduceAGUIEvent(state: ReducerState, ev: AGUIEvent): ReducerState {
  const blocks = state.blocks.map((b) => ({ ...b }));
  const next: ReducerState = { ...state, blocks };
  switch (ev.type) {
    case "RunStarted": {
      // Guard against a later RunStarted (retry / duplicate frame) with a
      // blank run_id clobbering an already-captured id — mirrors the Go
      // accumulator's non-overwrite invariant.
      const rid = String(ev.data.run_id ?? "");
      if (rid) next.runId = rid;
      break;
    }
    case "TextMessageContent":
      appendText(blocks, "markdown", String(ev.data.delta ?? ""));
      break;
    case "ReasoningMessageContent":
      appendText(blocks, "reasoning", String(ev.data.delta ?? ""));
      break;
    case "ToolCallStart":
      blocks.push({
        type: "tool",
        authority: "web",
        toolName: String(ev.data.tool_name ?? ""),
      });
      break;
    case "ToolCallResult": {
      const count = ev.data.result_summary?.count;
      const tool = [...blocks].reverse().find((b) => b.type === "tool");
      if (tool && typeof count === "number") tool.count = count;
      break;
    }
    case "StepStarted":
      blocks.push({
        type: "step",
        authority: "web",
        label: String(ev.data.step_name ?? ""),
      });
      break;
    case "Custom":
      if (ev.data.name === "phyto.follow_up" && Array.isArray(ev.data.value)) {
        next.followUp = ev.data.value.map((v: any) => String(v));
      } else if (
        ev.data.name === "phyto.references" &&
        Array.isArray(ev.data.value?.doc_list)
      ) {
        // P1 cited streaming: finalize copies these into message.doc_list so
        // the ns-aware cited render path engages (citation ns invariant).
        next.references = ev.data.value.doc_list;
      }
      break;
    case "RunFinished":
      next.done = true;
      break;
    case "RunError":
      next.error = { message: String(ev.data.message ?? "stream error") };
      next.done = true;
      break;
  }
  return next;
}

// appendText appends a delta to the LAST block of the given type if it is the
// tail block, otherwise starts a new one — so interleaved tool/step events
// break text into separate markdown/reasoning blocks in arrival order.
function appendText(blocks: ContentBlock[], type: string, delta: string): void {
  const tail = blocks[blocks.length - 1];
  if (tail && tail.type === type) {
    tail.text = (tail.text ?? "") + delta;
  } else {
    blocks.push({ type, authority: "web", text: delta });
  }
}
