import type { A2uiSurfaceRuntime } from "./streaming/a2uiContract";

/** JSON-shaped content accepted by the blocking and streamed chat surfaces. */
export type ChatContent =
  | string
  | number
  | boolean
  | null
  | Record<string, unknown>
  | readonly unknown[];

/** Legacy agent-step entries are JSON values persisted inside answer payloads. */
export type AgentStep = ChatContent;

/** Citation rows are provider-shaped, but their known display fields are scalar. */
export interface CitationDocument {
  au?: string | number | null;
  ti?: string | number | null;
  so?: string | number | null;
  vl?: string | number | null;
  bp?: string | number | null;
  ep?: string | number | null;
  py?: string | number | null;
  dl?: string | number | null;
  pm?: string | number | null;
  title?: string | number | null;
  [key: string]: unknown;
}

interface StreamContentBlockBase {
  authority: "web" | "agent";
  interactive?: boolean;
  text?: string;
  toolName?: string;
  label?: string;
  count?: number;
  a2ui?: A2uiSurfaceRuntime;
  sourceActionId?: string;
}

export interface MarkdownContentBlock extends StreamContentBlockBase {
  type: "markdown";
}

export interface ToolContentBlock extends StreamContentBlockBase {
  type: "tool";
}

export interface StepContentBlock extends StreamContentBlockBase {
  type: "step";
}

export interface ReasoningContentBlock extends StreamContentBlockBase {
  type: "reasoning";
}

export interface AgentSurfaceContentBlock extends StreamContentBlockBase {
  type: "agent-surface";
}

/** Known stream blocks; arbitrary type strings are deliberately excluded. */
export type StreamContentBlock =
  | MarkdownContentBlock
  | ToolContentBlock
  | StepContentBlock
  | ReasoningContentBlock
  | AgentSurfaceContentBlock;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isA2uiSurfaceRuntime(value: unknown): value is A2uiSurfaceRuntime {
  if (!isRecord(value) || !isRecord(value.surface) || !isRecord(value.state)) {
    return false;
  }
  const surface = value.surface;
  const state = value.state;
  return (
    typeof surface.catalog_version === "string" &&
    typeof surface.surface_id === "string" &&
    (surface.widget === "confirm" ||
      surface.widget === "form" ||
      surface.widget === "choice") &&
    typeof state.status === "string" &&
    (state.round === 1 || state.round === 2)
  );
}

/** Decode bounded message content while preserving JSON values verbatim. */
export function decodeChatContent(value: unknown): ChatContent | undefined {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value) || isRecord(value)) {
    return value;
  }
  return undefined;
}

/** Render legacy object/array content without leaking object stringification. */
export function chatContentToText(value: ChatContent): string {
  if (typeof value === "string") return value;
  if (value === null) return "";
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (isRecord(value) && typeof value.final_answer === "string") {
    return value.final_answer;
  }
  return JSON.stringify(value) ?? "";
}

/** Keep table rendering on the array-of-records branch only. */
export function chatContentToRows(
  value: ChatContent
): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord);
}

/** Decode legacy step arrays without allowing functions or host objects through. */
export function decodeAgentSteps(value: unknown): AgentStep[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const step = decodeChatContent(item);
    return step === undefined ? [] : [step];
  });
}

/** Normalize the legacy JSON-string form used by blocking chat responses. */
export function decodeFollowUpQuestions(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value !== "string" || value.trim() === "") return [];

  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function copyOptionalFields(
  source: Record<string, unknown>,
  target: StreamContentBlockBase
): void {
  if (typeof source.interactive === "boolean") {
    target.interactive = source.interactive;
  }
  if (typeof source.text === "string") target.text = source.text;
  if (typeof source.toolName === "string") target.toolName = source.toolName;
  if (typeof source.label === "string") target.label = source.label;
  if (typeof source.count === "number" && Number.isFinite(source.count)) {
    target.count = source.count;
  }
  if (typeof source.sourceActionId === "string") {
    target.sourceActionId = source.sourceActionId;
  }
  if (isA2uiSurfaceRuntime(source.a2ui)) {
    target.a2ui = source.a2ui;
  }
}

/**
 * Decode one stream block. Unknown type values are rejected at this boundary
 * so an upstream extension cannot silently become a renderer or action target.
 */
export function decodeStreamContentBlock(
  value: unknown
): StreamContentBlock | undefined {
  if (!isRecord(value)) return undefined;
  const type = value.type;
  const authority = value.authority;
  if (
    typeof type !== "string" ||
    (authority !== "web" && authority !== "agent")
  ) {
    return undefined;
  }

  if (
    (type === "markdown" ||
      type === "tool" ||
      type === "step" ||
      type === "reasoning") &&
    authority !== "web"
  ) {
    return undefined;
  }
  if (type === "agent-surface" && authority !== "agent") {
    return undefined;
  }
  if (
    type !== "markdown" &&
    type !== "tool" &&
    type !== "step" &&
    type !== "reasoning" &&
    type !== "agent-surface"
  ) {
    return undefined;
  }

  const block = { type, authority } as StreamContentBlock;
  copyOptionalFields(value, block);
  return block;
}

/** Decode a possibly malformed block list, dropping only rejected entries. */
export function decodeStreamContentBlocks(
  value: unknown
): StreamContentBlock[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const block = decodeStreamContentBlock(item);
    return block ? [block] : [];
  });
}

/** Join only user-visible Markdown blocks using the stream renderer's order. */
export function streamMarkdownToText(
  blocks: readonly StreamContentBlock[] | undefined
): string {
  return (blocks ?? [])
    .filter(
      (block): block is MarkdownContentBlock =>
        block.type === "markdown" && typeof block.text === "string"
    )
    .map((block) => block.text?.trim() ?? "")
    .filter(Boolean)
    .join("\n\n");
}
