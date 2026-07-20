import type { CitationDocument, ContentBlock } from "../types";
import type { AguiEvent } from "./aguiEvents";
import { parseA2uiCustomValue } from "./a2uiParse";

// ReducerState folds the AG-UI event stream into ordered content blocks plus
// the fields the message needs to finalize (run id, follow-ups, done/error).
export interface ReducerState {
  blocks: ContentBlock[];
  runId: string;
  followUp: string[];
  references: CitationDocument[]; // phyto.references doc_list (P1 cited streaming)
  done: boolean;
  error?: { message: string };
}

export function initReducerState(): ReducerState {
  return { blocks: [], runId: "", followUp: [], references: [], done: false };
}

// reduceAGUIEvent folds one event into a NEW state (pure; never mutates input).
// UI copy is the Web app's job: tool/step blocks carry structured identifiers
// (toolName/label), not Bot-authored display strings.
export function reduceAGUIEvent(
  state: ReducerState,
  ev: AguiEvent
): ReducerState {
  const blocks = state.blocks.map((b) => ({ ...b }));
  const next: ReducerState = { ...state, blocks };
  switch (ev.type) {
    case "RunStarted": {
      // Guard against a later RunStarted (retry / duplicate frame) with a
      // blank run_id clobbering an already-captured id — mirrors the Go
      // accumulator's non-overwrite invariant.
      const rid = stringField(ev.data.run_id);
      if (rid) next.runId = rid;
      break;
    }
    case "TextMessageContent":
      appendText(blocks, "markdown", stringField(ev.data.delta));
      break;
    case "ReasoningMessageContent":
      appendText(blocks, "reasoning", stringField(ev.data.delta));
      break;
    case "ToolCallStart":
      blocks.push({
        type: "tool",
        authority: "web",
        toolName: stringField(ev.data.tool_name),
      });
      break;
    case "ToolCallResult": {
      const summary = isRecord(ev.data.result_summary)
        ? ev.data.result_summary
        : undefined;
      const count = summary?.count;
      const tool = [...blocks].reverse().find((b) => b.type === "tool");
      if (tool && typeof count === "number" && Number.isFinite(count)) {
        tool.count = count;
      }
      break;
    }
    case "StepStarted":
      blocks.push({
        type: "step",
        authority: "web",
        label: stringField(ev.data.step_name),
      });
      break;
    case "Custom": {
      const name = stringField(ev.data.name);
      const value = ev.data.value;
      if (name === "phyto.follow_up" && Array.isArray(value)) {
        next.followUp = value.filter(
          (item): item is string => typeof item === "string"
        );
      } else if (name === "phyto.references" && isRecord(value)) {
        // P1 cited streaming: finalize copies these into message.doc_list so
        // the ns-aware cited render path engages (citation ns invariant).
        next.references = decodeCitationDocuments(value.doc_list);
      } else if (name === "phyto.a2ui") {
        const parsed = parseA2uiCustomValue(value);
        if (parsed.ok) {
          const surface = parsed.value;
          if (
            blocks.some(
              (block) => block.a2ui?.surface.surface_id === surface.surface_id
            )
          ) {
            console.warn("[phyto.a2ui] skipped frame: duplicate_surface_id");
            break;
          }
          blocks.push({
            type: "agent-surface",
            authority: "agent",
            interactive: true,
            a2ui: {
              surface,
              state: { status: "ready", round: 1 },
            },
          });
        } else {
          // Skip bad frames; keep the stream alive. Prefer warn over throw.
          console.warn("[phyto.a2ui] skipped frame:", parsed.reason);
        }
      }
      break;
    }
    case "TextMessageStart":
    case "TextMessageEnd":
      break;
    case "RunFinished":
      next.done = true;
      break;
    case "RunError":
      // RunError is terminal. Preserve the first upstream message if a
      // transport layer later tries to append a synthetic error event.
      if (!next.error) {
        next.error = {
          message: stringField(ev.data.message) || "stream error",
        };
      }
      next.done = true;
      // A failed run expires only surfaces that are still open or submitting.
      // Terminal/protocol states are preserved so a late stream error cannot
      // overwrite an already-decided interaction.
      for (const b of blocks) {
        const runtime = b.a2ui;
        if (!runtime) continue;
        const { state: surfaceState } = runtime;
        if (surfaceState.status === "ready") {
          b.a2ui = {
            surface: runtime.surface,
            state: {
              status: "expired",
              round: surfaceState.round,
              code: "run_failed",
            },
          };
        } else if (surfaceState.status === "submitting") {
          b.a2ui = {
            surface: runtime.surface,
            state: {
              status: "expired",
              round: surfaceState.round,
              actionId: surfaceState.envelope.action_id,
              code: "run_failed",
            },
          };
        }
      }
      break;
  }
  return next;
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeCitationDocuments(value: unknown): CitationDocument[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) =>
    isRecord(item) ? [item as CitationDocument] : []
  );
}

// appendText appends a delta to the LAST block of the given type if it is the
// tail block, otherwise starts a new one — so interleaved tool/step events
// break text into separate markdown/reasoning blocks in arrival order.
function appendText(
  blocks: ContentBlock[],
  type: "markdown" | "reasoning",
  delta: string
): void {
  if (!delta) return;
  const tail = blocks[blocks.length - 1];
  if (tail && tail.type === type) {
    tail.text = (tail.text ?? "") + delta;
  } else {
    blocks.push({ type, authority: "web", text: delta });
  }
}
