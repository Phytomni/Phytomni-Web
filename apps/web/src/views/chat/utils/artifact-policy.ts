import type { ArtifactKind, ChatMessage } from "../types";
import { streamMarkdownToText } from "../messageTypes";

export type ReportSource = "final" | "intermediate" | "message";

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

const DEEP_GENOME_PLACEHOLDER_PATTERNS = [
  /^Server task created:\s*.*$/iu,
  /^Loading file content\.\.\.?$/iu,
  /^File content is empty or failed to load$/iu,
  /^Failed to load file/iu,
] as const;

const NON_REPORT_TEXT = new Set([
  "PENDING",
  "QUEUED",
  "RUNNING",
  "INPUT_REQUIRED",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "CANCELED",
  "TIMED_OUT",
  "TIMEOUT",
  "NO REFERENCES AVAILABLE.",
]);

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
  if (typeof content !== "string") return false;
  const normalized = content.trim();
  return (
    normalized !== "" &&
    DEEP_GENOME_PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(normalized))
  );
}

function isReportTextValid(toolName: string, value: unknown): value is string {
  if (typeof value !== "string") return false;
  const normalized = value.trim();
  if (normalized === "" || NON_REPORT_TEXT.has(normalized.toUpperCase())) {
    return false;
  }
  return (
    toolName !== "DeepGenomeAgent" || !isDeepGenomeTransportPlaceholder(value)
  );
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
  if (!message.streamTerminalFailure) {
    candidates.push([
      "message",
      typeof message.content === "string" ? message.content : "",
    ]);
  }
  candidates.push(["message", streamMarkdownToText(message.blocks)]);
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
