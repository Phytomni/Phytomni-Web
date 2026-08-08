export interface ClientTurnDraft {
  parentRowId: number;
  operation: "append" | "replace";
  mode: "instant" | "expert";
  selectedAgent: string;
  query: string;
  attachments: readonly string[];
  interopMode?: "off" | "auto" | "required";
  interopTargets?: readonly string[];
}

const PRE_DISPATCH_4XX = new Set([
  400, 401, 403, 404, 405, 406, 411, 413, 415, 422,
]);

/** Create an opaque browser-only identity for one logical conversation turn. */
export function createClientTurnId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") {
    return `turn-${cryptoApi.randomUUID()}`;
  }
  if (typeof cryptoApi?.getRandomValues !== "function") {
    throw new Error("Secure random source unavailable");
  }

  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);
  return `turn-${Array.from(bytes, (value) =>
    value.toString(16).padStart(2, "0")
  ).join("")}`;
}

/** Stable local retry key; file contents and browser File objects never enter it. */
export function clientTurnDraftFingerprint(draft: ClientTurnDraft): string {
  const interopMode = draft.interopMode ?? "off";
  return JSON.stringify({
    parentRowId: draft.parentRowId,
    operation: draft.operation,
    mode: draft.mode,
    selectedAgent: draft.selectedAgent,
    query: draft.query,
    attachments: [...draft.attachments],
    interopMode,
    interopTargets:
      interopMode === "off" ? [] : [...(draft.interopTargets ?? [])],
  });
}

/**
 * Match a pending retry draft, tolerating only a temporary-to-server parent
 * row rekey while keeping the user-visible turn inputs strict.
 */
export function clientTurnDraftFingerprintMatches(
  expectedFingerprint: string,
  actualFingerprint: string
): boolean {
  if (expectedFingerprint === actualFingerprint) return true;

  const comparable = (
    fingerprint: string
  ): { parentRowId: number; value: string } | null => {
    try {
      const parsed: unknown = JSON.parse(fingerprint);
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        return null;
      }
      const record = parsed as Record<string, unknown>;
      const interopMode = record.interopMode ?? "off";
      const interopTargets = record.interopTargets ?? [];
      if (
        typeof record.parentRowId !== "number" ||
        !Number.isSafeInteger(record.parentRowId) ||
        typeof record.operation !== "string" ||
        typeof record.mode !== "string" ||
        typeof record.selectedAgent !== "string" ||
        typeof record.query !== "string" ||
        !Array.isArray(record.attachments) ||
        !record.attachments.every((item) => typeof item === "string") ||
        (interopMode !== "off" &&
          interopMode !== "auto" &&
          interopMode !== "required") ||
        !Array.isArray(interopTargets) ||
        !interopTargets.every((item) => typeof item === "string") ||
        (record.datasetDescription !== undefined &&
          typeof record.datasetDescription !== "string")
      ) {
        return null;
      }
      return {
        parentRowId: record.parentRowId,
        value: JSON.stringify({
          operation: record.operation,
          mode: record.mode,
          selectedAgent: record.selectedAgent,
          query: record.query,
          attachments: record.attachments,
          interopMode,
          interopTargets: interopMode === "off" ? [] : interopTargets,
        }),
      };
    } catch {
      return null;
    }
  };

  const expected = comparable(expectedFingerprint);
  const actual = comparable(actualFingerprint);
  return (
    expected !== null &&
    actual !== null &&
    expected.parentRowId === 0 &&
    actual.parentRowId > 0 &&
    expected.value === actual.value
  );
}

/**
 * HTTP responses that reject validation/auth/routing before a turn can be
 * accepted. The gateway provenance marker is required because Bot-originated
 * 4xx responses use the same browser status range.
 */
export function isDefinitePreDispatch4xx(error: unknown): boolean {
  if (typeof error !== "object" || error === null || Array.isArray(error)) {
    return false;
  }
  const response = (error as { response?: unknown }).response;
  if (
    typeof response !== "object" ||
    response === null ||
    Array.isArray(response)
  ) {
    return false;
  }
  const status = (response as { status?: unknown }).status;
  const data = (response as { data?: unknown }).data;
  const dataMarker =
    typeof data === "object" &&
    data !== null &&
    !Array.isArray(data) &&
    (data as { pre_dispatch?: unknown }).pre_dispatch === true;
  const detail =
    typeof data === "object" &&
    data !== null &&
    !Array.isArray(data) &&
    (data as { detail?: unknown }).detail;
  const detailMarker =
    typeof detail === "object" &&
    detail !== null &&
    !Array.isArray(detail) &&
    (detail as { pre_dispatch?: unknown }).pre_dispatch === true;
  const headers = (response as { headers?: unknown }).headers;
  const headerMarker =
    typeof headers === "object" &&
    headers !== null &&
    !Array.isArray(headers) &&
    typeof (headers as { get?: unknown }).get === "function" &&
    (headers as { get: (name: string) => string | null }).get(
      "X-Phyto-Dispatch-State"
    ) === "not-started";
  return (
    typeof status === "number" &&
    PRE_DISPATCH_4XX.has(status) &&
    (dataMarker || detailMarker || headerMarker)
  );
}
