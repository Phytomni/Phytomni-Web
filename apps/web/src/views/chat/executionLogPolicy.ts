export type ExecutionActivitySurface = "execution" | "legacy_log" | "none";

const LEGACY_TASK_LOG_TOOLS = new Set([
  "AnalystAgent",
  "InSilicoResearchAgent",
]);

export function usesLegacyTaskLog(tool: string | null | undefined): boolean {
  return typeof tool === "string" && LEGACY_TASK_LOG_TOOLS.has(tool);
}

export function primaryExecutionActivitySurface(input: {
  tool: string | null | undefined;
  hasExecutionRun: boolean;
  workTraceSupported: boolean;
}): ExecutionActivitySurface {
  if (input.hasExecutionRun) return "execution";
  if (input.workTraceSupported) return "none";
  return usesLegacyTaskLog(input.tool) ? "legacy_log" : "none";
}
