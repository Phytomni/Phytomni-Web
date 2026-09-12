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
  if (isFailureOnlyReport(normalized)) return false;
  if (matchesReportPlaceholder(normalized, GENERIC_REPORT_PLACEHOLDERS)) {
    return false;
  }
  const toolRules = TOOL_REPORT_PLACEHOLDERS[toolName];
  return !toolRules || !matchesReportPlaceholder(normalized, toolRules);
}

// Historical terminal_report.py templates, not arbitrary scientific failure prose.
const NO_TEXT_REPORTS = [
  "The analysis reached a terminal outcome, but no validated scientific text artifact was available for synthesis. Review the downloadable scientific artifacts and execution warnings before drawing conclusions.",
  "\u5206\u6790\u5df2\u5230\u8fbe\u7ec8\u6001\uff0c\u4f46\u6ca1\u6709\u53ef\u7528\u4e8e\u7efc\u5408\u7684\u5df2\u9a8c\u8bc1\u79d1\u5b66\u6587\u672c\u4ea7\u7269\u3002\u5728\u5f62\u6210\u7ed3\u8bba\u524d\uff0c\u8bf7\u7ed3\u5408\u53ef\u4e0b\u8f7d\u7684\u79d1\u5b66\u4ea7\u7269\u548c\u6267\u884c\u8b66\u544a\u8fdb\u884c\u5ba1\u9605\u3002",
];
const SYNTHESIS_FAILURE_REPORTS = [
  {
    base: "The analysis reached a terminal outcome, but scientific report synthesis was unavailable. The validated scientific artifacts remain available for review before drawing conclusions.",
    scope:
      /^The terminal outcome covered [0-9]+ tasks, with [0-9]+ successful\.$/iu,
  },
  {
    base: "\u5206\u6790\u5df2\u5230\u8fbe\u7ec8\u6001\uff0c\u4f46\u79d1\u5b66\u62a5\u544a\u7efc\u5408\u4e0d\u53ef\u7528\u3002\u5728\u5f62\u6210\u7ed3\u8bba\u524d\uff0c\u4ecd\u53ef\u5ba1\u9605\u5df2\u9a8c\u8bc1\u7684\u79d1\u5b66\u4ea7\u7269\u3002",
    scope:
      /^\u672c\u6b21\u7ec8\u6001\u5305\u542b [0-9]+ \u4e2a\u4efb\u52a1\uff0c\u5176\u4e2d [0-9]+ \u4e2a\u4efb\u52a1\u6210\u529f\u3002$/u,
  },
];

function isFailureOnlyReport(text: string): boolean {
  const normalized = text.toUpperCase();
  if (NO_TEXT_REPORTS.some((template) => normalized === template.toUpperCase()))
    return true;
  return SYNTHESIS_FAILURE_REPORTS.some(({ base, scope }) => {
    if (normalized === base.toUpperCase()) return true;
    return (
      normalized.startsWith(`${base.toUpperCase()} `) &&
      scope.test(text.slice(base.length + 1))
    );
  });
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
