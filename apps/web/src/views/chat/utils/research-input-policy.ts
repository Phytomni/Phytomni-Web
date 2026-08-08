export function countUnicodeCodePoints(value: string): number {
  return Array.from(value).length;
}

export function queryWithinLimit(value: string, max: number): boolean {
  return (
    value.trim() !== "" &&
    Number.isSafeInteger(max) &&
    max > 0 &&
    countUnicodeCodePoints(value) <= max
  );
}
