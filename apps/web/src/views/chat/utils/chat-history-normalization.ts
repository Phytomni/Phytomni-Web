export function normalizeHistoryRows(data: unknown): Record<string, unknown>[] {
  if (!Array.isArray(data)) return [];
  return data.filter(
    (item): item is Record<string, unknown> =>
      typeof item === "object" && item !== null && !Array.isArray(item)
  );
}

export function resolveHistoryQuestion(
  row: Record<string, unknown>,
  conversationTitle: string
): string {
  if (typeof row.query === "string" && row.query.trim()) {
    return row.query;
  }

  for (const candidate of [row.title_query, conversationTitle]) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return "";
}
