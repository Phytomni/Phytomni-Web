import {
  isBotReportWarningCode,
  type BotReport,
  type BotReportStage,
} from "../botProjection";
import {
  initBotLifecycleState,
  reduceBotProjection,
  type BotLifecycleState,
} from "../streaming/botLifecycleReducer";
import type { ChatMessage } from "../types";
import { isApprovedReportText } from "./valid-report-ledger";

export type ReportSource = "final" | "intermediate" | "message";
export type ReportPresentationState =
  "loading" | "degraded" | "complete" | "failed";
export interface ReportPresentationFacts {
  status: string;
  finalReport?: string;
  intermediateReport?: string;
  visibleReport?: string;
  report?: BotReport;
  reportStage?: BotReportStage;
  reportWarningCodes?: readonly string[];
  degraded?: boolean;
  trackingDegraded?: boolean;
}
export interface ReportPresentationDecision {
  state: ReportPresentationState;
  labelKey: string;
  reportText: string;
  source: ReportSource | null;
  active: boolean;
  warningKeys: string[];
}

/** Execution outcome, report validity, and file delivery are independent facts. */
export function reportPresentationFor(
  facts: ReportPresentationFacts,
  selected?: { report: string; source: ReportSource },
  toolName = ""
): ReportPresentationDecision {
  const status = facts.status.trim().toUpperCase();
  const failed = [
    "FAILED",
    "TIMED_OUT",
    "TIMEOUT",
    "CANCELLED",
    "CANCELED",
  ].includes(status);
  const active = !failed && status !== "SUCCEEDED";
  const candidates: [ReportSource, unknown][] = [
    ...(selected
      ? [[selected.source, selected.report] as [ReportSource, unknown]]
      : []),
    ["final", facts.finalReport],
    ["intermediate", facts.intermediateReport],
    ["message", facts.visibleReport],
  ];
  const valid = candidates.find(([, text]) =>
    isApprovedReportText(toolName, text)
  );
  const reportText = valid ? String(valid[1]) : "";
  const source = valid?.[0] ?? null;
  const warningKeys = [
    ...new Set((facts.reportWarningCodes ?? []).filter(isBotReportWarningCode)),
  ].map((code) => `chat.botReport.warnings.${code}`);
  if (failed && reportText) {
    warningKeys.push(
      status === "TIMED_OUT" || status === "TIMEOUT"
        ? "chat.lifecycle.timed_out"
        : status === "CANCELLED" || status === "CANCELED"
          ? "chat.lifecycle.cancelled"
          : "chat.botReport.executionFailed"
    );
  }
  const result = (
    state: ReportPresentationState,
    labelKey: string
  ): ReportPresentationDecision => ({
    state,
    labelKey,
    reportText,
    source,
    active,
    warningKeys,
  });
  if (active) {
    if (status === "INPUT_REQUIRED")
      return result("loading", "chat.botReport.inputRequired");
    if (
      reportText &&
      (source === "intermediate" ||
        facts.reportStage === "intermediate" ||
        facts.report?.state === "intermediate")
    ) {
      return result("degraded", "chat.botReport.partial");
    }
    return result("loading", "chat.botReport.waiting");
  }
  if (reportText) {
    const final =
      source !== "intermediate" &&
      (facts.report
        ? facts.report.state === "final"
        : source === "final" || facts.reportStage === "final");
    const degraded = facts.report
      ? facts.report.degraded
      : facts.degraded === true;
    return !failed && final && !degraded && warningKeys.length === 0
      ? result("complete", "chat.botReport.complete")
      : result("degraded", "chat.botReport.partial");
  }
  if (
    warningKeys.length ||
    facts.report?.state === "degraded" ||
    facts.report?.degraded
  ) {
    return result("degraded", "chat.botReport.unavailable");
  }
  if (failed) {
    return result(
      "failed",
      status === "TIMED_OUT" || status === "TIMEOUT"
        ? "chat.lifecycle.timed_out"
        : status === "CANCELLED" || status === "CANCELED"
          ? "chat.lifecycle.cancelled"
          : "chat.botReport.failed"
    );
  }
  return result("degraded", "chat.botReport.unavailable");
}

/** Use the same revision-aware fold for cached messages and active projections. */
export function reportLifecycleForMessage(
  message: Pick<ChatMessage, "botLifecycle" | "botProjection" | "status">
): BotLifecycleState {
  const state = message.botLifecycle ?? initBotLifecycleState();
  if (message.botProjection)
    return reduceBotProjection(state, message.botProjection);
  if (message.botLifecycle) return state;
  const status = String(message.status ?? "")
    .trim()
    .toUpperCase();
  const normalized =
    status === "TIMEOUT"
      ? "TIMED_OUT"
      : status === "CANCELED"
        ? "CANCELLED"
        : status;
  return {
    ...state,
    status: [
      "SUCCEEDED",
      "FAILED",
      "CANCELLED",
      "TIMED_OUT",
      "INPUT_REQUIRED",
    ].includes(normalized)
      ? (normalized as BotLifecycleState["status"])
      : "RUNNING",
  };
}
