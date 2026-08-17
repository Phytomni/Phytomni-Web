/** Exact/prefix placeholders harvested from product i18n and transport text. */

import enUS from "@/locales/langs/en-US";
import zhCN from "@/locales/langs/zh-CN";

export type ReportPlaceholderRule =
  | { readonly match: "exact"; readonly value: string }
  | { readonly match: "prefix"; readonly value: string };

type AgentLocaleCopy = {
  emptyReport?: unknown;
  noReferences?: unknown;
  taskCreated?: unknown;
};

function harvestProductEmptyReportPlaceholders(
  packs: readonly unknown[]
): readonly ReportPlaceholderRule[] {
  const exact = new Set<string>();
  const prefixes = new Set<string>();
  for (const pack of packs) {
    const agents = (pack as { agents?: Record<string, AgentLocaleCopy> })
      .agents;
    if (!agents) continue;
    for (const agent of Object.values(agents)) {
      if (typeof agent.emptyReport === "string" && agent.emptyReport.trim()) {
        exact.add(agent.emptyReport);
      }
      if (typeof agent.noReferences === "string" && agent.noReferences.trim()) {
        exact.add(agent.noReferences);
      }
      if (typeof agent.taskCreated === "string" && agent.taskCreated.trim()) {
        prefixes.add(agent.taskCreated);
      }
    }
  }
  return [
    ...[...exact].sort().map((value) => ({ match: "exact" as const, value })),
    ...[...prefixes]
      .sort()
      .map((value) => ({ match: "prefix" as const, value })),
  ];
}

/**
 * EN/ZH empty-report, no-references, and task-created copy from locale packs.
 */
export const PRODUCT_EMPTY_REPORT_PLACEHOLDERS =
  harvestProductEmptyReportPlaceholders([enUS, zhCN]);

/** Lifecycle tokens plus Web/BFF/Bot transport acknowledgements. */
export const GENERIC_REPORT_PLACEHOLDERS = [
  { match: "exact", value: "PENDING" },
  { match: "exact", value: "QUEUED" },
  { match: "exact", value: "RUNNING" },
  { match: "exact", value: "INPUT_REQUIRED" },
  { match: "exact", value: "SUCCEEDED" },
  { match: "exact", value: "FAILED" },
  { match: "exact", value: "CANCELLED" },
  { match: "exact", value: "CANCELED" },
  { match: "exact", value: "TIMED_OUT" },
  { match: "exact", value: "TIMEOUT" },
  { match: "exact", value: "Sorry, I cannot answer this question." },
  { match: "exact", value: "Task created" },
  { match: "prefix", value: "Task created:" },
  { match: "prefix", value: "Task created successfully" },
  { match: "prefix", value: "Tasks created successfully:" },
  { match: "prefix", value: "Task submission failed:" },
  { match: "prefix", value: "Server task created:" },
  ...PRODUCT_EMPTY_REPORT_PLACEHOLDERS,
] as const satisfies readonly ReportPlaceholderRule[];

/**
 * Tool-specific transport/loading/error-only placeholders.
 * DeepGenome is the only approved per-agent expansion; do not infer others.
 */
export const TOOL_REPORT_PLACEHOLDERS: Readonly<
  Record<string, readonly ReportPlaceholderRule[]>
> = {
  DeepGenomeAgent: [
    { match: "prefix", value: "Server task created:" },
    { match: "exact", value: "Loading file content..." },
    { match: "exact", value: "Loading file content.." },
    { match: "exact", value: "File content is empty or failed to load" },
    { match: "prefix", value: "Failed to load file" },
  ],
};

export function matchesReportPlaceholder(
  text: string,
  rules: readonly ReportPlaceholderRule[]
): boolean {
  const normalized = text.trim();
  if (normalized === "") return false;
  return rules.some((rule) => {
    if (rule.match === "prefix") {
      return normalized
        .toLocaleUpperCase()
        .startsWith(rule.value.toLocaleUpperCase());
    }
    return normalized.toLocaleUpperCase() === rule.value.toLocaleUpperCase();
  });
}

export function isApprovedReportText(
  toolName: string,
  value: unknown
): value is string {
  if (typeof value !== "string") return false;
  const normalized = value.trim();
  if (normalized === "") return false;
  if (matchesReportPlaceholder(normalized, GENERIC_REPORT_PLACEHOLDERS)) {
    return false;
  }
  const toolRules = TOOL_REPORT_PLACEHOLDERS[toolName];
  return !toolRules || !matchesReportPlaceholder(normalized, toolRules);
}

export function isDeepGenomeLedgerPlaceholder(
  content: unknown
): content is string {
  if (typeof content !== "string") return false;
  const normalized = content.trim();
  return (
    normalized !== "" &&
    matchesReportPlaceholder(
      normalized,
      TOOL_REPORT_PLACEHOLDERS.DeepGenomeAgent
    )
  );
}
