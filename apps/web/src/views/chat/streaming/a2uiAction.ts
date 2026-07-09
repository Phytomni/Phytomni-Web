// Client→server action uplink for interactive agent-surface widgets.
// Exact Bot frame shape is still open (handoff Q3); this module owns a stable
// envelope + swappable transport so UI work is not blocked.

export interface A2uiActionEnvelope {
  surface_id: string;
  widget: string;
  action_id: string;
  run_id: string;
  payload: Record<string, unknown>;
}

export type A2uiActionTransport = (
  envelope: A2uiActionEnvelope,
) => Promise<void>;

const sentIds = new Set<string>();

export function buildA2uiActionId(): string {
  return `a2ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createMemoryA2uiTransport(
  sink: A2uiActionEnvelope[],
): A2uiActionTransport {
  return async (envelope) => {
    sink.push(envelope);
  };
}

export function createFetchA2uiTransport(opts: {
  conversationId: string;
  getToken: () => string | undefined;
  fetchImpl?: typeof fetch;
  // Locale string for Accept-Language; optional to keep tests light.
  acceptLanguage?: string;
}): A2uiActionTransport {
  const fetchImpl = opts.fetchImpl ?? fetch;
  return async (envelope) => {
    const token = opts.getToken() ?? "";
    const resp = await fetchImpl(
      `/api/v1/conversations/${opts.conversationId}/a2ui-actions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "Accept-Language": opts.acceptLanguage ?? "en-US",
          platform: "bcemis",
          Authorization: "Bearer " + token,
          satoken: token,
        },
        body: JSON.stringify(envelope),
      },
    );
    if (!resp.ok) {
      throw new Error(`a2ui action HTTP ${resp.status}`);
    }
  };
}

export async function sendA2uiAction(
  envelope: A2uiActionEnvelope,
  transport: A2uiActionTransport,
): Promise<void> {
  if (sentIds.has(envelope.action_id)) return;
  sentIds.add(envelope.action_id);
  try {
    await transport(envelope);
  } catch (e) {
    // Allow a later retry with the same id only if the transport failed.
    sentIds.delete(envelope.action_id);
    throw e;
  }
}

// Test-only helper: clear idempotency set between specs if needed.
export function _resetA2uiActionIdempotencyForTests(): void {
  sentIds.clear();
}
