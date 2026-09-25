import {
  MAX_BOT_ARTIFACTS,
  MAX_BOT_ARTIFACT_PATHS,
  MAX_BOT_FAILURES,
  isBotReportWarningCode,
} from "../botProjection";
import { isApprovedReportText } from "../utils/valid-report-ledger";
import type {
  BotArtifact,
  BotInteropProvenance,
  BotRunProjection,
  BotRunStatus,
  BotWorkStage,
  BotReport,
  BotReportWarningCode,
  BotReportStage,
  BotProgress,
} from "../botProjection";
import type {
  AgentResultDelivery,
  ConversationContextNotice,
} from "@/api/types";
import type { AguiEvent } from "./aguiEvents";

export type BotLifecycleStatus =
  | "RUNNING"
  | "INPUT_REQUIRED"
  | "SUCCEEDED"
  | "FAILED"
  | "TIMED_OUT"
  | "CANCELLED";

export interface BotLifecycleState {
  runId: string | null;
  status: BotLifecycleStatus;
  workStage?: BotWorkStage | null;
  reportRevision: number;
  report?: BotReport;
  reportWarningCodes?: BotReportWarningCode[];
  reportStage?: BotReportStage;
  reportUpdatedAt?: string | null;
  progress?: BotProgress;
  trackingDegraded?: boolean;
  visibleReport: string;
  intermediateReport: string;
  finalReport: string;
  degraded: boolean;
  degradedInterop?: boolean;
  interop?: BotInteropProvenance | null;
  failures: string[];
  artifacts: BotArtifact[];
  delivery?: AgentResultDelivery;
}

const TERMINAL_STATUSES = new Set<BotLifecycleStatus>([
  "SUCCEEDED",
  "FAILED",
  "TIMED_OUT",
  "CANCELLED",
]);

export function reduceContextStagedNotice(
  current: ConversationContextNotice,
  event: AguiEvent
): ConversationContextNotice {
  if (
    event.type !== "Custom" ||
    event.data.name !== "phyto.context_staged" ||
    typeof event.data.value !== "object" ||
    event.data.value === null ||
    Array.isArray(event.data.value)
  ) {
    return current;
  }
  const value = event.data.value as Record<string, unknown>;
  const rebuilt =
    typeof value.context_rebuilt === "boolean"
      ? value.context_rebuilt
      : undefined;
  const degraded =
    typeof value.context_degraded === "boolean"
      ? value.context_degraded
      : undefined;
  if (rebuilt === undefined && degraded === undefined) return current;
  return {
    ...(current.context_rebuilt === true || rebuilt === true
      ? { context_rebuilt: true }
      : {}),
    ...(current.context_degraded === true || degraded === true
      ? { context_degraded: true }
      : {}),
  };
}

const SAFE_FAILURE_MESSAGES: Record<string, string> = {
  failed: "analysis task failed",
  "analysis task failed": "analysis task failed",
  "final synthesis failed": "Final synthesis unavailable",
  timed_out: "analysis task timed out",
  timeout: "analysis task timed out",
  "analysis task timed out": "analysis task timed out",
  cancelled: "analysis task cancelled",
  canceled: "analysis task cancelled",
  "analysis task cancelled": "analysis task cancelled",
  brief_gene: "Optional BriefGene analysis unavailable",
  "briefgene failed": "Optional BriefGene analysis unavailable",
  "optional briefgene analysis unavailable":
    "Optional BriefGene analysis unavailable",
  optional: "Optional analysis unavailable",
  "optional analysis unavailable": "Optional analysis unavailable",
  final_synthesis: "Final synthesis unavailable",
  "final synthesis unavailable": "Final synthesis unavailable",
  artifact: "Artifact export warning",
  "artifact export warning": "Artifact export warning",
  tracking: "Run tracking unavailable",
  "run tracking unavailable": "Run tracking unavailable",
};

function cloneArtifacts(artifacts: readonly BotArtifact[]): BotArtifact[] {
  const cloned: BotArtifact[] = [];
  let pathCount = 0;

  for (const artifact of artifacts) {
    if (
      !artifact ||
      typeof artifact.outputDir !== "string" ||
      !Array.isArray(artifact.paths) ||
      cloned.length >= MAX_BOT_ARTIFACTS
    ) {
      continue;
    }

    const remainingPaths = Math.max(MAX_BOT_ARTIFACT_PATHS - pathCount, 0);
    const paths = artifact.paths
      .filter((path): path is string => typeof path === "string")
      .slice(0, remainingPaths);
    cloned.push({ outputDir: artifact.outputDir, paths });
    pathCount += paths.length;
  }

  return cloned;
}

function cloneDelivery(
  delivery: AgentResultDelivery | undefined
): AgentResultDelivery | undefined {
  return delivery ? { ...delivery } : undefined;
}

function mergeDelivery(
  current: AgentResultDelivery | undefined,
  incoming: AgentResultDelivery | undefined
): AgentResultDelivery | undefined {
  if (!incoming) return cloneDelivery(current);
  if (!current || incoming.revision > current.revision) {
    return cloneDelivery(incoming);
  }
  if (incoming.revision < current.revision) return cloneDelivery(current);
  if (
    (current.status === "ready" || current.status === "failed") &&
    incoming.status === "pending"
  ) {
    return cloneDelivery(current);
  }
  if (current.status === "ready" && incoming.status === "failed") {
    return cloneDelivery(current);
  }
  return cloneDelivery(incoming);
}

const INTEROP_MODES = new Set(["off", "auto", "required"]);
const INTEROP_STATUSES = new Set(["local", "delegated", "degraded", "failed"]);
const INTEROP_KINDS = new Set(["mcp", "a2a"]);
const INTEROP_CODES = new Set([
  "disabled",
  "forbidden",
  "unavailable",
  "discovery_failed",
  "no_evidence",
  "target_unavailable",
  "invalid_request",
  "degraded",
  "input_required",
  "interop_failed",
]);
const INTEROP_TARGET_ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/u;
const INTEROP_AGENT_NAMES = new Set([
  "research",
  "design",
  "InSilicoResearchAgent",
  "DigitalDesignAgent",
]);

/** Copy only the allowlisted interop labels into lifecycle-owned state. */
export function cloneBotInterop(
  value: BotInteropProvenance | null | undefined
): BotInteropProvenance | null {
  if (!value || typeof value !== "object") return null;
  if (
    typeof value.mode !== "string" ||
    !INTEROP_MODES.has(value.mode) ||
    typeof value.status !== "string" ||
    !INTEROP_STATUSES.has(value.status)
  ) {
    return null;
  }

  const copy: BotInteropProvenance = {
    mode: value.mode as BotInteropProvenance["mode"],
    status: value.status as BotInteropProvenance["status"],
  };
  if (
    typeof value.targetId === "string" &&
    INTEROP_TARGET_ID_PATTERN.test(value.targetId)
  ) {
    copy.targetId = value.targetId;
  }
  if (typeof value.kind === "string" && INTEROP_KINDS.has(value.kind)) {
    copy.kind = value.kind as BotInteropProvenance["kind"];
  }
  if (typeof value.code === "string" && INTEROP_CODES.has(value.code)) {
    copy.code = value.code as BotInteropProvenance["code"];
  }
  return copy;
}

function mergeInterop(
  current: BotInteropProvenance | null | undefined,
  incoming: BotInteropProvenance | null | undefined,
  stale: boolean
): BotInteropProvenance | null {
  const currentCopy = cloneBotInterop(current);
  const incomingCopy = cloneBotInterop(incoming);
  if (stale && currentCopy) return currentCopy;
  return incomingCopy ?? currentCopy;
}

function hasText(value: string): boolean {
  return value.trim() !== "";
}

function mapStatus(status: BotRunStatus): BotLifecycleStatus {
  switch (status) {
    case "INPUT_REQUIRED":
      return "INPUT_REQUIRED";
    case "SUCCEEDED":
      return "SUCCEEDED";
    case "FAILED":
      return "FAILED";
    case "CANCELLED":
      return "CANCELLED";
    case "TIMED_OUT":
      return "TIMED_OUT";
    case "RUNNING":
    case "PENDING":
    case "QUEUED":
    default:
      return "RUNNING";
  }
}

function isTerminal(status: BotLifecycleStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

function normalizedRevision(value: number): number {
  return Number.isSafeInteger(value) && value >= -1 ? value : -1;
}

function isStaleRevision(current: number, incoming: number): boolean {
  return current >= 0 && (incoming < 0 || incoming < current);
}

function mergeReport(
  current: string,
  incoming: string,
  stale: boolean
): string {
  if (!hasText(incoming)) return current;
  // A stale non-empty snapshot may fill an empty field, but it can never
  // replace content already exposed by a newer snapshot.
  if (stale && hasText(current)) return current;
  return incoming;
}

function mergeFailures(
  current: readonly string[],
  incoming: readonly string[]
): string[] {
  const merged: string[] = [];
  for (const message of [...current, ...incoming]) {
    if (merged.length >= MAX_BOT_FAILURES) break;
    if (typeof message !== "string") continue;
    const normalized = message.trim();
    if (normalized && !merged.includes(normalized)) merged.push(normalized);
  }
  return merged;
}

function mergeArtifacts(
  current: readonly BotArtifact[],
  incoming: readonly BotArtifact[]
): BotArtifact[] {
  const merged = cloneArtifacts(current);
  let pathCount = merged.reduce(
    (total, artifact) => total + artifact.paths.length,
    0
  );

  for (const artifact of incoming) {
    if (
      !artifact ||
      typeof artifact.outputDir !== "string" ||
      !Array.isArray(artifact.paths)
    ) {
      continue;
    }

    const existing = merged.find(
      (candidate) => candidate.outputDir === artifact.outputDir
    );
    if (!existing) {
      if (merged.length >= MAX_BOT_ARTIFACTS) continue;
      const remainingPaths = Math.max(MAX_BOT_ARTIFACT_PATHS - pathCount, 0);
      const paths = artifact.paths
        .filter((path): path is string => typeof path === "string")
        .slice(0, remainingPaths);
      merged.push({ outputDir: artifact.outputDir, paths });
      pathCount += paths.length;
      continue;
    }

    for (const path of artifact.paths) {
      if (
        pathCount >= MAX_BOT_ARTIFACT_PATHS ||
        typeof path !== "string" ||
        existing.paths.includes(path)
      ) {
        continue;
      }
      existing.paths.push(path);
      pathCount += 1;
    }
  }

  return merged;
}

function mergeStatus(
  current: BotLifecycleStatus,
  incoming: BotLifecycleStatus,
  stale: boolean
): BotLifecycleStatus {
  if (stale || (isTerminal(current) && !isTerminal(incoming))) {
    return current;
  }
  // A terminal lifecycle decision is sticky. A later poll must not reopen a
  // completed or failed message, even when the Bot emits a contradictory
  // status while reconciling retries.
  if (isTerminal(current)) return current;
  return incoming;
}

function safeFailureMessage(failure: unknown): string {
  // Error.message and arbitrary strings may contain credentials, provider
  // payloads, or stack data. Only fixed lifecycle labels are allowed into
  // reactive message state; every other value becomes a generic safe label.
  if (typeof failure === "string") {
    const normalized = failure.trim().toLowerCase();
    return SAFE_FAILURE_MESSAGES[normalized] ?? SAFE_FAILURE_MESSAGES.failed;
  }

  if (failure && typeof failure === "object") {
    const record = failure as Record<string, unknown>;
    const kind = record.kind ?? record.code ?? record.status;
    if (typeof kind === "string") {
      const mapped = SAFE_FAILURE_MESSAGES[kind.trim().toLowerCase()];
      if (mapped) return mapped;
    }
  }

  return SAFE_FAILURE_MESSAGES.failed;
}

/** Create an empty lifecycle snapshot with legacy revision semantics. */
export function initBotLifecycleState(): BotLifecycleState {
  return {
    runId: null,
    status: "RUNNING",
    workStage: null,
    reportRevision: -1,
    visibleReport: "",
    intermediateReport: "",
    finalReport: "",
    degraded: false,
    degradedInterop: false,
    interop: null,
    failures: [],
    artifacts: [],
    delivery: undefined,
  };
}

/**
 * Fold one sanitized Bot projection into a fresh lifecycle snapshot.
 *
 * Revision order controls report facts. Empty content preserves real science;
 * an explicit fresh warning list may clear warnings from an earlier report.
 */
export function reduceBotProjection(
  state: BotLifecycleState,
  incoming: BotRunProjection
): BotLifecycleState {
  const currentRevision = normalizedRevision(state.reportRevision);
  const incomingRevision = normalizedRevision(incoming.reportRevision);
  const stale = isStaleRevision(currentRevision, incomingRevision);
  const valid = (value: string) =>
    isApprovedReportText(incoming.agent, value) ? value : "";
  const nextIntermediate = stale
    ? valid(state.intermediateReport)
    : mergeReport(
        valid(state.intermediateReport),
        valid(incoming.intermediateReport),
        false
      );
  const nextFinal = stale
    ? valid(state.finalReport)
    : mergeReport(valid(state.finalReport), valid(incoming.finalReport), false);
  const incomingStatus = mapStatus(incoming.status);
  const nextStatus = mergeStatus(state.status, incomingStatus, stale);
  const nextWorkStage =
    stale || incoming.workStage === null ? state.workStage : incoming.workStage;
  const nextRunId = state.runId ?? incoming.runId ?? null;
  const nextRevision = Math.max(currentRevision, incomingRevision);
  const interopEnabled = INTEROP_AGENT_NAMES.has(incoming.agent);
  const nextInterop = mergeInterop(
    state.interop,
    interopEnabled ? incoming.interop : null,
    stale
  );
  const report = stale ? state.report : (incoming.report ?? state.report);
  const warnings = stale
    ? state.reportWarningCodes
    : (incoming.reportWarningCodes ?? state.reportWarningCodes);

  return {
    runId: nextRunId,
    status: nextStatus,
    workStage: nextWorkStage,
    reportRevision: nextRevision,
    report: report ? { ...report } : undefined,
    reportWarningCodes: warnings
      ? [...new Set(warnings.filter(isBotReportWarningCode))]
      : undefined,
    reportStage: stale ? state.reportStage : incoming.reportStage,
    reportUpdatedAt: stale ? state.reportUpdatedAt : incoming.reportUpdatedAt,
    progress: stale ? state.progress : { ...incoming.progress },
    intermediateReport: nextIntermediate,
    finalReport: nextFinal,
    visibleReport: hasText(nextFinal) ? nextFinal : nextIntermediate,
    degraded: stale
      ? state.degraded
      : report
        ? report.degraded || report.state === "degraded"
        : incoming.degraded,
    trackingDegraded:
      state.trackingDegraded === true || incoming.trackingDegraded === true,
    degradedInterop:
      state.degradedInterop === true ||
      (interopEnabled && incoming.degradedInterop === true),
    interop: nextInterop,
    failures: mergeFailures(state.failures, incoming.failures),
    artifacts: incoming.resultArchiveV1
      ? []
      : mergeArtifacts(state.artifacts, incoming.artifacts),
    delivery: mergeDelivery(state.delivery, incoming.delivery),
  };
}

/** Fold a local/transport failure without exposing its raw error message. */
export function reduceBotFailure(
  state: BotLifecycleState,
  failure?: unknown
): BotLifecycleState {
  const safeMessage = safeFailureMessage(failure);
  const terminal = isTerminal(state.status);
  const cancelled = safeMessage === SAFE_FAILURE_MESSAGES.cancelled;
  return {
    workStage: state.workStage,
    report: state.report ? { ...state.report } : undefined,
    reportWarningCodes: state.reportWarningCodes?.filter(
      isBotReportWarningCode
    ),
    reportStage: state.reportStage,
    reportUpdatedAt: state.reportUpdatedAt,
    progress: state.progress ? { ...state.progress } : undefined,
    trackingDegraded: state.trackingDegraded,
    runId: state.runId,
    status: terminal ? state.status : cancelled ? "CANCELLED" : "FAILED",
    reportRevision: normalizedRevision(state.reportRevision),
    intermediateReport: state.intermediateReport,
    finalReport: state.finalReport,
    visibleReport: hasText(state.finalReport)
      ? state.finalReport
      : state.intermediateReport,
    degraded: state.status === "SUCCEEDED" ? state.degraded : true,
    degradedInterop: state.degradedInterop === true,
    interop: cloneBotInterop(state.interop),
    failures: mergeFailures(state.failures, [safeMessage]),
    artifacts: cloneArtifacts(state.artifacts),
    delivery: cloneDelivery(state.delivery),
  };
}
