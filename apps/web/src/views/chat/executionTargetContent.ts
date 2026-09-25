export function executionTargetBlob(value: unknown): Blob | null {
  if (value instanceof Blob) return value;
  if (
    typeof value === "object" &&
    value !== null &&
    "data" in value &&
    value.data instanceof Blob
  ) {
    return value.data;
  }
  return null;
}
