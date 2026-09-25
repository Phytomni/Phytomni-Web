/** Closed wait-progress + fake-CoT visual fixtures. Test-only, no network. */

import type { AgentTaskLifecycle } from "@/api/types";
import type { ChatMessage } from "@/views/chat/types";
import type { Phase3CProgressProps } from "../../fixtures/chat";

export const WAIT_COT_SENDING_KEYS = [
  "wait-cot-chat-start",
  "wait-cot-chat-mid",
  "wait-cot-chat-flush",
  "wait-cot-knowledge-mid",
] as const;

export const WAIT_COT_POLLABLE_KEYS = [
  "wait-cot-design",
  "wait-cot-genome",
  "wait-cot-research",
  "wait-cot-network-partial",
] as const;

export const WAIT_COT_VISUAL_FIXTURE_KEYS = [
  ...WAIT_COT_SENDING_KEYS,
  ...WAIT_COT_POLLABLE_KEYS,
] as const;

export type WaitCotSendingKey = (typeof WAIT_COT_SENDING_KEYS)[number];
export type WaitCotPollableKey = (typeof WAIT_COT_POLLABLE_KEYS)[number];
export type WaitCotVisualFixtureKey =
  (typeof WAIT_COT_VISUAL_FIXTURE_KEYS)[number];

export function isWaitCotSendingKey(
  value: string | null | undefined
): value is WaitCotSendingKey {
  return (
    typeof value === "string" &&
    (WAIT_COT_SENDING_KEYS as readonly string[]).includes(value)
  );
}

export function isWaitCotPollableKey(
  value: string | null | undefined
): value is WaitCotPollableKey {
  return (
    typeof value === "string" &&
    (WAIT_COT_POLLABLE_KEYS as readonly string[]).includes(value)
  );
}

export function isWaitCotVisualFixtureKey(
  value: string | null | undefined
): value is WaitCotVisualFixtureKey {
  return (
    typeof value === "string" &&
    (WAIT_COT_VISUAL_FIXTURE_KEYS as readonly string[]).includes(value)
  );
}

export type WaitCotSendingSpec = Phase3CProgressProps & {
  elapsedMs: number;
};

const USER_PROMPT =
  "Please analyze Os01g0177400 and summarize the next experimental steps.";

const lifecycle = (phase: AgentTaskLifecycle["phase"]): AgentTaskLifecycle => ({
  id: 901,
  phase,
  terminal: false,
  child_task_count: phase === "PREPARING" ? 0 : 1,
  child_work_accepted: phase !== "PREPARING",
  report_revision: phase === "PREPARING" ? 0 : 1,
  artifact_summary: {
    image_count: 0,
    output_directory_count: 0,
    has_report: phase === "RUNNING",
  },
  reconciliation: "FRESH",
  tracking_degraded: false,
  error_code: null,
});

export const WAIT_COT_SENDING: Record<WaitCotSendingKey, WaitCotSendingSpec> = {
  "wait-cot-chat-start": {
    startedAt: null,
    agentName: "ChatAgent",
    completing: false,
    elapsedMs: 0,
  },
  "wait-cot-chat-mid": {
    startedAt: null,
    agentName: "ChatAgent",
    completing: false,
    elapsedMs: 10_000,
  },
  "wait-cot-chat-flush": {
    startedAt: null,
    agentName: "ChatAgent",
    completing: true,
    elapsedMs: 0,
  },
  "wait-cot-knowledge-mid": {
    startedAt: null,
    agentName: "KnowledgeAgent",
    completing: false,
    elapsedMs: 78_000,
  },
};

export type WaitCotPollableData = {
  elapsedMs: number;
  user: ChatMessage;
  message: ChatMessage;
  lifecycle: AgentTaskLifecycle;
};

export const WAIT_COT_POLLABLE: Record<
  WaitCotPollableKey,
  WaitCotPollableData
> = {
  "wait-cot-design": {
    elapsedMs: 0,
    user: {
      id: "wait-cot-user-design",
      role: "user",
      content: USER_PROMPT,
    },
    message: {
      id: "wait-cot-design",
      role: "assistant",
      content: "",
      tool_name: "DigitalDesignAgent",
      status: "RUNNING",
    },
    lifecycle: lifecycle("RUNNING"),
  },
  "wait-cot-genome": {
    elapsedMs: 0,
    user: {
      id: "wait-cot-user-genome",
      role: "user",
      content: USER_PROMPT,
    },
    message: {
      id: "wait-cot-genome",
      role: "assistant",
      content: "",
      tool_name: "DeepGenomeAgent",
      status: "PREPARING",
    },
    lifecycle: lifecycle("PREPARING"),
  },
  "wait-cot-research": {
    elapsedMs: 0,
    user: {
      id: "wait-cot-user-research",
      role: "user",
      content: USER_PROMPT,
    },
    message: {
      id: "wait-cot-research",
      role: "assistant",
      content: "",
      tool_name: "InSilicoResearchAgent",
      status: "RUNNING",
    },
    lifecycle: lifecycle("RUNNING"),
  },
  "wait-cot-network-partial": {
    elapsedMs: 0,
    user: {
      id: "wait-cot-user-network",
      role: "user",
      content: USER_PROMPT,
    },
    message: {
      id: "wait-cot-network-partial",
      role: "assistant",
      content:
        "### Partial network report\n\nThe Agent has accepted one bounded analysis step.",
      tool_name: "GeneNetworkAgent",
      status: "RUNNING",
    },
    lifecycle: lifecycle("RUNNING"),
  },
};

export function waitCotProgressProps(
  key: WaitCotSendingKey,
  nowMs: number
): Phase3CProgressProps {
  const spec = WAIT_COT_SENDING[key];
  return {
    startedAt: nowMs - spec.elapsedMs,
    agentName: spec.agentName,
    completing: spec.completing,
  };
}

export function waitCotStartedAt(
  key: WaitCotPollableKey,
  nowMs: number
): number {
  return nowMs - WAIT_COT_POLLABLE[key].elapsedMs;
}
