/** Cross a deliberately runtime-invalid boundary without manufacturing output. */
export function invalidInput<T>(value: unknown): T {
  return value as T;
}
