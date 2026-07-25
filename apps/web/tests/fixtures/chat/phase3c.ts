/**
 * Deterministic Phase 3C Chat fixtures — Activity, analyst log, progress,
 * transfer, and A2UI. Shared by Vitest and the visual harness; no network.
 */

import type { ContentBlock, ChatMessage } from "@/views/chat/types";
import type { TransferSnapshot } from "@/utils/transfer-progress";
import { activityDisclosureStateKey } from "@/views/chat/streaming/presentation";
import { PHASE_3B_USER_PROMPT } from "./messages";

/** Exact Phase 3C visual/registry keys (stable contract). */
export const PHASE_3C_FIXTURE_KEYS = [
  "activity-closed",
  "activity-open",
  "log-loading",
  "log-populated",
  "log-error",
  "log-missing-task",
  "progress-fast",
  "progress-slow",
  "progress-completing",
  "transfer-real",
  "a2ui-required",
  "send-stop",
  "parallel-a",
  "parallel-b",
] as const;

export type Phase3CFixtureKey = (typeof PHASE_3C_FIXTURE_KEYS)[number];

export function isPhase3CFixtureKey(
  value: string | null | undefined
): value is Phase3CFixtureKey {
  return (
    typeof value === "string" &&
    (PHASE_3C_FIXTURE_KEYS as readonly string[]).includes(value)
  );
}

/** Activity tool/step/reasoning group used by closed/open fixtures. */
export const FIXTURE_ACTIVITY_BLOCKS: ContentBlock[] = [
  {
    type: "tool",
    authority: "web",
    toolName: "knowledge_search",
    count: 2,
  },
  { type: "step", authority: "web", label: "retrieving" },
  { type: "reasoning", authority: "web", text: "Synthetic reasoning body." },
];

export const FIXTURE_ACTIVITY_MESSAGE_KEY = "fixture-activity-msg";
export const FIXTURE_ACTIVITY_STATE_KEY = activityDisclosureStateKey(
  FIXTURE_ACTIVITY_MESSAGE_KEY,
  0
);

export const MESSAGE_ACTIVITY_STREAMING: ChatMessage = {
  id: FIXTURE_ACTIVITY_MESSAGE_KEY,
  role: "assistant",
  content: "",
  streaming: true,
  streamPresentationKey: FIXTURE_ACTIVITY_MESSAGE_KEY,
  blocks: [
    ...FIXTURE_ACTIVITY_BLOCKS,
    {
      type: "markdown",
      authority: "web",
      text: "Synthetic answer after activity group.",
    },
  ],
  tool_name: "ChatAgent",
};

/** A2UI form with a required field — never invents a successful backend result. */
export const FIXTURE_A2UI_REQUIRED_BLOCK: ContentBlock = {
  type: "agent-surface",
  authority: "agent",
  interactive: true,
  a2ui: {
    surface: {
      catalog_version: "v1.0",
      surface_id: "fixture-surface-required",
      widget: "form",
      props: {
        title: "Synthetic required input",
        fields: [
          {
            name: "species",
            label: "Species",
            type: "text",
            required: true,
          },
        ],
      },
    },
    state: { status: "ready", round: 1 },
  },
};

export const MESSAGE_A2UI_REQUIRED: ChatMessage = {
  id: "fixture-msg-a2ui-required",
  role: "assistant",
  content: "",
  streaming: false,
  blocks: [FIXTURE_A2UI_REQUIRED_BLOCK],
  tool_name: "ChatAgent",
};

export const MESSAGE_FOLLOW_UPS: ChatMessage = {
  id: "fixture-msg-follow-ups",
  role: "assistant",
  content: "Synthetic assistant reply with follow-ups.",
  tool_name: "ChatAgent",
  followUpQuestions: [
    "Synthetic follow-up about allele frequency?",
    "Synthetic follow-up about haplotype blocks?",
  ],
  showFollowUpQuestions: true,
};

export const MESSAGE_ANALYST_LOG: ChatMessage = {
  id: "42",
  role: "assistant",
  content: "Synthetic analyst reply.",
  tool_name: "AnalystAgent",
  task_id: "fixture-task-42",
};

export const MESSAGE_ANALYST_LOG_MISSING_TASK: ChatMessage = {
  id: "43",
  role: "assistant",
  content: "Synthetic analyst reply without task id.",
  tool_name: "AnalystAgent",
  // intentionally no task_id
};

/** Synthetic upload transfer — harness only; cancel never hits a real request. */
export const FIXTURE_UPLOAD_TRANSFER: TransferSnapshot = {
  loaded: 256 * 1024,
  total: 1024 * 1024,
  percent: 25,
  etaSec: 8,
  indeterminate: false,
  phase: "upload",
  requestId: "fixture-upload-req",
};

/** Deterministic startedAt for simulated progress (epoch ms). */
export const FIXTURE_PROGRESS_STARTED_AT = 1_700_000_000_000;

export type Phase3CLogProps = {
  rowId?: string;
  taskId?: string;
  logData?: unknown;
  loading?: boolean;
  updating?: boolean;
  errorKind?: "fetch" | "update";
};

export type Phase3CProgressProps = {
  startedAt: number | null;
  agentName: string;
  completing: boolean;
};

export type Phase3COverlayKind =
  | "activity"
  | "log"
  | "progress"
  | "transfer"
  | "a2ui"
  | "send-stop"
  | "parallel";

export type Phase3COverlaySpec = {
  kind: Phase3COverlayKind;
  activityExpanded?: boolean;
  activityStreaming?: boolean;
  log?: Phase3CLogProps;
  progress?: Phase3CProgressProps;
  transfer?: TransferSnapshot | null;
  isSending?: boolean;
  dialogueLabel?: string;
  /** Assistant message used when the overlay mounts content rows. */
  assistantMessage?: ChatMessage;
};

export const PHASE_3C_OVERLAYS: Record<Phase3CFixtureKey, Phase3COverlaySpec> =
  {
    "activity-closed": {
      kind: "activity",
      activityExpanded: false,
      activityStreaming: true,
      assistantMessage: MESSAGE_ACTIVITY_STREAMING,
    },
    "activity-open": {
      kind: "activity",
      activityExpanded: true,
      activityStreaming: false,
      assistantMessage: MESSAGE_ACTIVITY_STREAMING,
    },
    "log-loading": {
      kind: "log",
      activityExpanded: true,
      log: {
        rowId: "42",
        taskId: "fixture-task-42",
        loading: true,
      },
      assistantMessage: MESSAGE_ANALYST_LOG,
    },
    "log-populated": {
      kind: "log",
      activityExpanded: true,
      log: {
        rowId: "42",
        taskId: "fixture-task-42",
        logData: "Synthetic analyst log line 1\nline 2",
        loading: false,
      },
      assistantMessage: MESSAGE_ANALYST_LOG,
    },
    "log-error": {
      kind: "log",
      activityExpanded: true,
      log: {
        rowId: "42",
        taskId: "fixture-task-42",
        errorKind: "fetch",
      },
      assistantMessage: MESSAGE_ANALYST_LOG,
    },
    "log-missing-task": {
      kind: "log",
      activityExpanded: true,
      log: {
        rowId: "43",
        taskId: undefined,
        logData: "Synthetic log without update path",
      },
      assistantMessage: MESSAGE_ANALYST_LOG_MISSING_TASK,
    },
    "progress-fast": {
      kind: "progress",
      progress: {
        startedAt: FIXTURE_PROGRESS_STARTED_AT,
        agentName: "ChatAgent",
        completing: false,
      },
      isSending: true,
    },
    "progress-slow": {
      kind: "progress",
      progress: {
        startedAt: FIXTURE_PROGRESS_STARTED_AT,
        agentName: "KnowledgeAgent",
        completing: false,
      },
      isSending: true,
    },
    "progress-completing": {
      kind: "progress",
      progress: {
        startedAt: FIXTURE_PROGRESS_STARTED_AT,
        agentName: "ChatAgent",
        completing: true,
      },
      isSending: true,
    },
    "transfer-real": {
      kind: "transfer",
      transfer: FIXTURE_UPLOAD_TRANSFER,
      isSending: true,
    },
    "a2ui-required": {
      kind: "a2ui",
      assistantMessage: MESSAGE_A2UI_REQUIRED,
    },
    "send-stop": {
      kind: "send-stop",
      isSending: true,
    },
    "parallel-a": {
      kind: "parallel",
      dialogueLabel: "Synthetic dialogue A",
      assistantMessage: {
        id: "fixture-msg-parallel-a",
        role: "assistant",
        content: "Synthetic parallel dialogue A reply.",
        tool_name: "ChatAgent",
      },
    },
    "parallel-b": {
      kind: "parallel",
      dialogueLabel: "Synthetic dialogue B",
      assistantMessage: {
        id: "fixture-msg-parallel-b",
        role: "assistant",
        content: "Synthetic parallel dialogue B reply.",
        tool_name: "KnowledgeAgent",
      },
    },
  };

export function getPhase3COverlay(key: Phase3CFixtureKey): Phase3COverlaySpec {
  return PHASE_3C_OVERLAYS[key];
}

/** User + specialized assistant transcript for a Phase 3C content key. */
export function buildPhase3CTranscript(key: Phase3CFixtureKey): ChatMessage[] {
  const overlay = PHASE_3C_OVERLAYS[key];
  if (!overlay.assistantMessage) {
    return [];
  }
  return [
    { ...PHASE_3B_USER_PROMPT, id: `fixture-msg-user-${key}` },
    overlay.assistantMessage,
  ];
}
