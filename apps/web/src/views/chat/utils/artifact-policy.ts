import type { ArtifactKind, ChatMessage } from "../types";
import {
  completedStreamMarkdownToText,
  streamMarkdownToText,
} from "../messageTypes";
import {
  isApprovedReportText,
  isDeepGenomeLedgerPlaceholder,
} from "./valid-report-ledger";

export type ReportSource = "final" | "intermediate" | "message";

export type ArtifactPreviewLifecycle = {
  phase: string;
  terminal: boolean;
};

const NON_TERMINAL_RUN_STATUSES = new Set([
  "PENDING",
  "QUEUED",
  "ACCEPTED",
  "SUBMITTING",
  "PREPARING",
  "RESOLVING_INPUTS",
  "PLANNING",
  "RUNNING",
  "INPUT_REQUIRED",
  "FINALIZING",
]);

function normalizedRunStatus(message: ArtifactPolicyMessage): string {
  return String(
    message.botLifecycle?.status ??
      message.botProjection?.status ??
      message.status ??
      ""
  )
    .trim()
    .toUpperCase();
}

export function researchRowLifecycleStatus(
  status: string
):
  | "RUNNING"
  | "INPUT_REQUIRED"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED"
  | "TIMED_OUT" {
  const normalized = status.trim().toUpperCase();
  if (normalized === "FAILED") return "FAILED";
  if (normalized === "CANCELLED" || normalized === "CANCELED") {
    return "CANCELLED";
  }
  if (normalized === "TIMED_OUT" || normalized === "TIMEOUT") {
    return "TIMED_OUT";
  }
  if (normalized === "INPUT_REQUIRED") return "INPUT_REQUIRED";
  if (normalized === "SUCCEEDED") return "SUCCEEDED";
  return "RUNNING";
}

function lifecycleTitleKey(phase: string): string {
  const normalized = phase.trim().toLowerCase();
  if (normalized === "input_required") return "chat.botReport.inputRequired";
  return `chat.lifecycle.${normalized}`;
}

/** Preview card title for a report-backed row; never Finished while still running. */
export function artifactPreviewTitleKey(
  message: ArtifactPolicyMessage,
  lifecycle?: ArtifactPreviewLifecycle | null
): string | null {
  if (artifactPresentationForMessage(message) === null) return null;
  if (lifecycle && !lifecycle.terminal) {
    return lifecycleTitleKey(lifecycle.phase);
  }
  const status = normalizedRunStatus(message);
  if (NON_TERMINAL_RUN_STATUSES.has(status)) {
    return lifecycleTitleKey(status);
  }
  if (status === "FAILED") return "chat.botReport.failed";
  if (status === "TIMED_OUT" || status === "TIMEOUT") {
    return "chat.lifecycle.timed_out";
  }
  if (status === "CANCELLED" || status === "CANCELED") {
    return "chat.lifecycle.cancelled";
  }
  return "common.finished";
}

export interface ArtifactPresentation {
  kind: Exclude<ArtifactKind, null>;
  report: string;
  source: ReportSource;
  identity: string;
}

export type ArtifactPolicyMessage = Pick<
  ChatMessage,
  | "role"
  | "content"
  | "id"
  | "streaming"
  | "tool_name"
  | "status"
  | "artifacts"
  | "delivery"
  | "streamPresentationKey"
  | "streamTerminalFailure"
  | "botLifecycle"
  | "botProjection"
  | "blocks"
>;

/** The only tools whose report text is promoted to the Chat View surface. */
export const REPORT_AGENT_POLICIES = Object.freeze({
  KnowledgeAgent: "cited-report",
  BriefGeneAgent: "cited-report",
  ReviewAgent: "cited-report",
  AnalystAgent: "research",
  DeepGenomeAgent: "deep-genome",
  InSilicoResearchAgent: "research",
  DigitalDesignAgent: "research",
  GeneNetworkAgent: "research",
} as const satisfies Record<string, Exclude<ArtifactKind, null>>);

function normalizeIdentity(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  return normalized === "" ? null : normalized;
}

export function artifactIdentityForMessage(
  message: ArtifactPolicyMessage
): string | null {
  const stream = normalizeIdentity(message.streamPresentationKey);
  if (stream) return `stream:${stream}`;

  const row = normalizeIdentity(message.id);
  if (row) return `message:${row}`;

  const run = normalizeIdentity(
    message.botLifecycle?.runId ?? message.botProjection?.runId
  );
  return run ? `run:${run}` : null;
}

export function isDeepGenomeTransportPlaceholder(
  content: ChatMessage["content"]
): boolean {
  return isDeepGenomeLedgerPlaceholder(content);
}

function isReportTextValid(toolName: string, value: unknown): value is string {
  return isApprovedReportText(toolName, value);
}

function reportCandidates(
  message: ArtifactPolicyMessage
): readonly [ReportSource, unknown][] {
  const candidates: [ReportSource, unknown][] = [
    ["final", message.botLifecycle?.finalReport],
    ["final", message.botProjection?.finalReport],
    ["intermediate", message.botLifecycle?.intermediateReport],
    ["intermediate", message.botProjection?.intermediateReport],
  ];
  if (message.streaming === true) return candidates;

  if (!message.streamTerminalFailure) {
    candidates.push([
      "message",
      typeof message.content === "string" ? message.content : "",
    ]);
  }
  candidates.push([
    "message",
    message.streamTerminalFailure
      ? completedStreamMarkdownToText(message.blocks)
      : streamMarkdownToText(message.blocks),
  ]);
  return candidates;
}

/** Select one stable, report-backed View presentation for a Chat row. */
export function artifactPresentationForMessage(
  message: ArtifactPolicyMessage
): ArtifactPresentation | null {
  if (message.role !== "assistant") return null;

  const toolName = message.tool_name ?? "";
  if (!Object.prototype.hasOwnProperty.call(REPORT_AGENT_POLICIES, toolName)) {
    return null;
  }
  const kind =
    REPORT_AGENT_POLICIES[toolName as keyof typeof REPORT_AGENT_POLICIES];
  if (!kind) return null;

  const identity = artifactIdentityForMessage(message);
  if (!identity) return null;

  for (const [source, candidate] of reportCandidates(message)) {
    if (isReportTextValid(toolName, candidate)) {
      // Cached DeepGenome files can already be complete while the run is
      // still non-terminal. Do not open View until the run finishes.
      if (
        kind === "deep-genome" &&
        NON_TERMINAL_RUN_STATUSES.has(normalizedRunStatus(message))
      ) {
        return null;
      }
      return { kind, report: candidate, source, identity };
    }
  }
  return null;
}

export function isMeaningfulDeepGenomeReport(
  content: ChatMessage["content"]
): boolean {
  return isReportTextValid("DeepGenomeAgent", content);
}

/** Report-backed artifact kind; generic file artifacts are handled by the panel. */
export function artifactKindForMessage(
  message: ArtifactPolicyMessage
): ArtifactKind {
  return artifactPresentationForMessage(message)?.kind ?? null;
}

/** Retained as a report-backed predicate for existing lifecycle call sites. */
export function isCompletedResearchMessage(
  message: ArtifactPolicyMessage
): boolean {
  return artifactPresentationForMessage(message)?.kind === "research";
}

/** Retained as a report-backed predicate for existing DeepGenome call sites. */
export function isCompletedDeepGenomeMessage(
  message: ArtifactPolicyMessage
): boolean {
  return artifactPresentationForMessage(message)?.kind === "deep-genome";
}
