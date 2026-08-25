/** Browser-owned presentation rollback switch; Bot production is independent. */
export function executionWorkbenchPresentationEnabled(
  value: string | undefined = import.meta.env.VITE_EXECUTION_WORKBENCH_ENABLED
): boolean {
  return value !== "false";
}

/** Independent V2 transport switch; presentation can remain for legacy history. */
export function executionV2TransportEnabled(
  value: string | undefined = import.meta.env.VITE_EXECUTION_V2_ENABLED
): boolean {
  return value !== "false";
}
