import type { Composer } from "vue-i18n";

export type DateDisplayPreset = "date" | "datetime" | "timestamp";

export function formatDisplayDate(
  d: Composer["d"],
  value: string | number | Date | null | undefined,
  preset: DateDisplayPreset,
  empty = "--"
): string {
  if (value == null || value === "") return empty;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return empty;
  return d(date, preset);
}
