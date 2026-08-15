/** Conservative valid-report ledger: only approved exact/prefix placeholders. */

export type ReportPlaceholderRule =
  | { readonly match: "exact"; readonly value: string }
  | { readonly match: "prefix"; readonly value: string };

/** Lifecycle tokens and the one generic non-report acknowledgement. */
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
  { match: "exact", value: "NO REFERENCES AVAILABLE." },
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
